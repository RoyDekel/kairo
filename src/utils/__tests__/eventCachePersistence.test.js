import { describe, test, expect, vi, beforeEach } from 'vitest';
import { EventCache, EventStatus, durableTtlMs } from '../../../server/services/eventCache.js';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { TicketmasterProvider } from '../../../server/providers/ticketmasterProvider.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';

/**
 * The durable tier of the event cache.
 *
 * The behaviour under test is the one that only shows up in production: the process dies
 * (Render spins the free tier down after ~15 minutes idle) and the next search for dates
 * the app has ALREADY looked up must not go back to Ticketmaster. A memory-only cache
 * passes every unit test and still fails that.
 */

const instantLimiter = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'instant' });

/** Minimal stand-in for the postgrest chain, backed by a Map so tests can inspect it. */
function fakeSupabase({ failReads = false, failWrites = false } = {}) {
  const rows = new Map();
  const calls = { select: 0, upsert: 0, in: 0 };

  const api = {
    rows,
    calls,
    from() {
      return {
        select() {
          calls.select += 1;
          return {
            eq(_col, key) {
              return {
                async maybeSingle() {
                  if (failReads) return { data: null, error: { message: 'read exploded' } };
                  return { data: rows.get(key) || null, error: null };
                }
              };
            },
            async in(_col, keys) {
              calls.in += 1;
              if (failReads) return { data: null, error: { message: 'read exploded' } };
              return { data: keys.map((k) => rows.get(k)).filter(Boolean), error: null };
            }
          };
        },
        async upsert(row) {
          calls.upsert += 1;
          if (failWrites) return { error: { message: 'write exploded' } };
          rows.set(row.cache_key, row);
          return { error: null };
        }
      };
    }
  };

  return api;
}

describe('EventCache durable tier', () => {
  const key = { destination: 'BCN', startDate: '2026-09-11', endDate: '2026-09-16', provider: 'merged' };
  let clock;

  beforeEach(() => {
    clock = Date.parse('2026-08-01T00:00:00Z');
  });

  const make = (supabase) =>
    new EventCache({ ttlMs: 60_000, failureTtlMs: 1_000, supabase, now: () => clock });

  test('a result written by one process is readable by the next one', async () => {
    const supabase = fakeSupabase();

    const first = make(supabase);
    await first.set(key, { status: EventStatus.OK, events: [{ title: 'Primavera' }] });

    // A different instance: same table, empty memory. This is the cold start.
    const second = make(supabase);
    const hit = await second.get(key);

    expect(hit?.events?.[0]?.title).toBe('Primavera');
  });

  test('an expired durable row is a miss, not a stale answer', async () => {
    const supabase = fakeSupabase();
    await make(supabase).set(key, { status: EventStatus.OK, events: [{ title: 'old' }] });

    /*
      Advance past whatever the ladder actually granted this window rather than past a
      hard-coded duration. This key starts 41 days out, so it earns the top tier — a fixed
      `clock += ttlMs + 1` was reading as "expiry works" while really only testing the
      shortest tier, and it broke the moment the far end was widened.
    */
    clock += durableTtlMs(key.startDate, { ttlMs: 60_000, now: clock }) + 1;
    expect(await make(supabase).get(key)).toBeNull();
  });

  /*
    The whole reason the failure store exists is a fast retry. Persisting a 429 would take
    one throttled process and turn it into a product-wide blackout for every instance
    reading the table.
  */
  test('an unavailable result is never persisted', async () => {
    const supabase = fakeSupabase();
    const cache = make(supabase);

    await cache.set(key, { status: EventStatus.UNAVAILABLE, events: [], reason: 'rate-limited' });

    expect(supabase.calls.upsert).toBe(0);
    expect(await make(supabase).get(key)).toBeNull();
  });

  test('an empty window IS persisted, because it is an answer', async () => {
    const supabase = fakeSupabase();
    await make(supabase).set(key, { status: EventStatus.EMPTY, events: [] });

    expect((await make(supabase).get(key))?.status).toBe(EventStatus.EMPTY);
  });

  /*
    A cache is an optimisation. Every failure mode of the store must degrade to "slower",
    never to "the search failed".
  */
  test('a database failure degrades to a miss rather than throwing', async () => {
    const broken = fakeSupabase({ failReads: true, failWrites: true });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = make(broken);

    await expect(cache.set(key, { status: EventStatus.OK, events: [] })).resolves.toBeDefined();
    await expect(make(broken).get(key)).resolves.toBeNull();
  });

  test('prefetch loads a whole page of destinations in one query', async () => {
    const supabase = fakeSupabase();
    const codes = ['BCN', 'MAD', 'ROM'];

    const writer = make(supabase);
    for (const destination of codes) {
      await writer.set({ ...key, destination }, { status: EventStatus.OK, events: [{ title: destination }] });
    }

    const reader = make(supabase);
    const promoted = await reader.prefetch(codes.map((destination) => ({ ...key, destination })));

    expect(promoted).toBe(3);
    expect(supabase.calls.in).toBe(1);

    // Promoted into memory, so the reads that follow cost nothing.
    const before = supabase.calls.select;
    expect((await reader.get({ ...key, destination: 'MAD' })).events[0].title).toBe('MAD');
    expect(supabase.calls.select).toBe(before);
  });

  test('memory-only construction still works when Supabase is unconfigured', async () => {
    const cache = make(null);
    await cache.set(key, { status: EventStatus.OK, events: [{ title: 'x' }] });

    expect(cache.isPersistent).toBe(false);
    expect((await cache.get(key)).events).toHaveLength(1);
  });
});

/*
  The TTL ladder.

  These assertions are about spend, not about caching mechanics. API-Sports is capped at
  80 calls a day and one cold discovery search fans out across ~31 destinations, so the
  difference between holding a far window for six hours and for three days is the
  difference between the ceiling buying three cold searches a day and buying most of a
  week's worth. Each step is pinned, and so is each boundary, because an off-by-one at a
  boundary silently reverts a tier to four times the traffic.
*/
describe('durableTtlMs', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const HOUR = 60 * 60 * 1000;
  const ttlMs = 6 * HOUR;

  /*
    Inside a couple of days kickoff times move and matches get postponed. Holding such a
    window for six hours in a table every instance reads would broadcast a cancelled
    match, which is a cost the memory-only cache never had.
  */
  test('a window starting within two days is held for an hour at most', () => {
    expect(durableTtlMs('2026-08-02', { ttlMs, now })).toBe(HOUR);
  });

  test('a window two to seven days out keeps the historical six hours', () => {
    expect(durableTtlMs('2026-08-04', { ttlMs, now })).toBe(6 * HOUR);
  });

  test('a window one to four weeks out is held for a day', () => {
    expect(durableTtlMs('2026-08-15', { ttlMs, now })).toBe(24 * HOUR);
  });

  test('a window beyond a month is held for three days', () => {
    expect(durableTtlMs('2026-10-01', { ttlMs, now })).toBe(72 * HOUR);
  });

  /*
    Boundaries, pinned individually. Each one is the moment a tier changes, and getting
    one wrong reverts that whole range to the traffic of the tier below it.
  */
  test.each([
    ['2026-08-03', 6 * HOUR, 'exactly two days out leaves the near tier'],
    ['2026-08-08', 24 * HOUR, 'exactly seven days out enters the daily tier'],
    ['2026-08-31', 72 * HOUR, 'exactly thirty days out enters the three-day tier']
  ])('%s -> %i ms (%s)', (startDate, expected) => {
    expect(durableTtlMs(startDate, { ttlMs, now })).toBe(expected);
  });

  /*
    A start date in the past means a stale or malformed query. It takes the shortest tier
    rather than the longest: whatever produced it should not also earn a three-day row.
  */
  test('a window that already started takes the shortest tier', () => {
    expect(durableTtlMs('2026-07-20', { ttlMs, now })).toBe(HOUR);
  });

  test('an unparseable date falls back to the full TTL rather than NaN', () => {
    expect(durableTtlMs(undefined, { ttlMs, now })).toBe(ttlMs);
  });

  /*
    The ladder is expressed in multiples of the caller's ttlMs, so lowering it lowers
    every tier. If the far tiers were absolute durations, a caller asking for a short TTL
    would still get three-day rows — the opposite of what they asked for.
  */
  test('lowering ttlMs scales the whole ladder down with it', () => {
    const short = HOUR; // caller wants everything cached briefly
    expect(durableTtlMs('2026-10-01', { ttlMs: short, now })).toBe(12 * HOUR);
    expect(durableTtlMs('2026-08-04', { ttlMs: short, now })).toBe(HOUR);
    // The near tier is a correctness floor, so it stays capped regardless.
    expect(durableTtlMs('2026-08-02', { ttlMs: short, now })).toBe(HOUR / 6);
  });
});

describe('EventSearchService with a durable cache', () => {
  const supabaseResponse = (events) => ({
    ok: true,
    status: 200,
    json: async () => ({ _embedded: { events } })
  });

  const ticketmasterEvent = {
    id: 'tm-1',
    name: 'Primavera Sound',
    dates: { start: { localDate: '2026-09-12' } },
    classifications: [{ segment: { name: 'Music' } }],
    _embedded: { venues: [{ name: 'Parc del Forum' }] }
  };

  test('a cold process serves a previously-searched window without calling the provider', async () => {
    const supabase = fakeSupabase();

    const fetchMock = vi.fn().mockResolvedValue(supabaseResponse([ticketmasterEvent]));
    globalThis.fetch = fetchMock;

    const service = () =>
      new EventSearchService({
        providers: [new TicketmasterProvider({ apiKey: 'test-key', limiter: instantLimiter() })],
        cache: new EventCache({ ttlMs: 60_000, supabase })
      });

    const first = await service().fetchEvents('BCN', '2026-09-11', '2026-09-16');
    expect(first.status).toBe(EventStatus.OK);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // New process, empty memory — the situation after a Render spin-down.
    const second = await service().fetchEvents('BCN', '2026-09-11', '2026-09-16');

    expect(second.cached).toBe(true);
    expect(second.events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('warmCache reads every destination in one query before the fan-out', async () => {
    const supabase = fakeSupabase();
    const cache = new EventCache({ ttlMs: 60_000, supabase });

    await cache.set(
      EventSearchService.cacheKeyFor('BCN', '2026-09-11', '2026-09-16'),
      { status: EventStatus.OK, events: [{ title: 'cached' }] }
    );

    const cold = new EventCache({ ttlMs: 60_000, supabase });
    const service = new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey: 'test-key', limiter: instantLimiter() })],
      cache: cold
    });

    const promoted = await service.warmCache(['BCN', 'MAD'], '2026-09-11', '2026-09-16');

    expect(promoted).toBe(1);
    expect(supabase.calls.in).toBe(1);
  });
});
