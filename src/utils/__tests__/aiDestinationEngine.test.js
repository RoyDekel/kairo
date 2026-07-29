import { describe, test, expect, vi, afterEach } from 'vitest';
import { searchAIDestinations, DiscoveryUnavailableError } from '../aiDestinationEngine';

const origFetch = global.fetch;

afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
});

const makeFlight = (origin, destination, price, direction) => ({
  id: `${origin}-${destination}-${direction}`,
  flightNumber: 'XX 100',
  airlineCode: 'LO',
  airlineName: 'LOT Polish Airlines',
  price,
  passengerCosts: { adults: price, children: 0, infants: 0, total: price },
  origin,
  destination,
  direction
});

/**
 * Mocks both backend calls the engine makes:
 *   GET /api/flights/estimates  -> per-destination pricing
 *   GET /api/events/batch       -> per-destination events
 */
const mockBackend = ({ events = [], price = 300, source = 'estimate', destinations = null } = {}) => {
  global.fetch = vi.fn().mockImplementation(async (url) => {
    const parsed = new URL(url, 'http://localhost');

    if (parsed.pathname.endsWith('/api/flights/estimates')) {
      const origin = parsed.searchParams.get('origin');
      const codes = destinations || ['KRK', 'BCN', 'CDG'];
      const estimates = {};
      for (const code of codes) {
        estimates[code] = {
          destination: code,
          roundtripPrice: price,
          outbound: makeFlight(origin, code, price / 2, 'outbound'),
          return: makeFlight(code, origin, price / 2, 'return'),
          source,
          provider: source === 'live' ? 'serpapi' : 'simulated',
          quotedAt: source === 'live' ? '2026-07-29T10:00:00.000Z' : null
        };
      }
      return { ok: true, status: 200, json: async () => ({ estimates }) };
    }

    if (parsed.pathname.endsWith('/api/events/batch')) {
      const requested = parsed.searchParams.get('destinations') || '';
      const eventsByDestination = {};
      for (const code of requested.split(',').filter(Boolean)) {
        eventsByDestination[code] = events;
      }
      return { ok: true, status: 200, json: async () => ({ eventsByDestination }) };
    }

    throw new Error(`Unexpected fetch to ${url}`);
  });
};

const sampleEvents = [
  { id: 'tm-1', title: 'Van Gogh & Vincent', category: 'Arts', venue: 'Bracka 13', date: '2026-08-12', priceEstimate: '$45 - $180' },
  { id: 'tm-2', title: 'Van Gogh & Vincent', category: 'Arts', venue: 'Bracka 13', date: '2026-08-12', priceEstimate: '$45 - $180' },
  { id: 'tm-3', title: 'Muzeum Banksy', category: 'Arts', venue: 'Muzeum Banksy', date: '2026-08-13', priceEstimate: '$45 - $180' }
];

const baseQuery = {
  origin: 'TLV',
  departureDate: '2026-08-11',
  returnDate: '2026-08-16',
  maxBudget: 1500,
  interests: ['culture', 'festivals']
};

describe('AI Destination Intelligence Engine', () => {
  test('returns empty array when the backend reports 0 events for the date range', async () => {
    mockBackend({ events: [] });

    const results = await searchAIDestinations({ ...baseQuery, interests: ['music', 'sports'] });

    expect(results).toEqual([]);
  });

  test('strictly enforces 1 unique result per event title and omits descriptions/times', async () => {
    mockBackend({ events: sampleEvents });

    const results = await searchAIDestinations(baseQuery);

    expect(results.length).toBeGreaterThan(0);
    const events = results[0].matchedEvents;

    expect(events.length).toBe(2);
    expect(events[0].title).toBe('Van Gogh & Vincent');
    expect(events[1].title).toBe('Muzeum Banksy');

    expect(events[0].timeFrame).toBeUndefined();
    expect(events[0].description).toBeUndefined();
    expect(events[0].venue).toBe('Bracka 13');
  });

  test('prices come from the backend, never from a local pricing algorithm', async () => {
    // A price no local formula would produce for these routes.
    mockBackend({ events: sampleEvents, price: 1234 });

    const results = await searchAIDestinations(baseQuery);

    expect(results.length).toBeGreaterThan(0);
    for (const rec of results) {
      expect(rec.roundtripPrice).toBe(1234);
    }
  });

  test('makes exactly two backend calls: pricing then events', async () => {
    mockBackend({ events: sampleEvents });

    await searchAIDestinations(baseQuery);

    const paths = global.fetch.mock.calls.map(([url]) => new URL(url, 'http://localhost').pathname);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('/api/flights/estimates');
    expect(paths[1]).toContain('/api/events/batch');
  });

  test('propagates the price source so the UI can label estimates honestly', async () => {
    mockBackend({ events: sampleEvents, source: 'live' });
    const live = await searchAIDestinations(baseQuery);
    expect(live[0].priceSource).toBe('live');
    expect(live[0].aiInsight).toContain('Live fare');

    mockBackend({ events: sampleEvents, source: 'estimate' });
    const estimated = await searchAIDestinations(baseQuery);
    expect(estimated[0].priceSource).toBe('estimate');
    expect(estimated[0].aiInsight).toContain('Estimated fare');
  });

  test('applies the budget filter against backend prices', async () => {
    mockBackend({ events: sampleEvents, price: 900 });

    const withinBudget = await searchAIDestinations({ ...baseQuery, maxBudget: 1000 });
    expect(withinBudget.length).toBeGreaterThan(0);

    const overBudget = await searchAIDestinations({ ...baseQuery, maxBudget: 500 });
    expect(overBudget).toEqual([]);
  });

  test('only requests events for destinations that survived the budget filter', async () => {
    mockBackend({ events: sampleEvents, price: 400, destinations: ['KRK', 'BCN'] });

    await searchAIDestinations({ ...baseQuery, maxBudget: 1000 });

    const eventsCall = global.fetch.mock.calls.find(([url]) => String(url).includes('/api/events/batch'));
    const requested = new URL(eventsCall[0], 'http://localhost').searchParams.get('destinations');
    expect(requested.split(',').sort()).toEqual(['BCN', 'KRK']);
  });

  test('never sends a Ticketmaster API key from the client', async () => {
    mockBackend({ events: [] });

    await searchAIDestinations(baseQuery);

    for (const [requestedUrl, requestInit] of global.fetch.mock.calls) {
      expect(requestedUrl).not.toMatch(/apikey/i);
      expect(requestedUrl).not.toContain('ticketmaster.com');
      expect(JSON.stringify(requestInit?.headers || {})).not.toMatch(/apikey/i);
    }
  });

  test('throws DiscoveryUnavailableError when the pricing service is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(searchAIDestinations(baseQuery)).rejects.toBeInstanceOf(DiscoveryUnavailableError);
  });

  test('throws DiscoveryUnavailableError on a non-OK pricing response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(searchAIDestinations(baseQuery)).rejects.toBeInstanceOf(DiscoveryUnavailableError);
  });
});
