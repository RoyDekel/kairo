import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';
import React from 'react';
import { eventCache } from '../server/services/eventCache.js';
import { quoteCache } from '../server/services/quoteCache.js';
import { flightSearchCache } from '../server/services/flightSearchCache.js';
import { resetLimiters } from '../server/services/rateLimiter.js';

/*
  Tests must not touch production services.

  Before this, every run authenticated against the real Supabase project and called the
  live Ticketmaster API. That made the suite slow, network-dependent, and capable of
  writing to real data — the output was full of
  "localStorage data migrated to Supabase successfully" and
  "invalid input syntax for type uuid: test-user-123".

  It also made results depend on the machine: the Ticketmaster test took 499ms and hit
  the live API on a laptop with network, but 25ms and the simulated fallback in CI. Same
  test, opposite code paths, green both times.
*/

// Supabase: dataService and AuthProvider both branch on a null client and fall back to
// localStorage, so nulling it here keeps every test on the offline path.
vi.mock('./lib/supabaseClient', () => ({ supabase: null }));

/*
  The SERVER-side Supabase client, nulled for the same reason and one sharper one.

  This was missed when the durable cache landed, and the consequence only appeared once a
  real SUPABASE_SERVICE_KEY existed on the machine: getServerSupabase() started returning a
  live client mid-test-run, so the daily-budget counter issued real rpc() calls against the
  production project — inflating a real quota row and doubling every mocked fetch count.

  That is the same defect this file was written to eliminate: a test whose behaviour depends
  on which credentials the developer happens to have, passing for different reasons on
  different machines. Tests that need a store inject their own fake.
*/
vi.mock('../server/services/supabaseServer.js', () => ({
  getServerSupabase: () => null,
  resetServerSupabase: () => {}
}));

/*
  Network: fail loudly rather than silently reaching the internet.

  A test that needs HTTP should stub fetch itself. Anything that doesn't gets a rejection
  naming the URL, so an accidental production call shows up as a failure instead of
  quietly succeeding.
*/
const unmockedFetch = vi.fn((input) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  return Promise.reject(new Error(`Unmocked network request in test: ${url}`));
});

/*
  Process-level caches must not leak between tests.

  eventCache is a module singleton, so without this a lookup cached by one test satisfies
  the next one and its fetch is never called — which is exactly how a test asserting "one
  live event" received two simulated events left over from an earlier case.
*/
beforeEach(() => {
  // Server-side suites (providers, services) declare `@vitest-environment node`, where
  // there is no window. Guarding here keeps one shared setup file working for both
  // environments; without it a node-environment suite fails on the first line of every
  // test for a reason that has nothing to do with what it is testing.
  if (typeof window !== 'undefined') {
    window.localStorage.clear();
    // The discovery page now caches events per destination in sessionStorage. jsdom keeps
    // it for the whole file, so without this a search cached by one test would satisfy the
    // next one and its fetch would never be called.
    window.sessionStorage.clear();
  }
  globalThis.fetch = unmockedFetch;
  unmockedFetch.mockClear();
  eventCache.clear();
  quoteCache.clear();
  flightSearchCache.clear();
  // Limiters are memoised per provider key at module scope; a spent budget would
  // otherwise make a later test wait on a limit an earlier one consumed.
  resetLimiters();
});

// Mock Leaflet
const mockMap = {
  setView: vi.fn().mockReturnThis(),
  fitBounds: vi.fn().mockReturnThis(),
  remove: vi.fn(),
  off: vi.fn(),
};

const mockLayer = {
  addTo: vi.fn().mockReturnThis(),
  setUrl: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

const mockMarker = {
  addTo: vi.fn().mockReturnThis(),
  setLatLng: vi.fn().mockReturnThis(),
  setIcon: vi.fn().mockReturnThis(),
  bindTooltip: vi.fn().mockReturnThis(),
  setTooltipContent: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

const mockPolyline = {
  addTo: vi.fn().mockReturnThis(),
  setLatLngs: vi.fn().mockReturnThis(),
  setStyle: vi.fn().mockReturnThis(),
  remove: vi.fn(),
};

vi.mock('leaflet', () => ({
  default: {
    map: vi.fn(() => mockMap),
    tileLayer: vi.fn(() => mockLayer),
    marker: vi.fn(() => mockMarker),
    polyline: vi.fn(() => mockPolyline),
    divIcon: vi.fn((options) => options),
    latLngBounds: vi.fn((bounds) => bounds),
    control: {
      zoom: vi.fn(() => mockLayer)
    }
  }
}));

class DummyGeodesicLine {
  constructor() {
    return mockPolyline;
  }
}

vi.mock('leaflet.geodesic', () => ({
  GeodesicLine: DummyGeodesicLine,
}));

// Mock Chart.js
vi.mock('chart.js', () => ({
  Chart: {
    register: vi.fn(),
  },
  CategoryScale: vi.fn(),
  LinearScale: vi.fn(),
  PointElement: vi.fn(),
  LineElement: vi.fn(),
  Title: vi.fn(),
  Tooltip: vi.fn(),
  Legend: vi.fn(),
  Filler: vi.fn(),
}));

// Mock react-chartjs-2
vi.mock('react-chartjs-2', () => ({
  Line: ({ data, options }) => {
    return React.createElement(
      'div',
      { 'data-testid': 'mock-line-chart' },
      `Mock Chart.js Line Chart (datapoints: ${data.datasets[0].data.length})`
    );
  },
}));

/*
  Quieten only the app's own deliberate offline-fallback notices.

  This filter used to be much broader — it swallowed 'Failed to load', 'Failed to save',
  'fetch failed', 'ECONNREFUSED' and 'invalid input syntax for type uuid'. Those messages
  were real: the tests were genuinely failing to reach production Supabase. Hiding them
  removed the evidence without fixing the cause, and any genuine bug whose message
  happened to contain 'Failed to load' would have been invisible too.

  With Supabase nulled and fetch stubbed above, those messages no longer occur. What's
  left is the app logging that it fell back to local simulation, which is the expected
  path under test and is safe to mute. Everything else reaches the console.
*/
const EXPECTED_FALLBACK_NOTICES = [
  'sticking with local simulation defaults',
  'falling back to local simulation',
  'Event intelligence service unavailable',
  'Could not upgrade estimate'
];

const originalWarn = console.warn;

console.warn = (...args) => {
  const text = args
    .map((a) => (typeof a === 'string' ? a : a?.message || String(a)))
    .join(' ');

  if (EXPECTED_FALLBACK_NOTICES.some((notice) => text.includes(notice))) return;

  originalWarn(...args);
};


