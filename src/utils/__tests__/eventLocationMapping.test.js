import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { TicketmasterProvider } from '../../../server/providers/ticketmasterProvider.js';
import { SimulatedEventProvider } from '../../../server/providers/simulatedEventProvider.js';
import { EventCache } from '../../../server/services/eventCache.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';
import { AIRPORTS } from '../../../shared/catalog.js';

/**
 * Regressions found in production Render logs.
 *
 * 1. The event lookup kept a private 11-airport location map and defaulted anything
 *    unknown to `countryCode: 'FR'`, so 21 of the 32 catalog destinations were querying
 *    events in France. The logs gave it away: mapped destinations printed a city name
 *    ("for Barcelona"), unmapped ones printed a bare code ("for DUB").
 *
 * 2. When the requested travel window returned nothing, a second query refetched with no
 *    date filter at all. Those events rendered under "While you're there" despite being
 *    outside the trip.
 */

const instantLimiter = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'instant' });

/** A service with one live Ticketmaster provider and a fresh cache. */
const makeService = ({ apiKey = 'test-key' } = {}) =>
  new EventSearchService({
    providers: [new TicketmasterProvider({ apiKey, limiter: instantLimiter() })],
    cache: new EventCache({ ttlMs: 60_000 })
  });

const emptyResponse = () => ({ ok: true, status: 200, json: async () => ({ _embedded: { events: [] } }) });

const lastRequestUrl = () => new URL(globalThis.fetch.mock.calls.at(-1)[0]);

describe('destination location mapping', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(emptyResponse());
  });

  test('every catalog airport carries a countryCode', () => {
    const missing = Object.values(AIRPORTS)
      .filter((a) => !a.countryCode)
      .map((a) => a.code);

    expect(missing).toEqual([]);
  });

  test('countryCodes are plausible ISO 3166-1 alpha-2 values', () => {
    for (const airport of Object.values(AIRPORTS)) {
      expect(airport.countryCode).toMatch(/^[A-Z]{2}$/);
    }
  });

  test.each([
    ['DUB', 'IE', 'Dublin'],
    ['ATH', 'GR', 'Athens'],
    ['CPH', 'DK', 'Copenhagen'],
    ['EDI', 'GB', 'Edinburgh'],
    ['DXB', 'AE', 'Dubai'],
    ['MXP', 'IT', 'Milan'],
    ['LIS', 'PT', 'Lisbon'],
    ['ZRH', 'CH', 'Zurich'],
    ['VIE', 'AT', 'Vienna'],
    ['PRG', 'CZ', 'Prague'],
    ['BUD', 'HU', 'Budapest'],
    ['MAD', 'ES', 'Madrid']
  ])('%s queries %s/%s, not France', async (code, countryCode, city) => {
    await makeService().fetchEvents(code, '2026-08-10', '2026-08-20');

    const params = lastRequestUrl().searchParams;
    expect(params.get('countryCode')).toBe(countryCode);
    expect(params.get('city')).toBe(city);
  });

  test('the destination city is sent, so results are not country-wide', async () => {
    await makeService().fetchEvents('BCN', '2026-08-10', '2026-08-20');
    expect(lastRequestUrl().searchParams.get('city')).toBe('Barcelona');
  });

  test('two cities in one country produce different queries', async () => {
    const service = makeService();

    await service.fetchEvents('MUC', '2026-08-10', '2026-08-20');
    const munich = lastRequestUrl().searchParams.get('city');

    await service.fetchEvents('BER', '2026-08-10', '2026-08-20');
    const berlin = lastRequestUrl().searchParams.get('city');

    expect(munich).toBe('Munich');
    expect(berlin).toBe('Berlin');
    expect(munich).not.toBe(berlin);
  });

  test('an unknown airport returns nothing instead of the wrong country', async () => {
    const result = await makeService().fetchEvents('ZZZ', '2026-08-10', '2026-08-20');

    expect(result.events).toEqual([]);
    expect(result.reason).toBe('unmapped-airport');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('resolveLocation reads straight from the shared catalog', () => {
    expect(EventSearchService.resolveLocation('DUB')).toMatchObject({ city: 'Dublin', countryCode: 'IE' });
    expect(EventSearchService.resolveLocation('ZZZ')).toBeNull();
  });
});

describe('travel-window honesty', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(emptyResponse());
  });

  test('an empty travel window returns no events', async () => {
    const result = await makeService().fetchEvents('PRG', '2026-08-10', '2026-08-20');
    expect(result.status).toBe('empty');
    expect(result.events).toEqual([]);
  });

  test('does NOT retry without a date filter when the window is empty', async () => {
    await makeService().fetchEvents('PRG', '2026-08-10', '2026-08-20');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    for (const [url] of globalThis.fetch.mock.calls) {
      const params = new URL(url).searchParams;
      expect(params.get('startDateTime')).toBeTruthy();
      expect(params.get('endDateTime')).toBeTruthy();
    }
  });

  test('the requested window is passed through to the API', async () => {
    await makeService().fetchEvents('KRK', '2026-08-11', '2026-08-16');

    const params = lastRequestUrl().searchParams;
    expect(params.get('startDateTime')).toContain('2026-08-11');
    expect(params.get('endDateTime')).toContain('2026-08-16');
  });

  test('an unreachable API is reported as unavailable, not as an empty window', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const result = await makeService().fetchEvents('BCN', '2026-08-10', '2026-08-20');

    // A transport failure is different from an empty window. Both used to produce an
    // empty array, so the discovery page dropped the destination either way — once
    // correctly, once while implying we had checked.
    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
  });

  test('with no credential the provider is dropped and simulation is used', async () => {
    // Mirrors local development without an API key: nobody is being misled.
    const service = new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey: '', limiter: instantLimiter() })],
      cache: new EventCache({ ttlMs: 60_000 })
    });

    expect(service.providerKeys).toEqual([SimulatedEventProvider.key]);

    const result = await service.fetchEvents('BCN', '2026-08-10', '2026-08-20');
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e) => !e.isLiveApi)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
