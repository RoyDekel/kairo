import { describe, test, expect, vi, beforeEach } from 'vitest';
import { TicketmasterService } from '../../../server/services/ticketmasterService.js';
import { AIRPORTS } from '../../../shared/catalog.js';

/**
 * Regressions found in production Render logs.
 *
 * 1. ticketmasterService kept a private 11-airport map and defaulted anything unknown to
 *    `countryCode: 'FR'`, so 21 of the 32 catalog destinations were querying events in
 *    France. The logs gave it away: mapped destinations printed a city name
 *    ("for Barcelona"), unmapped ones printed a bare code ("for DUB").
 *
 * 2. When the requested travel window returned nothing, a second query refetched with no
 *    date filter at all. Those events rendered under "While you're there" despite being
 *    outside the trip.
 */

const serviceWithKey = (apiKey = 'test-key') => {
  const service = new TicketmasterService();
  service.apiKey = apiKey;
  return service;
};

const emptyResponse = () => ({ ok: true, json: async () => ({ _embedded: { events: [] } }) });

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
    await serviceWithKey().getEventsForDestination(code, '2026-08-10', '2026-08-20');

    const params = lastRequestUrl().searchParams;
    expect(params.get('countryCode')).toBe(countryCode);
    expect(params.get('city')).toBe(city);
  });

  test('the destination city is sent, so results are not country-wide', async () => {
    await serviceWithKey().getEventsForDestination('BCN', '2026-08-10', '2026-08-20');
    expect(lastRequestUrl().searchParams.get('city')).toBe('Barcelona');
  });

  test('two cities in one country produce different queries', async () => {
    const service = serviceWithKey();

    await service.getEventsForDestination('MUC', '2026-08-10', '2026-08-20');
    const munich = lastRequestUrl().searchParams.get('city');

    await service.getEventsForDestination('BER', '2026-08-10', '2026-08-20');
    const berlin = lastRequestUrl().searchParams.get('city');

    expect(munich).toBe('Munich');
    expect(berlin).toBe('Berlin');
    expect(munich).not.toBe(berlin);
  });

  test('an unknown airport returns nothing instead of the wrong country', async () => {
    const events = await serviceWithKey().getEventsForDestination('ZZZ', '2026-08-10', '2026-08-20');

    expect(events).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('travel-window honesty', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(emptyResponse());
  });

  test('an empty travel window returns no events', async () => {
    const events = await serviceWithKey().getEventsForDestination('PRG', '2026-08-10', '2026-08-20');
    expect(events).toEqual([]);
  });

  test('does NOT retry without a date filter when the window is empty', async () => {
    await serviceWithKey().getEventsForDestination('PRG', '2026-08-10', '2026-08-20');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    for (const [url] of globalThis.fetch.mock.calls) {
      const params = new URL(url).searchParams;
      expect(params.get('startDateTime')).toBeTruthy();
      expect(params.get('endDateTime')).toBeTruthy();
    }
  });

  test('the requested window is passed through to the API', async () => {
    await serviceWithKey().getEventsForDestination('KRK', '2026-08-11', '2026-08-16');

    const params = lastRequestUrl().searchParams;
    expect(params.get('startDateTime')).toContain('2026-08-11');
    expect(params.get('endDateTime')).toContain('2026-08-16');
  });

  test('simulated events are still used when the API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const events = await serviceWithKey().getEventsForDestination('BCN', '2026-08-10', '2026-08-20');

    // A transport failure is different from an empty window: we degrade rather than
    // claim the destination has nothing on.
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => !e.isLiveApi)).toBe(true);
  });
});
