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

    clock += 60_001;
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

describe('durableTtlMs', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const ttlMs = 6 * 60 * 60 * 1000;

  /*
    Inside a couple of days kickoff times move and matches get postponed. Holding such a
    window for six hours in a table every instance reads would broadcast a cancelled
    match, which is a cost the memory-only cache never had.
  */
  test('a window starting within two days is held for an hour at most', () => {
    expect(durableTtlMs('2026-08-02', { ttlMs, now })).toBe(60 * 60 * 1000);
  });

  test('a window further out gets the full TTL', () => {
    expect(durableTtlMs('2026-10-01', { ttlMs, now })).toBe(ttlMs);
  });

  test('an unparseable date falls back to the full TTL rather than NaN', () => {
    expect(durableTtlMs(undefined, { ttlMs, now })).toBe(ttlMs);
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
