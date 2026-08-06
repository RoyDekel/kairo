import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiSportsProvider } from '../../../server/providers/apiSportsProvider.js';
import { PersistentDayCache } from '../../../server/services/persistentDayCache.js';
import { DailyBudget } from '../../../server/services/dailyBudget.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';

/**
 * The free plan answers only for roughly today ±1 day.
 *
 * This corrects a claim previously written into apiSportsProvider.js — that the season
 * lock did not apply to date queries. That was generalised from one successful call whose
 * date happened to fall inside the allowance. Production returned, for every future date:
 *
 *   "Free plans do not have access to this date, try from 2026-07-30 to 2026-08-01."
 *
 * Since KAIRO asks about future trips, that rejection is the normal case. Before this, a
 * 20-destination search spent four guaranteed-to-fail calls out of a ceiling of eighty —
 * roughly twenty searches before the day's budget was exhausted on nothing at all.
 */

const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });
const BCN = { city: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.3, lon: 2.08 };

const planError = (from, to) => ({
  ok: true,
  status: 200,
  json: async () => ({
    errors: { plan: `Free plans do not have access to this date, try from ${from} to ${to}.` },
    response: []
  })
});

const makeProvider = () =>
  new ApiSportsProvider({
    apiKey: 'k',
    limiter: instant(),
    dayCache: new PersistentDayCache({ supabase: null }),
    useSnapshot: false,
    budget: new DailyBudget({ provider: 'apisports', limit: 1000 })
  });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the provider learns what its plan can answer', () => {
  test('one rejection is enough; the rest of the window is skipped for free', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(planError('2026-07-30', '2026-08-01'));

    const provider = makeProvider();
    await provider.fetchEvents(BCN, { startDate: '2026-08-02', endDate: '2026-08-05' }, 'BCN');

    // Four dates requested, but only the first is spent discovering the limitation.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(provider.planWindow).toEqual({ from: '2026-07-30', to: '2026-08-01' });
  });

  test('later destinations cost nothing at all', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(planError('2026-07-30', '2026-08-01'));

    const provider = makeProvider();
    const window = { startDate: '2026-08-02', endDate: '2026-08-05' };

    await provider.fetchEvents(BCN, window, 'BCN');
    const afterFirst = globalThis.fetch.mock.calls.length;

    for (const code of ['MAD', 'MUC', 'BER', 'VIE', 'PRG']) {
      await provider.fetchEvents({ ...BCN, city: code }, window, code);
    }

    expect(globalThis.fetch.mock.calls.length).toBe(afterFirst);
  });

  /*
    Still not an empty calendar. A city we were not permitted to check is not a quiet city,
    and the discovery page must not present it as one.
  */
  test('a skipped destination reports unavailable, never empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(planError('2026-07-30', '2026-08-01'));

    const provider = makeProvider();
    await provider.fetchEvents(BCN, { startDate: '2026-08-02', endDate: '2026-08-05' }, 'BCN');
    const result = await provider.fetchEvents(BCN, { startDate: '2026-09-01', endDate: '2026-09-02' }, 'BCN');

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('outside-plan-window');
  });

  test('dates inside the window are still requested', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(planError('2026-07-30', '2026-08-01'))
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ errors: [], response: [] }) });

    const provider = makeProvider();
    await provider.fetchEvents(BCN, { startDate: '2026-08-05', endDate: '2026-08-05' }, 'BCN');

    const before = globalThis.fetch.mock.calls.length;
    await provider.fetchEvents(BCN, { startDate: '2026-07-31', endDate: '2026-07-31' }, 'BCN');

    expect(globalThis.fetch.mock.calls.length).toBe(before + 1);
  });

  /*
    A rolling window moves with the calendar, so what was learned yesterday must not silently
    suppress today's queries. A plan upgrade widens the window the same way — the range is
    parsed from the API rather than hardcoded, so nothing needs editing when it changes.
  */
  test('the learned window is discarded when the day rolls over', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(planError('2026-07-30', '2026-08-01'));

    const provider = makeProvider();
    await provider.fetchEvents(BCN, { startDate: '2026-08-05', endDate: '2026-08-05' }, 'BCN');
    expect(provider.planWindow).not.toBeNull();

    provider.planWindowDay = '1999-01-01'; // pretend it was learned long ago
    const before = globalThis.fetch.mock.calls.length;
    await provider.fetchEvents(BCN, { startDate: '2026-08-06', endDate: '2026-08-06' }, 'BCN');

    expect(globalThis.fetch.mock.calls.length).toBe(before + 1);
  });

  test('an unparseable plan message is reported rather than silently swallowed', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: { plan: 'Subscription required.' }, response: [] })
    });

    const result = await makeProvider().fetchEvents(BCN, { startDate: '2026-08-02', endDate: '2026-08-02' }, 'BCN');

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('api-plan');
    expect(console.warn.mock.calls.flat().join(' ')).toContain('API reported plan');
  });
});
