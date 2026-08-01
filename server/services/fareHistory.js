import { getServerSupabase } from './supabaseServer.js';

/**
 * The record of fares KAIRO has actually observed, and the statistics drawn from it.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * "23% below the historical average" was computed against `price * 1.35`. Defining the
 * baseline as a multiple of the number being measured makes the result a constant: the
 * saving was always 26%, the 90-day percentile always 43, and the match score always 81.
 * Every one of those figures was arithmetic dressed as evidence.
 *
 * A real baseline needs observations, so this records them. Two properties matter:
 *
 *   1. Only REAL provider quotes are stored. Recording simulated estimates would build a
 *      history of the model's opinion of itself.
 *   2. The absence of history is reported, not filled in. Below MIN_OBSERVATIONS the
 *      percentile is null and the UI shows a fare with no claim attached to it.
 * -------------------------------------------------------------------------------------
 */

/** Below this, a percentile describes the sample rather than the market. */
export const MIN_OBSERVATIONS = 5;

/** Older fares describe a different market: schedules, seasons and capacity have moved. */
const DEFAULT_WINDOW_DAYS = 90;

/** Ceiling on rows pulled for one discovery search. */
const MAX_ROWS = 4000;

/**
 * Share of observations strictly cheaper than `price`, 0-100.
 *
 * 0 means nothing on record was cheaper — the best fare we have ever seen for the route.
 * 100 means everything was cheaper.
 */
export function percentileOf(price, prices = []) {
  if (!prices.length) return null;
  const cheaper = prices.reduce((n, p) => (p < price ? n + 1 : n), 0);
  return Math.round((cheaper / prices.length) * 100);
}

/** Median, which describes a skewed fare distribution far better than a mean. */
export function medianOf(prices = []) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : Math.round(sorted[mid]);
}

export class FareHistory {
  constructor({ supabase = null, table = 'fare_observations', windowDays = DEFAULT_WINDOW_DAYS, now = () => Date.now() } = {}) {
    this.supabase = supabase;
    this.table = table;
    this.windowDays = windowDays;
    this.now = now;
  }

  get isEnabled() {
    return Boolean(this.supabase);
  }

  static routeKey(origin, destination) {
    return `${String(origin || '').toUpperCase()}-${String(destination || '').toUpperCase()}`;
  }

  /**
   * Records one observed roundtrip fare.
   *
   * `provider` must be the real provider that quoted it. A simulated fare is rejected here
   * rather than at the call site, so a future caller cannot poison the baseline by
   * forgetting the check.
   */
  async record({ origin, destination, departureDate, returnDate, roundtripPrice, provider }) {
    if (!this.supabase) return false;
    if (!provider || provider === 'simulated') return false;
    if (!Number.isFinite(roundtripPrice) || roundtripPrice <= 0) return false;

    const tripNights =
      departureDate && returnDate
        ? Math.round((Date.parse(returnDate) - Date.parse(departureDate)) / 86_400_000)
        : null;

    try {
      const { error } = await this.supabase.from(this.table).insert({
        route: FareHistory.routeKey(origin, destination),
        origin: String(origin).toUpperCase(),
        destination: String(destination).toUpperCase(),
        departure_date: departureDate || null,
        return_date: returnDate || null,
        trip_nights: Number.isFinite(tripNights) ? tripNights : null,
        roundtrip_price: roundtripPrice,
        provider,
        observed_at: new Date(this.now()).toISOString()
      });

      // Losing an observation costs a slightly thinner baseline. It must never cost the search.
      if (error) {
        console.warn(`[fareHistory] Write failed for ${origin}-${destination}: ${error.message}`);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[fareHistory] Write unreachable for ${origin}-${destination}: ${err.message}`);
      return false;
    }
  }

  /**
   * Statistics for many routes in ONE query.
   *
   * The discovery page prices ~31 destinations at once; a per-route query would make the
   * historical baseline cost more than the fares it describes.
   *
   * @returns {Promise<Record<string, {sampleSize: number, typicalPrice: number|null, prices: number[]}>>}
   */
  async statsForRoutes(routeKeys = []) {
    const stats = {};
    if (!this.supabase || routeKeys.length === 0) return stats;

    const since = new Date(this.now() - this.windowDays * 86_400_000).toISOString();

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('route, roundtrip_price')
        .in('route', [...new Set(routeKeys)])
        .gte('observed_at', since)
        .limit(MAX_ROWS);

      if (error) {
        console.warn(`[fareHistory] Read failed: ${error.message}`);
        return stats;
      }

      for (const row of data || []) {
        const price = Number(row.roundtrip_price);
        if (!Number.isFinite(price)) continue;
        (stats[row.route] ||= { sampleSize: 0, typicalPrice: null, prices: [] }).prices.push(price);
      }

      for (const entry of Object.values(stats)) {
        entry.sampleSize = entry.prices.length;
        entry.typicalPrice = medianOf(entry.prices);
      }

      return stats;
    } catch (err) {
      console.warn(`[fareHistory] Read unreachable: ${err.message}`);
      return stats;
    }
  }

  /**
   * Where a fare sits in its route's recent history.
   *
   * Returns nulls rather than a number when the sample is too small to mean anything —
   * the caller is expected to say "no history yet", not to invent a baseline.
   */
  summarise(price, entry) {
    const prices = entry?.prices || [];
    if (prices.length < MIN_OBSERVATIONS) {
      return { historicalPercentile: null, historicalSampleSize: prices.length, typicalPrice: null };
    }

    return {
      historicalPercentile: percentileOf(price, prices),
      historicalSampleSize: prices.length,
      typicalPrice: medianOf(prices)
    };
  }
}

export const fareHistory = new FareHistory({ supabase: getServerSupabase() });
