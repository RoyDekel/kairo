import { getServerSupabase } from './supabaseServer.js';

/**
 * The precomputed-verdict cache that lets /api/flights avoid running forecastService on the
 * request path. Every read and write of the `forecast_cache` table goes through here, per
 * hard rule 6 — the batch job (server/jobs/forecastBatch.js) and the read site in server.js
 * both stay free of inline Supabase, and both become unit-testable against the same stub.
 *
 * -------------------------------------------------------------------------------------
 * WHY THE READ HAS TWO GATES, NOT ONE
 *
 * A row is served only if it is BOTH time-fresh AND still price-relevant.
 *
 *   1. Freshness (computed_at within staleHours). A missing nightly run means the batch was
 *      asleep — live compute is the honest fallback, not a day-old verdict.
 *   2. Drift. The cached verdict was computed against the LAST OBSERVED fare (the batch has
 *      no live quote — see forecastBatch §3.2). If the user's live fare has since drifted
 *      past driftTolerance, the BUY/WAIT could have flipped, so we recompute live rather than
 *      serve a price-stale verdict. This is the trust guardrail; it is deliberately part of
 *      the cache read, not the writer.
 *
 * get() never throws. A read failure returns null and the caller falls through to live
 * compute — the /api/flights response must never fail because of this cache.
 */

/** Default staleness window (hours). 26h keeps a 02:00 nightly run always fresh; see .env. */
export const DEFAULT_STALE_HOURS = 26;

/** Default price-drift tolerance (fraction). 0.08 = 8%; the trust guardrail. See .env. */
export const DEFAULT_DRIFT_TOLERANCE = 0.08;

export class ForecastCache {
  constructor({
    supabase = null,
    table = 'forecast_cache',
    observationsTable = 'fare_observations',
    now = () => Date.now()
  } = {}) {
    this.supabase = supabase;
    this.table = table;
    this.observationsTable = observationsTable;
    this.now = now;
  }

  get isEnabled() {
    return Boolean(this.supabase);
  }

  /**
   * Upserts one precomputed verdict. Primary key is (route, currency), so a re-run refreshes
   * the row in place rather than accumulating history. The whole forecastRoute() object is
   * stored verbatim as `payload`; the scalar columns are lifted from it for SQL-side
   * staleness, drift gating, and eyeballing which routes have a live verdict.
   */
  async put(route, currency, forecast, { computedCurrentPrice, provider } = {}) {
    if (!this.supabase) return false;
    if (!forecast || typeof forecast !== 'object') return false;

    const validCurrency = String(currency || 'USD').toUpperCase().trim();
    const row = {
      route,
      currency: validCurrency,
      provider: provider ?? null,
      verdict: forecast.verdict ?? null,
      reason: forecast.reason,
      confidence_score: forecast.confidenceScore ?? null,
      computed_current_price: Number.isFinite(computedCurrentPrice) ? computedCurrentPrice : null,
      sample_size: forecast.sampleSize ?? null,
      distinct_days: forecast.distinctDays ?? null,
      payload: forecast,
      computed_at: new Date(this.now()).toISOString()
    };

    try {
      const { error } = await this.supabase
        .from(this.table)
        .upsert(row, { onConflict: 'route,currency' });

      if (error) {
        console.warn(`[forecastCache] Write failed for ${route}/${validCurrency}: ${error.message}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[forecastCache] Write unreachable for ${route}/${validCurrency}: ${err.message}`);
      return false;
    }
  }

  /**
   * The most recent observed fare for a route+currency, honouring the same provider lock
   * forecastRoute applies. This is the batch's zero-cost stand-in for a live quote (see
   * forecastBatch §3.2): re-querying a metered provider per route would multiply the exact
   * calls this feature exists to avoid.
   *
   * @returns {Promise<{price: number, provider: string|null}|null>} null when nothing usable.
   */
  async latestObservedPrice(route, currency) {
    if (!this.supabase) return null;
    const validCurrency = String(currency || 'USD').toUpperCase().trim();

    try {
      let query = this.supabase
        .from(this.observationsTable)
        .select('roundtrip_price, provider')
        .eq('route', route)
        .eq('currency', validCurrency);

      // Same lock as forecastRoute: 'simulated' is skipped because those rows are never
      // written, and 'all'/unset disables the lock. Locking to a real provider keeps the
      // stand-in price on the same series the forecast will be computed from.
      const providerLock = (process.env.FORECAST_PROVIDER || process.env.FLIGHT_PROVIDER || '').trim();
      if (providerLock && providerLock !== 'simulated' && providerLock !== 'all') {
        query = query.eq('provider', providerLock);
      }

      const { data, error } = await query
        .order('observed_at', { ascending: false })
        .limit(1);

      if (error) {
        console.warn(`[forecastCache] Observation read failed for ${route}: ${error.message}`);
        return null;
      }

      const observation = Array.isArray(data) ? data[0] : null;
      if (!observation) return null;

      const price = Number(observation.roundtrip_price);
      if (!Number.isFinite(price) || price <= 0) return null;

      return { price, provider: observation.provider || null };
    } catch (err) {
      console.warn(`[forecastCache] Observation read unreachable for ${route}: ${err.message}`);
      return null;
    }
  }

  /**
   * The cached payload for (route, currency), or null if it fails EITHER gate — freshness or
   * price drift — or if the row is missing or the read errors. Never throws.
   *
   * @param {number} livePrice the fare the user is actually being shown right now.
   */
  async get(route, currency, livePrice, { staleHours = DEFAULT_STALE_HOURS, driftTolerance = DEFAULT_DRIFT_TOLERANCE } = {}) {
    if (!this.supabase) return null;
    const validCurrency = String(currency || 'USD').toUpperCase().trim();

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('payload, computed_at, computed_current_price')
        .eq('route', route)
        .eq('currency', validCurrency)
        .limit(1);

      if (error) {
        console.warn(`[forecastCache] Read failed for ${route}/${validCurrency}: ${error.message}`);
        return null;
      }

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return null;

      // Gate 1: freshness.
      const computedAt = Date.parse(row.computed_at);
      if (!Number.isFinite(computedAt)) return null;
      const ageHours = (this.now() - computedAt) / 3_600_000;
      if (ageHours > staleHours) return null;

      // Gate 2: price drift — the trust guardrail. Without a valid computed_current_price to
      // compare against, or a valid live price, we cannot prove the verdict is still relevant,
      // so we recompute live rather than serve it.
      const computedPrice = Number(row.computed_current_price);
      if (!Number.isFinite(computedPrice) || computedPrice <= 0) return null;
      if (!Number.isFinite(livePrice) || livePrice <= 0) return null;

      const drift = Math.abs(livePrice - computedPrice) / computedPrice;
      if (drift > driftTolerance) return null;

      return row.payload ?? null;
    } catch (err) {
      console.warn(`[forecastCache] Read unreachable for ${route}/${validCurrency}: ${err.message}`);
      return null;
    }
  }
}

export const forecastCache = new ForecastCache({ supabase: getServerSupabase() });
