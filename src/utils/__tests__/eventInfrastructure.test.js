import { describe, test, expect, vi, beforeEach } from 'vitest';
import { RateLimiter, PROVIDER_LIMITS } from '../../../server/services/rateLimiter.js';
import { EventCache, EventStatus } from '../../../server/services/eventCache.js';
import { TtlCache } from '../../../server/services/ttlCache.js';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { TicketmasterProvider } from '../../../server/providers/ticketmasterProvider.js';

/**
 * Stage 1 infrastructure for multi-provider event lookups.
 *
 * The Render logs showed all ~31 destinations resolving in the same second against a
 * documented 5/second budget, with nine consecutive "0 events" lines. Because a non-200
 * response was read as an empty result, those were indistinguishable from cities that
 * genuinely had nothing on — and after the undated fallback was removed they disappeared
 * from the discovery page entirely.
 */

/** A limiter whose clock and sleep are controlled, so tests don't wait in real time. */
const makeTestLimiter = ({ limit, windowMs }) => {
  let clock = 0;
  const limiter = new RateLimiter({
    limit,
    windowMs,
    name: 'test',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    }
  });
  return { limiter, advance: (ms) => { clock += ms; }, clockNow: () => clock };
};

/** A limiter that never delays, for tests not about pacing. */
const instantLimiter = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'instant' });

describe('RateLimiter', () => {
  test('allows calls up to the limit without waiting', async () => {
    const { limiter, clockNow } = makeTestLimiter({ limit: 5, windowMs: 1000 });

    for (let i = 0; i < 5; i++) await limiter.acquire();

    expect(clockNow()).toBe(0);
    expect(limiter.used).toBe(5);
  });

  test('delays the call that would exceed the limit', async () => {
    const { limiter, clockNow } = makeTestLimiter({ limit: 5, windowMs: 1000 });

    for (let i = 0; i < 5; i++) await limiter.acquire();
    expect(clockNow()).toBe(0);

    await limiter.acquire();
    expect(clockNow()).toBeGreaterThanOrEqual(1000);
  });

  test('paces a 31-destination fan-out within the documented budget', async () => {
    const { limiter, clockNow } = makeTestLimiter({ limit: 5, windowMs: 1000 });

    const timestamps = [];
    await Promise.all(
      Array.from({ length: 31 }, () =>
        limiter.acquire().then(() => timestamps.push(clockNow()))
      )
    );

    expect(timestamps).toHaveLength(31);

    // No 1-second window ever contains more than 5 calls.
    for (const t of timestamps) {
      const inWindow = timestamps.filter((other) => other >= t && other < t + 1000);
      expect(inWindow.length).toBeLessThanOrEqual(5);
    }
  });

  test('frees capacity again once the window rolls over', async () => {
    const { limiter, advance } = makeTestLimiter({ limit: 5, windowMs: 1000 });

    for (let i = 0; i < 5; i++) await limiter.acquire();
    expect(limiter.msUntilAvailable()).toBeGreaterThan(0);

    advance(1001);
    expect(limiter.msUntilAvailable()).toBe(0);
    expect(limiter.used).toBe(0);
  });

  test('schedule runs the function after acquiring a token', async () => {
    const limiter = instantLimiter();
    await expect(limiter.schedule(async () => 'done')).resolves.toBe('done');
  });

  test('documented provider limits match the published free tiers', () => {
    // Ticketmaster Discovery: 5 requests/second.
    expect(PROVIDER_LIMITS.ticketmaster).toMatchObject({ limit: 5, windowMs: 1000 });
    // TheSportsDB free: 30 requests/minute.
    expect(PROVIDER_LIMITS.thesportsdb).toMatchObject({ limit: 30, windowMs: 60_000 });
    // API-Sports free: 10 requests/minute (and 100/day, which is the binding constraint).
    expect(PROVIDER_LIMITS.apisports).toMatchObject({ limit: 10, windowMs: 60_000 });
  });

  test('rejects a misconfigured limiter rather than running unbounded', () => {
    expect(() => new RateLimiter({ limit: 5 })).toThrow();
    expect(() => new RateLimiter({ windowMs: 1000 })).toThrow();
  });
});

describe('TtlCache', () => {
  let clock;
  const make = (opts) => new TtlCache({ now: () => clock, ...opts });

  beforeEach(() => {
    clock = 1_000_000;
  });

  test('returns a stored value inside the TTL and null after it', () => {
    const cache = make({ ttlMs: 1000 });
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');

    clock += 1001;
    expect(cache.get('k')).toBeNull();
  });

  test('evicts the least recently used entry at capacity', () => {
    const cache = make({ ttlMs: 10_000, maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // 'b' is now least recently used
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).toBe(3);
  });

  test('refuses to construct without a TTL', () => {
    expect(() => new TtlCache({})).toThrow();
  });
});

describe('EventCache', () => {
  let clock;
  const key = { destination: 'BCN', startDate: '2026-08-11', endDate: '2026-08-16', provider: 'ticketmaster' };

  const make = () => new EventCache({ ttlMs: 60_000, failureTtlMs: 1_000, now: () => clock });

  beforeEach(() => {
    clock = 1_000_000;
  });

  test('caches a successful lookup for the full TTL', () => {
    const cache = make();
    cache.set(key, { status: EventStatus.OK, events: [{ title: 'x' }] });

    clock += 59_000;
    expect(cache.get(key).status).toBe(EventStatus.OK);
  });

  /*
    An unavailable result must expire quickly. Holding a throttled destination for the
    full six-hour TTL would hide it from the discovery page for the rest of the day.
  */
  test('expires an unavailable result far sooner than a successful one', () => {
    const cache = make();
    cache.set(key, { status: EventStatus.UNAVAILABLE, events: [], reason: 'rate-limited' });

    expect(cache.get(key).status).toBe(EventStatus.UNAVAILABLE);
    clock += 1_001;
    expect(cache.get(key)).toBeNull();
  });

  test('an empty window is cached like a success, because it is an answer', () => {
    const cache = make();
    cache.set(key, { status: EventStatus.EMPTY, events: [] });

    clock += 59_000;
    expect(cache.get(key).status).toBe(EventStatus.EMPTY);
  });

  test('keys separate destinations and date windows', () => {
    const cache = make();
    cache.set(key, { status: EventStatus.OK, events: [{ title: 'bcn' }] });

    expect(cache.get({ ...key, destination: 'MAD' })).toBeNull();
    expect(cache.get({ ...key, startDate: '2026-09-01' })).toBeNull();
  });
});

describe('EventSearchService lookup outcomes', () => {
  const freshService = (apiKey = 'test-key') =>
    new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey, limiter: instantLimiter() })],
      cache: new EventCache({ ttlMs: 60_000, failureTtlMs: 1_000 })
    });

  // Kept as a no-op shim so the assertions below stay readable after the refactor.
  const withKey = (service) => service;

  test('429 reports unavailable, not empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const result = await withKey(freshService()).fetchEvents('BCN', '2026-08-11', '2026-08-16');

    expect(result.status).toBe(EventStatus.UNAVAILABLE);
    expect(result.reason).toBe('rate-limited');
    expect(result.events).toEqual([]);
  });

  test('a 500 reports unavailable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await withKey(freshService()).fetchEvents('BCN', '2026-08-11', '2026-08-16');
    expect(result.status).toBe(EventStatus.UNAVAILABLE);
    expect(result.reason).toBe('http-500');
  });

  test('a transport failure reports unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const result = await withKey(freshService()).fetchEvents('BCN', '2026-08-11', '2026-08-16');
    expect(result.status).toBe(EventStatus.UNAVAILABLE);
    expect(result.reason).toBe('transport-error');
  });

  test('a genuinely empty window reports empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ _embedded: { events: [] } })
    });

    const result = await withKey(freshService()).fetchEvents('BCN', '2026-08-11', '2026-08-16');
    expect(result.status).toBe(EventStatus.EMPTY);
    expect(result.events).toEqual([]);
  });

  test('events found report ok', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'e1',
              name: 'Primavera Sound',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'Parc del Fòrum' }] },
              dates: { start: { localDate: '2026-08-12' } },
              priceRanges: [{ min: 85, max: 240 }]
            }
          ]
        }
      })
    });

    const result = await withKey(freshService()).fetchEvents('BCN', '2026-08-11', '2026-08-16');
    expect(result.status).toBe(EventStatus.OK);
    expect(result.events).toHaveLength(1);
  });

  test('a second identical lookup is served from cache without another request', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ _embedded: { events: [] } })
    });

    const service = withKey(freshService());
    await service.fetchEvents('BCN', '2026-08-11', '2026-08-16');
    const second = await service.fetchEvents('BCN', '2026-08-11', '2026-08-16');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(second.cached).toBe(true);
  });

  test('a different date window is not served from cache', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ _embedded: { events: [] } })
    });

    const service = withKey(freshService());
    await service.fetchEvents('BCN', '2026-08-11', '2026-08-16');
    await service.fetchEvents('BCN', '2026-09-01', '2026-09-05');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('outbound calls go through the limiter', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ _embedded: { events: [] } })
    });

    const limiter = instantLimiter();
    const spy = vi.spyOn(limiter, 'schedule');
    const service = new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey: 'test-key', limiter })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    await service.fetchEvents('BCN', '2026-08-11', '2026-08-16');
    expect(spy).toHaveBeenCalled();
  });

  test('the array form still works but collapses empty and unavailable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const events = await withKey(freshService()).getEventsForDestination('BCN', '2026-08-11', '2026-08-16');
    expect(events).toEqual([]);
  });
});
