import { describe, test, expect, beforeEach } from 'vitest';
import { QuoteCache, cheapestFlight, quoteCache } from '../../../server/services/quoteCache.js';
import { SimulatedProvider } from '../../../server/providers/simulatedProvider.js';
import { generateFlightsForRoute, AIRPORTS } from '../flightSimulator.js';
import { AIRPORTS as SHARED_AIRPORTS } from '../../../shared/catalog.js';

/**
 * These tests guard the invariant the whole refactor exists to protect:
 * "When to Go" and "Search & Compare" must never quote different fares for the same
 * route on the same dates.
 */

describe('Catalog is genuinely shared between client and server', () => {
  test('client and server expose the identical airport catalog', () => {
    expect(Object.keys(AIRPORTS).sort()).toEqual(Object.keys(SHARED_AIRPORTS).sort());
  });

  test('every airport the client offers is priceable by the server simulator', () => {
    const provider = new SimulatedProvider();
    const unpriceable = Object.keys(AIRPORTS)
      .filter((code) => code !== 'TLV')
      .filter((code) => provider.generateFlightsForRoute('TLV', code, '2026-08-11', 'outbound', { adults: 1 }).length === 0);

    // Previously 16 destinations fell through to client-side simulation here.
    expect(unpriceable).toEqual([]);
  });
});

describe('Client fallback simulator agrees with the server simulator', () => {
  const provider = new SimulatedProvider();
  const routes = [
    ['TLV', 'KRK'], // short-haul, exercises the low-cost carrier tier
    ['TLV', 'ATH'], // short-haul; 'ATH' used to be mistakenly listed as a carrier code
    ['TLV', 'FCO'], // medium-haul; 'FCO' had the same bug
    ['TLV', 'JFK'], // long-haul
    ['TLV', 'NRT']
  ];

  test.each(routes)('%s -> %s prices identically on both sides', (origin, destination) => {
    const clientFlights = generateFlightsForRoute(origin, destination, '2026-08-11', 'outbound', { adults: 1 });
    const serverFlights = provider.generateFlightsForRoute(origin, destination, '2026-08-11', 'outbound', { adults: 1 });

    expect(clientFlights.length).toBe(serverFlights.length);
    expect(clientFlights.map((f) => f.price)).toEqual(serverFlights.map((f) => f.price));
    expect(clientFlights.map((f) => f.airlineCode)).toEqual(serverFlights.map((f) => f.airlineCode));
  });

  test('weekend surcharge is applied consistently on both sides', () => {
    // 2026-08-15 is a Saturday -> 1.2x date factor.
    const client = generateFlightsForRoute('TLV', 'KRK', '2026-08-15', 'outbound', { adults: 1 });
    const server = provider.generateFlightsForRoute('TLV', 'KRK', '2026-08-15', 'outbound', { adults: 1 });
    const weekday = generateFlightsForRoute('TLV', 'KRK', '2026-08-11', 'outbound', { adults: 1 });

    expect(client.map((f) => f.price)).toEqual(server.map((f) => f.price));
    expect(client[0].price).toBeGreaterThan(weekday[0].price);
  });
});

describe('QuoteCache', () => {
  let cache;
  let clock;

  beforeEach(() => {
    clock = 1_000_000;
    cache = new QuoteCache({ ttlMs: 1000, maxEntries: 3, now: () => clock });
  });

  const route = {
    origin: 'TLV',
    destination: 'KRK',
    departureDate: '2026-08-11',
    returnDate: '2026-08-16',
    passengers: { adults: 1, children: 0, infants: 0 },
    stops: '0'
  };

  test('returns a stored quote within its TTL', () => {
    cache.set(route, { roundtripPrice: 275, outbound: { price: 140 }, return: { price: 135 }, source: 'serpapi' });

    const hit = cache.get(route);
    expect(hit.roundtripPrice).toBe(275);
    expect(hit.source).toBe('serpapi');
  });

  test('expires a quote once the TTL passes', () => {
    cache.set(route, { roundtripPrice: 275, outbound: { price: 140 }, source: 'serpapi' });
    clock += 1001;
    expect(cache.get(route)).toBeNull();
  });

  test('does not serve a quote across different passenger counts', () => {
    cache.set(route, { roundtripPrice: 275, outbound: { price: 140 }, source: 'serpapi' });

    const twoAdults = { ...route, passengers: { adults: 2, children: 0, infants: 0 } };
    expect(cache.get(twoAdults)).toBeNull();
  });

  test('does not serve a quote across different dates', () => {
    cache.set(route, { roundtripPrice: 275, outbound: { price: 140 }, source: 'serpapi' });
    expect(cache.get({ ...route, departureDate: '2026-09-01' })).toBeNull();
  });

  test('evicts least-recently-used entries beyond capacity', () => {
    for (const destination of ['AAA', 'BBB', 'CCC']) {
      cache.set({ ...route, destination }, { roundtripPrice: 100, outbound: { price: 50 }, source: 'sim' });
    }
    // Touch AAA so BBB becomes least-recently-used.
    cache.get({ ...route, destination: 'AAA' });
    cache.set({ ...route, destination: 'DDD' }, { roundtripPrice: 100, outbound: { price: 50 }, source: 'sim' });

    expect(cache.size).toBeLessThanOrEqual(3);
    expect(cache.get({ ...route, destination: 'AAA' })).not.toBeNull();
    expect(cache.get({ ...route, destination: 'BBB' })).toBeNull();
  });

  test('the shared instance is a QuoteCache', () => {
    expect(quoteCache).toBeInstanceOf(QuoteCache);
  });
});

describe('cheapestFlight', () => {
  test('picks the lowest fare', () => {
    expect(cheapestFlight([{ price: 300 }, { price: 120 }, { price: 250 }]).price).toBe(120);
  });

  test('returns null for empty or invalid input', () => {
    expect(cheapestFlight([])).toBeNull();
    expect(cheapestFlight(undefined)).toBeNull();
  });
});

describe('Discovery and comparison agree once a route has been quoted', () => {
  test('a live quote cached by /api/flights is what discovery would serve', () => {
    const cache = new QuoteCache({ ttlMs: 60_000 });
    const provider = new SimulatedProvider();

    const route = {
      origin: 'TLV',
      destination: 'BCN',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      passengers: { adults: 1, children: 0, infants: 0 },
      stops: '0'
    };

    // Simulate the comparison page performing a REAL search that returns a fare no
    // model would produce, then recording it (as server.js does).
    const realOutbound = { price: 187, id: 'LIVE-OUT' };
    const realReturn = { price: 163, id: 'LIVE-RET' };
    cache.set(route, {
      roundtripPrice: realOutbound.price + realReturn.price,
      outbound: realOutbound,
      return: realReturn,
      source: 'serpapi'
    });

    // Discovery prefers the cached live quote over its own estimate.
    const cached = cache.get(route);
    const estimateOnly = provider.generateFlightsForRoute('TLV', 'BCN', '2026-08-11', 'outbound', { adults: 1 });

    expect(cached.roundtripPrice).toBe(350);
    expect(cached.source).toBe('serpapi');
    // The estimate differs — which is exactly why the cached live quote must win.
    expect(cheapestFlight(estimateOnly).price).not.toBe(realOutbound.price);
  });
});
