/**
 * @vitest-environment node
 */
import { describe, test, expect, afterEach, vi } from 'vitest';
import { ForecastCache } from '../../../server/services/forecastCache.js';

/**
 * Supabase builder stub, extended from the one in forecastTiering.test.js with insert/upsert
 * and an order().limit() seam. Each table carries its own configurable `rows`/`error`, a
 * `throw` flag for the "read error never throws" path, and a `captured` log of every write.
 */
function stubSupabase(tables = {}) {
  const state = {};
  for (const [name, cfg] of Object.entries(tables)) {
    state[name] = { rows: [], error: null, throw: false, captured: [], ...cfg };
  }

  return {
    _state: state,
    from(table) {
      const t = state[table] || (state[table] = { rows: [], error: null, throw: false, captured: [] });
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => {
          if (t.throw) return Promise.reject(new Error('connection reset'));
          return Promise.resolve({ data: t.error ? null : t.rows, error: t.error });
        },
        upsert: (row, options) => {
          if (t.throw) return Promise.reject(new Error('connection reset'));
          t.captured.push({ row, options });
          return Promise.resolve({ error: t.error });
        }
      };
      return builder;
    }
  };
}

const NOW = Date.parse('2026-08-09T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

/** A representative tier-3 payload as forecastRoute would return it. */
function seasonalPayload(overrides = {}) {
  return {
    verdict: 'WAIT',
    reason: 'seasonal_naive_forecast',
    sampleSize: 120,
    distinctDays: 12,
    confidenceScore: 88,
    forecastMedian: 520,
    predictionInterval: { lower: 480, upper: 560 },
    prices: [500, 520, 540],
    ...overrides
  };
}

function cacheRow({ ageHours = 1, computedPrice = 500, payload = seasonalPayload() } = {}) {
  return { payload, computed_at: hoursAgo(ageHours), computed_current_price: computedPrice };
}

describe('ForecastCache.get — freshness gate', () => {
  test('serves the payload for a row inside the staleness window', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 10 })] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 505, { staleHours: 26, driftTolerance: 0.08 });
    expect(res).toEqual(seasonalPayload());
  });

  test('returns null once the row is older than staleHours (AC 11)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 40 })] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 505, { staleHours: 26, driftTolerance: 0.08 });
    expect(res).toBeNull();
  });
});

describe('ForecastCache.get — price-drift gate (the trust guardrail)', () => {
  test('serves when the live price is within tolerance of computed_current_price (AC 10)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ computedPrice: 500 })] } }),
      now: () => NOW
    });

    // 500 -> 535 is 7% drift, inside the 8% tolerance.
    const res = await cache.get('TLV-CDG', 'USD', 535, { staleHours: 26, driftTolerance: 0.08 });
    expect(res).toEqual(seasonalPayload());
  });

  test('THE GUARDRAIL: returns null when live price drifts past tolerance, even on a fresh row (AC 11)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 1, computedPrice: 500 })] } }),
      now: () => NOW
    });

    // 500 -> 560 is 12% drift, past the 8% tolerance: the BUY/WAIT could have flipped.
    const res = await cache.get('TLV-CDG', 'USD', 560, { staleHours: 26, driftTolerance: 0.08 });
    expect(res).toBeNull();
  });

  test('returns null when computed_current_price is missing (cannot prove relevance)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ computedPrice: null })] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 500, { staleHours: 26, driftTolerance: 0.08 });
    expect(res).toBeNull();
  });

  test('returns null when there is no valid live price to compare against', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow()] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 0, { staleHours: 26, driftTolerance: 0.08 });
    expect(res).toBeNull();
  });
});

describe('ForecastCache.get — miss and error handling', () => {
  test('returns null on a miss (no row) (AC 11)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [] } }),
      now: () => NOW
    });

    expect(await cache.get('TLV-CDG', 'USD', 500)).toBeNull();
  });

  test('returns null (never throws) on a read error (AC 11, 12)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { error: { message: 'boom' } } }),
      now: () => NOW
    });

    await expect(cache.get('TLV-CDG', 'USD', 500)).resolves.toBeNull();
  });

  test('returns null (never throws) when the client itself throws (AC 12)', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { throw: true } }),
      now: () => NOW
    });

    await expect(cache.get('TLV-CDG', 'USD', 500)).resolves.toBeNull();
  });

  test('returns null when no supabase is configured', async () => {
    const cache = new ForecastCache({ supabase: null, now: () => NOW });
    expect(await cache.get('TLV-CDG', 'USD', 500)).toBeNull();
  });
});

describe('ForecastCache.get — miss-reason logging (P1 diagnostics)', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // Every case here also re-asserts the RETURN CONTRACT: logging must never change what get()
  // resolves to (payload on hit, null on every miss).

  test('drift gate logs the reason with live/cached numbers, always (row exists)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 1, computedPrice: 500 })] } }),
      now: () => NOW
    });

    // 500 -> 560 is 12% drift, past the 8% tolerance.
    const res = await cache.get('TLV-CDG', 'USD', 560, { staleHours: 26, driftTolerance: 0.08 });

    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0];
    expect(line).toContain('MISS TLV-CDG/USD');
    expect(line).toContain('drift');
    expect(line).toContain('0.12');
    expect(line).toContain('> 0.08');
    expect(line).toContain('live 560');
    expect(line).toContain('cached 500');
  });

  test('stale gate logs the reason with the age in hours, always (row exists)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 31.2 })] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 505, { staleHours: 26, driftTolerance: 0.08 });

    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0][0];
    expect(line).toContain('MISS TLV-CDG/USD');
    expect(line).toContain('stale 31.2h > 26h');
  });

  test('missing computed_current_price logs the reason, always (row exists)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ computedPrice: null })] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 500, { staleHours: 26, driftTolerance: 0.08 });

    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('MISS TLV-CDG/USD: no computed_current_price');
  });

  test('unparseable computed_at logs the reason, always (row exists)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [{ payload: seasonalPayload(), computed_at: 'not-a-date', computed_current_price: 500 }] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 500, { staleHours: 26, driftTolerance: 0.08 });

    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('MISS TLV-CDG/USD: unparseable computed_at');
  });

  test('no cached row is SILENT by default (noise control)', async () => {
    delete process.env.FORECAST_CACHE_DEBUG;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-BCN', 'USD', 500);

    expect(res).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  test('no cached row LOGS when FORECAST_CACHE_DEBUG=true', async () => {
    process.env.FORECAST_CACHE_DEBUG = 'true';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-BCN', 'USD', 500);

    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('MISS TLV-BCN/USD: no cached row');
  });

  test('no supabase client is SILENT by default, LOGS under FORECAST_CACHE_DEBUG', async () => {
    delete process.env.FORECAST_CACHE_DEBUG;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({ supabase: null, now: () => NOW });

    expect(await cache.get('TLV-CDG', 'USD', 500)).toBeNull();
    expect(warn).not.toHaveBeenCalled();

    process.env.FORECAST_CACHE_DEBUG = 'true';
    expect(await cache.get('TLV-CDG', 'USD', 500)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('MISS TLV-CDG/USD: no supabase client');
  });

  test('a HIT logs nothing and returns the payload (contract unchanged)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 2, computedPrice: 500 })] } }),
      now: () => NOW
    });

    const res = await cache.get('TLV-CDG', 'USD', 505, { staleHours: 26, driftTolerance: 0.08 });

    expect(res).toEqual(seasonalPayload());
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('ForecastCache.put — write shape (AC 5)', () => {
  test('upserts one row whose payload round-trips and whose scalars are lifted', async () => {
    const supabase = stubSupabase({ forecast_cache: {} });
    const cache = new ForecastCache({ supabase, now: () => NOW });

    const payload = seasonalPayload();
    const ok = await cache.put('TLV-CDG', 'usd', payload, { computedCurrentPrice: 500, provider: 'fli' });

    expect(ok).toBe(true);
    expect(supabase._state.forecast_cache.captured).toHaveLength(1);

    const { row, options } = supabase._state.forecast_cache.captured[0];
    expect(options).toEqual({ onConflict: 'route,currency' });
    expect(row.route).toBe('TLV-CDG');
    expect(row.currency).toBe('USD');
    expect(row.provider).toBe('fli');
    expect(row.verdict).toBe('WAIT');
    expect(row.reason).toBe('seasonal_naive_forecast');
    expect(row.confidence_score).toBe(88);
    expect(row.computed_current_price).toBe(500);
    expect(row.sample_size).toBe(120);
    expect(row.distinct_days).toBe(12);
    expect(row.computed_at).toBe(new Date(NOW).toISOString());
    expect(row.payload).toEqual(payload); // stored verbatim
  });

  test('lifts null-tier fields without inventing values', async () => {
    const supabase = stubSupabase({ forecast_cache: {} });
    const cache = new ForecastCache({ supabase, now: () => NOW });

    const payload = { verdict: null, reason: 'insufficient_history', sampleSize: 2 };
    await cache.put('TLV-ZZZ', 'USD', payload, { computedCurrentPrice: 300, provider: 'fli' });

    const { row } = supabase._state.forecast_cache.captured[0];
    expect(row.verdict).toBeNull();
    expect(row.confidence_score).toBeNull();
    expect(row.distinct_days).toBeNull();
    expect(row.payload).toEqual(payload);
  });

  test('returns false (never throws) when the write errors', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { error: { message: 'denied' } } }),
      now: () => NOW
    });
    await expect(cache.put('TLV-CDG', 'USD', seasonalPayload(), { computedCurrentPrice: 500 })).resolves.toBe(false);
  });
});

describe('ForecastCache.latestObservedPrice', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('returns the most recent observed price and its provider', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ fare_observations: { rows: [{ roundtrip_price: 512, provider: 'fli' }] } }),
      now: () => NOW
    });

    expect(await cache.latestObservedPrice('TLV-CDG', 'USD')).toEqual({ price: 512, provider: 'fli' });
  });

  test('returns null when the route has no observation', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ fare_observations: { rows: [] } }),
      now: () => NOW
    });

    expect(await cache.latestObservedPrice('TLV-CDG', 'USD')).toBeNull();
  });

  test('returns null (never throws) on a read error', async () => {
    const cache = new ForecastCache({
      supabase: stubSupabase({ fare_observations: { throw: true } }),
      now: () => NOW
    });

    await expect(cache.latestObservedPrice('TLV-CDG', 'USD')).resolves.toBeNull();
  });
});

/*
  READ-PATH WIRING (AC 9, 10, 11).

  Mirrors the /api/flights guard at server.js:669 exactly — the decision of hit vs miss lives
  entirely inside forecastCache.get, so this needs no live Express. It proves the composition:
  forecastRoute is skipped on a cache hit and invoked on a miss.
*/
async function readPathForecast({ cache, forecastRoute, route, origin, destination, currency, livePrice }) {
  let forecast = null;
  if (process.env.FORECAST_CACHE_READ_ENABLED === 'true') {
    forecast = await cache.get(route, currency, livePrice, {
      staleHours: Number(process.env.FORECAST_STALE_HOURS || 26),
      driftTolerance: Number(process.env.FORECAST_PRICE_DRIFT_TOLERANCE || 0.08)
    });
  }
  if (!forecast) {
    forecast = await forecastRoute(origin, destination, livePrice, currency);
  }
  return forecast;
}

describe('read-path wiring', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('with reads DISABLED, always calls live forecastRoute (AC 9)', async () => {
    delete process.env.FORECAST_CACHE_READ_ENABLED;
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow()] } }),
      now: () => NOW
    });
    const forecastRoute = vi.fn().mockResolvedValue({ reason: 'seasonal_naive_forecast', verdict: 'BUY_NOW' });

    const res = await readPathForecast({
      cache, forecastRoute, route: 'TLV-CDG', origin: 'TLV', destination: 'CDG', currency: 'USD', livePrice: 500
    });

    expect(forecastRoute).toHaveBeenCalledTimes(1);
    expect(res.verdict).toBe('BUY_NOW');
  });

  test('with reads enabled and a fresh in-tolerance row, serves cache WITHOUT forecastRoute (AC 10)', async () => {
    process.env.FORECAST_CACHE_READ_ENABLED = 'true';
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 2, computedPrice: 500 })] } }),
      now: () => NOW
    });
    const forecastRoute = vi.fn().mockResolvedValue({ reason: 'seasonal_naive_forecast', verdict: 'BUY_NOW' });

    const res = await readPathForecast({
      cache, forecastRoute, route: 'TLV-CDG', origin: 'TLV', destination: 'CDG', currency: 'USD', livePrice: 505
    });

    expect(forecastRoute).not.toHaveBeenCalled();
    expect(res).toEqual(seasonalPayload());
  });

  test('with reads enabled but a stale row, falls back to live forecastRoute (AC 11)', async () => {
    process.env.FORECAST_CACHE_READ_ENABLED = 'true';
    const cache = new ForecastCache({
      supabase: stubSupabase({ forecast_cache: { rows: [cacheRow({ ageHours: 40 })] } }),
      now: () => NOW
    });
    const forecastRoute = vi.fn().mockResolvedValue({ reason: 'seasonal_naive_forecast', verdict: 'BUY_NOW' });

    await readPathForecast({
      cache, forecastRoute, route: 'TLV-CDG', origin: 'TLV', destination: 'CDG', currency: 'USD', livePrice: 505
    });

    expect(forecastRoute).toHaveBeenCalledTimes(1);
  });
});
