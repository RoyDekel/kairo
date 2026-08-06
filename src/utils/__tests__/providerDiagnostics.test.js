import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiSportsProvider } from '../../../server/providers/apiSportsProvider.js';
import { TicketmasterProvider } from '../../../server/providers/ticketmasterProvider.js';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { EventCache } from '../../../server/services/eventCache.js';
import { TtlCache } from '../../../server/services/ttlCache.js';
import { RateLimiter, getLimiter, resetLimiters, PROVIDER_LIMITS } from '../../../server/services/rateLimiter.js';

/**
 * Two defects found by reading production Render logs.
 *
 * 1. A 20-destination search printed twenty [ticketmaster] lines and NOT ONE [apisports]
 *    line. Every failure path in ApiSportsProvider returned silently, so a provider that
 *    was throttled, out of quota, or never called looked identical to one that wasn't
 *    there. A diagnostic that goes quiet exactly when something breaks is worse than none.
 *
 * 2. getLimiter() was exported and never called — EventProvider built its own RateLimiter
 *    per instance, so the process-wide budget described in rateLimiter.js did not exist.
 *    Two instances of a provider would each have taken a full allowance.
 */

const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });

const makeApiSports = () =>
  new ApiSportsProvider({
    apiKey: 'k',
    limiter: instant(),
    dayCache: new TtlCache({ ttlMs: 60_000 })
  });

const BCN = { city: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.3, lon: 2.08 };
const WINDOW = { startDate: '2026-10-14', endDate: '2026-10-16' };

let warn;

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

/** All console.warn output for this test, flattened. */
const warnings = () => warn.mock.calls.map((c) => c.join(' ')).join('\n');

describe('ApiSportsProvider explains every failure', () => {
  test('a 429 is logged, not swallowed', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const result = await makeApiSports().fetchEvents(BCN, WINDOW, 'BCN');

    expect(result.status).toBe('unavailable');
    expect(warnings()).toContain('[apisports] Rate limited');
  });

  test('a non-200 is logged with its status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await makeApiSports().fetchEvents(BCN, WINDOW, 'BCN');
    expect(warnings()).toContain('HTTP 503');
  });

  test('a plan error in a 200 body is logged', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: { plan: 'Free plans do not have access to this season.' }, response: [] })
    });

    await makeApiSports().fetchEvents(BCN, WINDOW, 'BCN');
    expect(warnings()).toContain('[apisports] API reported plan');
  });

  test('an entirely unchecked city says so, naming the reason and the dates', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    await makeApiSports().fetchEvents(BCN, WINDOW, 'BCN');

    const text = warnings();
    expect(text).toContain('Could NOT check Barcelona');
    expect(text).toContain('rate-limited');
    // 3 dates in the window, all of them failed.
    expect(text).toContain('3/3 dates failed');
  });

  test('an empty date window is logged rather than skipped in silence', async () => {
    await makeApiSports().fetchEvents(BCN, { startDate: null, endDate: null }, 'BCN');
    expect(warnings()).toContain('No usable dates');
  });

  /* A window that half-answered is still incomplete, and must not read as complete. */
  test('a partially available window is flagged', async () => {
    let call = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return { ok: true, status: 200, json: async () => ({ errors: [], response: [] }) };
      }
      return { ok: false, status: 429, json: async () => ({}) };
    });

    const result = await makeApiSports().fetchEvents(BCN, WINDOW, 'BCN');

    expect(result.status).toBe('empty');
    expect(warnings()).toContain('Partial window for Barcelona');
  });
});

describe('EventSearchService names the provider that could not answer', () => {
  test('an unavailable provider is reported against the destination', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const service = new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey: 'k', limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    await service.fetchEvents('BCN', '2026-10-14', '2026-10-14');

    // Previously this left no trace at the service level, so a destination could go
    // unchecked while the log showed only the providers that did answer.
    expect(warnings()).toContain('BCN not checked by ticketmaster');
  });
});

describe('the rate limiter budget is process-wide', () => {
  beforeEach(() => resetLimiters());

  test('two instances of the same provider share one limiter', () => {
    const a = new ApiSportsProvider({ apiKey: 'k' });
    const b = new ApiSportsProvider({ apiKey: 'k' });

    // The whole point: a second instance must not get a second allowance.
    expect(a.limiter).toBe(b.limiter);
  });

  test('different providers get different limiters', () => {
    const tm = new TicketmasterProvider({ apiKey: 'k' });
    const as = new ApiSportsProvider({ apiKey: 'k' });

    expect(tm.limiter).not.toBe(as.limiter);
  });

  test('a provider uses its published ceiling', () => {
    const as = new ApiSportsProvider({ apiKey: 'k' });
    expect(as.limiter.limit).toBe(PROVIDER_LIMITS.apisports.limit);
    expect(as.limiter.windowMs).toBe(PROVIDER_LIMITS.apisports.windowMs);
  });

  /*
    A provider that makes no outbound calls declares its own nominal limit instead of
    appearing in PROVIDER_LIMITS, which is reserved for real APIs. Wiring getLimiter
    without this fallback broke the simulated provider outright.
  */
  test('a provider absent from PROVIDER_LIMITS falls back to its own declaration', () => {
    const limiter = getLimiter('not-a-real-provider', { limit: 7, windowMs: 500 });
    expect(limiter.limit).toBe(7);
  });

  test('an unknown provider with no fallback fails loudly', () => {
    expect(() => getLimiter('nothing-here')).toThrow(/No rate limit configured/);
  });

  test('Ticketmaster is spaced to about 200ms, matching 5 per second', () => {
    const tm = new TicketmasterProvider({ apiKey: 'k' });
    expect(tm.limiter.minGapMs).toBe(200);
  });
});
