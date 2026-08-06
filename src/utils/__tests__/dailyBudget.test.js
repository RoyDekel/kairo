import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { DailyBudget, utcDay } from '../../../server/services/dailyBudget.js';
import { ApiSportsProvider } from '../../../server/providers/apiSportsProvider.js';
import { PersistentDayCache } from '../../../server/services/persistentDayCache.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';

/**
 * The ceiling the rate limiter never was.
 *
 * rateLimiter.js documented the constraint correctly — "API-Sports free: 100/day and
 * 10/minute. The DAILY cap is the binding one" — and enforced only the per-minute half.
 * That gap is what allowed the original incident to run to completion: the limiter paced
 * requests perfectly, six seconds apart, and went on pacing them past a hundred until the
 * account was suspended.
 *
 * A rate limit governs how fast a budget is spent. It does not stop it running out.
 */

const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });

/** A stand-in for the Postgres counter, incrementing atomically like the real function. */
const fakeUsageStore = () => {
  const counts = new Map();
  return {
    counts,
    async rpc(_fn, { p_provider, p_day }) {
      const key = `${p_provider}:${p_day}`;
      const next = (counts.get(key) || 0) + 1;
      counts.set(key, next);
      return { data: next, error: null };
    }
  };
};

let warn;
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('DailyBudget', () => {
  test('allows calls up to the ceiling and refuses the one after', async () => {
    const budget = new DailyBudget({ provider: 'apisports', limit: 3, supabase: fakeUsageStore() });

    expect((await budget.consume()).allowed).toBe(true);
    expect((await budget.consume()).allowed).toBe(true);
    expect((await budget.consume()).allowed).toBe(true);

    const refused = await budget.consume();
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
  });

  /*
    THE CASE THAT JUSTIFIES PUTTING THIS IN POSTGRES.

    Render's free tier restarts the service constantly. A counter held in memory resets
    with it, so the ceiling would reset several times a day and enforce nothing.
  */
  test('a restarted process does not get a fresh allowance', async () => {
    const store = fakeUsageStore();

    const before = new DailyBudget({ provider: 'apisports', limit: 3, supabase: store });
    await before.consume();
    await before.consume();
    await before.consume();

    // Cold start: new object, empty memory, same database.
    const after = new DailyBudget({ provider: 'apisports', limit: 3, supabase: store });
    expect((await after.consume()).allowed).toBe(false);
  });

  test('the allowance returns at UTC midnight', async () => {
    const store = fakeUsageStore();
    let clock = Date.parse('2026-08-01T23:00:00Z');
    const budget = new DailyBudget({ provider: 'apisports', limit: 2, supabase: store, now: () => clock });

    await budget.consume();
    await budget.consume();
    expect((await budget.consume()).allowed).toBe(false);

    clock = Date.parse('2026-08-02T00:30:00Z');
    expect((await budget.consume()).allowed).toBe(true);
  });

  test('providers keep separate budgets', async () => {
    const store = fakeUsageStore();
    const a = new DailyBudget({ provider: 'apisports', limit: 1, supabase: store });
    const b = new DailyBudget({ provider: 'ticketmaster', limit: 1, supabase: store });

    await a.consume();
    expect((await a.consume()).allowed).toBe(false);
    expect((await b.consume()).allowed).toBe(true);
  });

  /*
    An accounting outage should weaken the guarantee, not disable the feature. The local
    count still bounds a runaway within this process.
  */
  test('an unreachable store falls back to counting locally', async () => {
    const broken = { rpc: async () => ({ data: null, error: { message: 'down' } }) };
    const budget = new DailyBudget({ provider: 'apisports', limit: 2, supabase: broken });

    expect((await budget.consume()).allowed).toBe(true);
    expect((await budget.consume()).allowed).toBe(true);
    expect((await budget.consume()).allowed).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('usage store unreachable');
  });

  test('without a store it still enforces, but says it is not durable', async () => {
    const budget = new DailyBudget({ provider: 'apisports', limit: 1 });

    expect(budget.isDurable).toBe(false);
    expect((await budget.consume()).allowed).toBe(true);
    expect((await budget.consume()).allowed).toBe(false);
  });

  test('refuses to construct without a provider or a limit', () => {
    expect(() => new DailyBudget({ limit: 10 })).toThrow();
    expect(() => new DailyBudget({ provider: 'x' })).toThrow();
    expect(() => new DailyBudget({ provider: 'x', limit: -1 })).toThrow();
  });

  /*
    Zero must be expressible. It is the one setting that guarantees no outbound traffic at
    all, and an earlier truthiness check rejected it as a missing value.
  */
  test('a ceiling of zero blocks everything rather than being read as unset', async () => {
    const budget = new DailyBudget({ provider: 'apisports', limit: 0, supabase: fakeUsageStore() });
    expect((await budget.consume()).allowed).toBe(false);
  });

  test('the day is UTC, matching the provider quota rather than the server clock', () => {
    expect(utcDay(Date.parse('2026-08-01T23:59:59Z'))).toBe('2026-08-01');
    expect(utcDay(Date.parse('2026-08-02T00:00:01Z'))).toBe('2026-08-02');
  });
});

describe('the provider under an exhausted budget', () => {
  const BCN = { city: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.3, lon: 2.08 };

  const makeProvider = (limit) =>
    new ApiSportsProvider({
      apiKey: 'k',
      limiter: instant(),
      dayCache: new PersistentDayCache({ supabase: null }),
      useSnapshot: false,
      budget: new DailyBudget({ provider: 'apisports', limit, supabase: fakeUsageStore() })
    });

  test('stops calling the API once the ceiling is hit', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [], response: [] })
    });

    // Ceiling of 2, but a 5-day window would want 5 calls.
    const result = await makeProvider(2).fetchEvents(
      BCN,
      { startDate: '2026-09-01', endDate: '2026-09-05' },
      'BCN'
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('empty'); // two dates genuinely answered, and were empty
  });

  /*
    The distinction this whole session has turned on. A date we declined to check is not a
    date with no fixtures. Collapsing the two would have the discovery page announce that
    cities are quiet because we ran out of quota.
  */
  test('a fully suppressed lookup reports unavailable, never empty', async () => {
    globalThis.fetch = vi.fn();

    const result = await makeProvider(0).fetchEvents(
      BCN,
      { startDate: '2026-09-01', endDate: '2026-09-02' },
      'BCN'
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('daily-budget-exhausted');
  });

  test('a cached date costs nothing from the budget', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [], response: [] })
    });

    const provider = makeProvider(2);
    const window = { startDate: '2026-09-01', endDate: '2026-09-01' };

    await provider.fetchEvents(BCN, window, 'BCN');
    await provider.fetchEvents({ ...BCN, city: 'Madrid' }, window, 'MAD');
    await provider.fetchEvents({ ...BCN, city: 'Munich' }, window, 'MUC');

    // One outbound call, so only one unit spent despite three lookups.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect((await provider.budget.consume()).allowed).toBe(true); // unit 2 still available
  });
});
