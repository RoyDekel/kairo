import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersistentDayCache, ttlForDate } from '../../../server/services/persistentDayCache.js';
import { ApiSportsProvider } from '../../../server/providers/apiSportsProvider.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';
import { snapshotForDate, shouldUseSnapshot } from '../../../server/providers/snapshots/apisportsFixtures.js';

/*
  setupTests.js mocks this module to null for every test, so that a machine which happens to
  have real credentials cannot let the suite reach the production project. These tests are
  about the credential logic itself, so they load the genuine implementation on purpose.
*/
const realSupabaseServer = await vi.importActual('../../../server/services/supabaseServer.js');
const { getServerSupabase, resetServerSupabase } = realSupabaseServer;

/**
 * The fixture cache must survive the process.
 *
 * The in-memory cache advertised a six-hour TTL, but Render's free tier spins the service
 * down after ~15 minutes without traffic and the Map goes with it. For a low-traffic app
 * that made almost every search a cold start paying full price against a 100/day
 * allowance — the advertised TTL was really "until nobody uses the app for a quarter of
 * an hour".
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });

/** A stand-in Supabase client backed by a plain Map, recording every call. */
const fakeSupabase = () => {
  const rows = new Map();
  const calls = { select: 0, upsert: 0 };

  return {
    rows,
    calls,
    from() {
      return {
        select() {
          return {
            eq(_col, value) {
              return {
                async maybeSingle() {
                  calls.select += 1;
                  return { data: rows.get(value) || null, error: null };
                }
              };
            }
          };
        },
        async upsert(row) {
          calls.upsert += 1;
          rows.set(row.fixture_date, row);
          return { error: null };
        }
      };
    }
  };
};

const payload = { fixtures: [{ fixture: { id: 1 } }] };

describe('PersistentDayCache', () => {
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  test('serves from memory without touching the database', async () => {
    const db = fakeSupabase();
    const cache = new PersistentDayCache({ supabase: db });

    await cache.set('2026-09-01', payload);
    const got = await cache.get('2026-09-01');

    expect(got).toEqual(payload);
    expect(db.calls.select).toBe(0); // memory answered
  });

  /*
    THE CASE THAT JUSTIFIES THE WHOLE LAYER.

    A fresh cache is what Render hands us after every spin-down and every deploy. Before
    this, that meant a guaranteed API call.
  */
  test('a brand new process reads the value written by the previous one', async () => {
    const db = fakeSupabase();

    await new PersistentDayCache({ supabase: db }).set('2026-09-01', payload);

    // Cold start: new object, empty memory, same database.
    const afterRestart = new PersistentDayCache({ supabase: db });
    expect(await afterRestart.get('2026-09-01')).toEqual(payload);
    expect(db.calls.select).toBe(1);
  });

  test('an expired row is not served', async () => {
    const db = fakeSupabase();
    let clock = Date.parse('2026-09-01T00:00:00Z');
    const cache = new PersistentDayCache({ supabase: db, now: () => clock });

    await cache.set('2026-09-02', payload);
    cache.clear(); // drop the memory tier, leaving only the durable row

    clock += 10 * DAY;
    expect(await cache.get('2026-09-02')).toBeNull();
  });

  test('without Supabase it degrades to memory rather than failing', async () => {
    const cache = new PersistentDayCache({ supabase: null });

    expect(cache.isPersistent).toBe(false);
    await cache.set('2026-09-01', payload);
    expect(await cache.get('2026-09-01')).toEqual(payload);
  });

  /*
    A cache is an optimisation. A broken one must cost an API call, never a failed search.
  */
  test('a database read failure is a miss, not an exception', async () => {
    const broken = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'boom' } }) }) }),
        upsert: async () => ({ error: null })
      })
    };

    await expect(new PersistentDayCache({ supabase: broken }).get('2026-09-01')).resolves.toBeNull();
  });

  test('a database write failure does not break the caller', async () => {
    const broken = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => {
          throw new Error('connection reset');
        }
      })
    };

    await expect(new PersistentDayCache({ supabase: broken }).set('2026-09-01', payload)).resolves.toBeUndefined();
  });
});

describe('TTL scales with distance from the date', () => {
  const now = Date.parse('2026-09-01T00:00:00Z');

  /*
    A flat 24 hours is wrong in both directions. Tomorrow's fixtures move — kickoff times
    shift, matches get postponed — and since PLANNED_STATUSES filtering decides whether a
    match is shown at all, a postponement we missed would advertise a cancelled game.
  */
  test('imminent dates are held only briefly', () => {
    expect(ttlForDate('2026-09-01', { now })).toBe(HOUR);
    expect(ttlForDate('2026-09-02', { now })).toBe(HOUR);
  });

  test('dates weeks out are held for a day', () => {
    expect(ttlForDate('2026-09-20', { now })).toBe(DAY);
  });

  test('dates months out are held longest', () => {
    expect(ttlForDate('2026-12-01', { now })).toBe(3 * DAY);
  });

  /*
    An empty far-future day usually means the schedule is not published yet, not that
    nothing is on. Holding that for days would outlast the fixtures actually appearing.
  */
  test('an empty far-future day is not held as long as a populated one', () => {
    const populated = ttlForDate('2026-12-01', { isEmpty: false, now });
    const empty = ttlForDate('2026-12-01', { isEmpty: true, now });

    expect(empty).toBeLessThan(populated);
  });

  test('an unparseable date falls back to a safe default', () => {
    expect(ttlForDate('not-a-date', { now })).toBe(6 * HOUR);
  });
});

describe('development uses a snapshot instead of the live API', () => {
  /*
    The unit tests were already isolated — an unmocked fetch rejects. But `npm run dev`
    with a real key hit the live API on every manual search, which is the likeliest way to
    spend a 100/day allowance: by hand, repeatedly, while iterating.
  */
  test('snapshot is the default for the dev server', () => {
    expect(shouldUseSnapshot({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldUseSnapshot({})).toBe(true); // `node server.js` with NODE_ENV unset
  });

  test('production always goes live', () => {
    expect(shouldUseSnapshot({ NODE_ENV: 'production' })).toBe(false);
  });

  /*
    Tests must NOT get the snapshot. They stub fetch to exercise 429s, quota errors and
    transport failures; handing them fabricated success data would leave those tests green
    while no longer testing anything.
  */
  test('tests are excluded, so they keep controlling fetch themselves', () => {
    expect(shouldUseSnapshot({ NODE_ENV: 'test' })).toBe(false);
  });

  test('reaching the real API in development takes an explicit opt-in', () => {
    expect(shouldUseSnapshot({ NODE_ENV: 'development', APISPORTS_LIVE: '1' })).toBe(false);
  });

  test('a provider in snapshot mode makes no network call at all', async () => {
    globalThis.fetch = vi.fn();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const provider = new ApiSportsProvider({
      apiKey: 'k',
      limiter: instant(),
      dayCache: new PersistentDayCache({ supabase: null }),
      useSnapshot: true
    });

    const result = await provider.fetchEvents(
      { city: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.3, lon: 2.08 },
      { startDate: '2026-09-01', endDate: '2026-09-01' },
      'BCN'
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.status).toBe('ok');
    expect(result.events[0].title).toContain('Barcelona');
  });

  test('the snapshot reproduces the traits that make real payloads hard', () => {
    const { response } = snapshotForDate('2026-09-01');

    // venue.city is null for many real fixtures, so the club is the only locator.
    expect(response.some((f) => f.fixture.venue.city === null)).toBe(true);
    // Postponed matches exist and must be filtered out.
    expect(response.some((f) => f.fixture.status.short === 'PST')).toBe(true);
    // Cities Kairo does not serve appear and must not be placed.
    expect(response.some((f) => f.league.country === 'Ecuador')).toBe(true);
  });

  test('snapshot fixtures are dated to the requested day', () => {
    const { response } = snapshotForDate('2026-11-14');
    expect(response.every((f) => f.fixture.date.startsWith('2026-11-14'))).toBe(true);
  });
});

describe('server Supabase credentials', () => {
  beforeEach(() => resetServerSupabase());
  afterEach(() => resetServerSupabase());

  const withEnv = (vars, fn) => {
    const saved = { ...process.env };
    Object.assign(process.env, vars);
    try { return fn(); } finally { process.env = saved; }
  };

  test('the URL falls back to the client copy, which is the same project', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = withEnv(
      { SUPABASE_URL: '', VITE_SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_KEY: 'sb_secret_x' },
      () => getServerSupabase()
    );

    expect(client).not.toBeNull();
    warn.mockRestore();
  });

  /*
    The key must NEVER fall back to the anon key. That key is public and RLS-enforced, so
    accepting it would produce a client that looks configured, passes startup, and then has
    every single cache write denied — the quietest possible failure.
  */
  test('the key never falls back to the public anon key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = withEnv(
      { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_SERVICE_KEY: '', VITE_SUPABASE_ANON_KEY: 'sb_publishable_x' },
      () => getServerSupabase()
    );

    expect(client).toBeNull();
    expect(warn.mock.calls.flat().join(' ')).toContain('SUPABASE_SERVICE_KEY');
    warn.mockRestore();
  });

  test('the warning names exactly what is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    withEnv({ SUPABASE_URL: '', VITE_SUPABASE_URL: '', SUPABASE_SERVICE_KEY: '' }, () => getServerSupabase());

    const text = warn.mock.calls.flat().join(' ');
    expect(text).toContain('SUPABASE_URL and SUPABASE_SERVICE_KEY');
    warn.mockRestore();
  });
});
