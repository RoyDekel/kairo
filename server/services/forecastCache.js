import { getServerSupabase } from './supabaseServer.js';

/**
 * The precomputed-verdict cache that lets /api/flights avoid running forecastService on the
 * request path. Every read and write of the `forecast_cache` table goes through here, per
 * hard rule 6 — the batch job (server/jobs/forecastBatch.js) and the read site in server.js
 * both stay free of inline Supabase, and both become unit-testable against the same stub.
 *
 * -------------------------------------------------------------------------------------
 * WHY THE READ GATES ON TIME, AND ONLY SANITY-CHECKS PRICE
 *
 * A row is served if it is time-fresh and its cached price is not absurdly far from the
 * live one.
 *
 *   1. Freshness (computed_at within staleHours). A missing nightly run means the batch was
 *      asleep — live compute is the honest fallback, not a day-old verdict. The fields that
 *      genuinely age are 90-day-window statistics and the Chronos forecast itself, i.e.
 *      properties of WHEN the model ran, so time is the correct gate for them.
 *   2. Price sanity — a DATA-INTEGRITY check, not a decision-freshness one. A live price
 *      more than sanityMultiple x (or under 1/sanityMultiple of) computed_current_price is
 *      more likely a currency mismatch, a bad fare_observations row or a provider glitch
 *      than a real fare; recomputing live is cheap insurance against a corrupt row.
 *
 * THIS REPLACED AN 8% PRICE-DRIFT GATE (KAI-004, decisions.md 2026-08-22). That gate — "the
 * trust guardrail", decisions.md 2026-08-09 — rejected ~92% of production reads, because the
 * batch's computed_current_price can come from a different departure date than the user is
 * searching, and fares vary 5x+ by date as ordinary seasonality. It was redundant besides:
 * server.js never hands this payload to the client, only to insightsEngine's
 * computeEventDrivenInsights, which recomputes recommendation, pricePercentile and
 * expectedSavings from the LIVE per-flight price on every request. The stale-price risk the
 * gate defended against was already handled one layer downstream. That invariant is now
 * locked by src/utils/__tests__/insightsEngine.test.js — it is what makes this safe, so do
 * not weaken it without re-reading that test.
 *
 * get() never throws. A read failure returns null and the caller falls through to live
 * compute — the /api/flights response must never fail because of this cache.
 */

/** Default staleness window (hours). 26h keeps a 02:00 nightly run always fresh; see .env. */
export const DEFAULT_STALE_HOURS = 26;

/** Default price sanity multiple. 5x catches a corrupt row, not a seasonal spread. See .env. */
export const DEFAULT_SANITY_MULTIPLE = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many days out from "today" latestObservedPrice targets. Matches one of the collector's
 * own horizons (fareCollector.js DEFAULT_HORIZONS), so a fresh sweep usually has an exact
 * match. A starting guess like the sanity multiple was — tune from measured data. See .env.
 */
export const DEFAULT_REPRESENTATIVE_HORIZON_DAYS = 30;

/**
 * How many of a route's most recent observations to scan for the closest departure date.
 * Bounds query cost while covering several days of a stalled or partial collector sweep — the
 * collector writes up to one row per horizon per day, so this is roughly a two-week margin.
 */
const OBSERVATION_LOOKBACK = 40;

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
   * The observed fare closest to a representative horizon out from today, honouring the same
   * provider lock forecastRoute applies. This is the batch's zero-cost stand-in for a live
   * quote (see forecastBatch §3.2): re-querying a metered provider per route would multiply
   * the exact calls this feature exists to avoid.
   *
   * -------------------------------------------------------------------------------------
   * WHY "CLOSEST TO A HORIZON" AND NOT "MOST RECENT" (KAI-002 root cause, fixed here)
   *
   * The collector writes one row per (route, horizon) on every sweep, so "most recently
   * written" was picking whichever horizon happened to be written last — arbitrary with
   * respect to departure date, not the nearest-in-time date a searching user is likely to see.
   * On TLV-KRK that put a $134 November fare against a user searching a $613 near-term date —
   * 4.6x, ordinary seasonality, but large enough that KAI-004's sanity check has to treat it as
   * suspicious even though it isn't (measured 2026-09-05, backlog.md KAI-002/KAI-004).
   *
   * Anchoring on a fixed horizon (matching one of the collector's own, so a fresh sweep
   * usually has an exact match) makes computed_current_price comparable to what users actually
   * search, regardless of write order. Falls back to the plain most-recent-with-a-price
   * observation (the old behaviour) when nothing in the window has a usable departure_date at
   * all, rather than skipping the route outright.
   * -------------------------------------------------------------------------------------
   *
   * @returns {Promise<{price: number, provider: string|null}|null>} null when nothing usable.
   */
  async latestObservedPrice(route, currency, { horizonDays = DEFAULT_REPRESENTATIVE_HORIZON_DAYS } = {}) {
    if (!this.supabase) return null;
    const validCurrency = String(currency || 'USD').toUpperCase().trim();

    try {
      let query = this.supabase
        .from(this.observationsTable)
        .select('roundtrip_price, provider, departure_date')
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
        .limit(OBSERVATION_LOOKBACK);

      if (error) {
        console.warn(`[forecastCache] Observation read failed for ${route}: ${error.message}`);
        return null;
      }

      if (!Array.isArray(data) || data.length === 0) return null;

      const targetMs = this.now() + horizonDays * DAY_MS;
      let closest = null;
      let closestDelta = Infinity;
      let mostRecentValid = null;

      for (const obs of data) {
        const price = Number(obs.roundtrip_price);
        if (!Number.isFinite(price) || price <= 0) continue;

        const candidate = { price, provider: obs.provider || null };
        if (!mostRecentValid) mostRecentValid = candidate; // data is ordered newest-first

        const depMs = Date.parse(`${obs.departure_date}T00:00:00Z`);
        if (!Number.isFinite(depMs)) continue;

        const delta = Math.abs(depMs - targetMs);
        if (delta < closestDelta) {
          closestDelta = delta;
          closest = candidate;
        }
      }

      return closest ?? mostRecentValid;
    } catch (err) {
      console.warn(`[forecastCache] Observation read unreachable for ${route}: ${err.message}`);
      return null;
    }
  }

  /**
   * The cached payload for (route, currency), or null if it fails EITHER gate — freshness or
   * the price sanity check — or if the row is missing or the read errors. Never throws.
   *
   * @param {number} livePrice the fare the user is actually being shown right now.
   */
  async get(route, currency, livePrice, { staleHours = DEFAULT_STALE_HOURS, sanityMultiple = DEFAULT_SANITY_MULTIPLE } = {}) {
    const validCurrency = String(currency || 'USD').toUpperCase().trim();
    const label = `${route}/${validCurrency}`;

    // Miss visibility (P1 diagnostics). Batch writes rows but /api/flights never logged a
    // hit, so a miss was indistinguishable from a hit: we could not tell no_row from stale
    // from a price rejection. Every branch below that returns null now says WHY, with the
    // numbers — that logging is what measured the 8% hit rate KAI-004 then fixed.
    //
    // NOISE CONTROL: only featured routes have rows, so a row-rejected miss (stale / sanity /
    // bad columns) is rare and high-signal — always logged. But no_row and no-client fire on
    // EVERY non-featured search, which would flood the logs, so they are gated behind
    // FORECAST_CACHE_DEBUG (default off; see .env.example).
    const debug = process.env.FORECAST_CACHE_DEBUG === 'true';

    if (!this.supabase) {
      if (debug) console.warn(`[forecastCache] MISS ${label}: no supabase client`);
      return null;
    }

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('payload, computed_at, computed_current_price')
        .eq('route', route)
        .eq('currency', validCurrency)
        .limit(1);

      if (error) {
        console.warn(`[forecastCache] Read failed for ${label}: ${error.message}`);
        return null;
      }

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        if (debug) console.warn(`[forecastCache] MISS ${label}: no cached row`);
        return null;
      }

      // Gate 1: freshness.
      const computedAt = Date.parse(row.computed_at);
      if (!Number.isFinite(computedAt)) {
        console.warn(`[forecastCache] MISS ${label}: unparseable computed_at on row (${row.computed_at})`);
        return null;
      }
      const ageHours = (this.now() - computedAt) / 3_600_000;
      if (ageHours > staleHours) {
        console.warn(`[forecastCache] MISS ${label}: stale ${ageHours.toFixed(1)}h > ${staleHours}h`);
        return null;
      }

      // Gate 2: price sanity. A row with no usable computed_current_price, or a request with
      // no usable live price, cannot be sanity-checked at all — that is a sign of a bad row
      // or a bad call, so we recompute live rather than serve something unverifiable.
      const computedPrice = Number(row.computed_current_price);
      if (!Number.isFinite(computedPrice) || computedPrice <= 0) {
        console.warn(`[forecastCache] MISS ${label}: no computed_current_price on row`);
        return null;
      }
      if (!Number.isFinite(livePrice) || livePrice <= 0) {
        console.warn(`[forecastCache] MISS ${label}: no live price to compare (${livePrice})`);
        return null;
      }

      // Deliberately NOT a percentage: a same-route price difference of even 5x is ordinary
      // seasonality across departure dates (TLV-KRK ran $134-$734), while 20x is a data error.
      const ratio = livePrice / computedPrice;
      if (ratio > sanityMultiple || ratio < 1 / sanityMultiple) {
        console.warn(`[forecastCache] MISS ${label}: sanity ${ratio.toFixed(2)}x outside ${sanityMultiple}x (live ${livePrice} vs cached ${computedPrice})`);
        return null;
      }

      return row.payload ?? null;
    } catch (err) {
      console.warn(`[forecastCache] Read unreachable for ${label}: ${err.message}`);
      return null;
    }
  }
}

export const forecastCache = new ForecastCache({ supabase: getServerSupabase() });
