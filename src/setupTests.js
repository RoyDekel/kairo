import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';
import React from 'react';

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
  Network: fail loudly rather than silently reaching the internet.

  A test that needs HTTP should stub fetch itself. Anything that doesn't gets a rejection
  naming the URL, so an accidental production call shows up as a failure instead of
  quietly succeeding.
*/
const unmockedFetch = vi.fn((input) => {
  const url = typeof input === 'string' ? input : input?.url || String(input);
  return Promise.reject(new Error(`Unmocked network request in test: ${url}`));
});

// Clear localStorage and reset the network guard between runs
beforeEach(() => {
  window.localStorage.clear();
  globalThis.fetch = unmockedFetch;
  unmockedFetch.mockClear();
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


