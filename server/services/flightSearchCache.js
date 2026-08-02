import { TtlCache } from './ttlCache.js';
import { getServerSupabase } from './supabaseServer.js';

/**
 * Durable cache of raw provider flight search results, keyed by route, dates, passenger
 * mix, stops and cabin.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * /api/flights called the active provider on every single request. QuoteCache records
 * the cheapest fare AFTER a search so /api/flights/estimates can borrow a real number for
 * the discovery page, but nothing ever read it back BEFORE paying for a new search — two
 * people (or the same person refreshing) asking for the identical origin, destination,
 * dates, passengers and cabin within the same few minutes triggered two billed provider
 * calls. Unlike API-Sports or Ticketmaster, SerpApi has no free daily allowance at all:
 * every repeat search is a dollar cost, not just latency.
 *
 * Two tiers, the same shape as PersistentDayCache and EventCache: memory first (free,
 * per-process), then Supabase (survives cold starts and deploys, shared by every instance
 * and every user). Render's free tier spins the service down after ~15 minutes idle, so a
 * memory-only cache is really "until nobody uses the app for a quarter of an hour" and
 * every wake-up re-pays for a route someone already searched minutes earlier.
 *
 * Only successful, real provider results are ever cached — never a simulated fallback,
 * and never when simulation IS the active provider. Caching a fallback would keep
 * serving a "the provider is down" substitute long after the provider recovered, and
 * simulated results cost nothing to regenerate, so caching them buys nothing.
 * -------------------------------------------------------------------------------------
 */

/**
 * How long a cached search stays trustworthy. Mirrors QuoteCache's existing judgment
 * that a live fare is good for about this long — airfares move, but not by the minute —
 * while comfortably outlasting Render's ~15 minute idle spin-down, so the durable tier
 * actually gets used rather than expiring before a cold start could read it back.
 */
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Hard ceiling on entries so a long-lived process can't grow without bound. */
const MAX_ENTRIES = 500;

export class FlightSearchCache {
  /**
   * @param {object}  opts
   * @param {object}  [opts.supabase]  Supabase client; without one this is memory-only.
   * @param {string}  [opts.table]     Table name.
   */
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    maxEntries = MAX_ENTRIES,
    now = () => Date.now(),
    supabase = null,
    table = 'flight_search_cache'
  } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.supabase = supabase;
    this.table = table;
    this.memory = new TtlCache({ ttlMs, maxEntries, now });
  }

  /** True when durable storage is wired up. */
  get isPersistent() {
    return Boolean(this.supabase);
  }

  /**
   * Cache key. Deliberately the same shape as QuoteCache.buildKey plus `travelClass`:
   * cabin class is a real SerpApi query parameter that changes what comes back, and a
   * key that ignored it could serve Business results for an Economy search.
   */
  static buildKey({ origin, destination, departureDate, returnDate, passengers = {}, stops = '0', travelClass = '1' }) {
    const { adults = 1, children = 0, infants = 0 } = passengers;
    return [
      String(origin || '').toUpperCase(),
      String(destination || '').toUpperCase(),
      departureDate || '',
      returnDate || '',
      adults,
      children,
      infants,
      stops || '0',
      travelClass || '1'
    ].join('|');
  }

  /** Returns the cached provider result, or null on a miss/expiry. */
  async get(keyParts) {
    const key = FlightSearchCache.buildKey(keyParts);

    const local = this.memory.get(key);
    if (local) return local;

    if (!this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('payload, expires_at')
        .eq('cache_key', key)
        .maybeSingle();

      // A cache miss is survivable; a thrown error here would fail the whole search.
      if (error) {
        console.warn(`[flightSearchCache] Supabase read failed for ${key}: ${error.message}`);
        return null;
      }
      if (!data) return null;
      if (Date.parse(data.expires_at) <= this.now()) return null;

      // Promote into memory so the rest of this request — and this process — is free.
      this.memory.set(key, data.payload);
      return data.payload;
    } catch (err) {
      console.warn(`[flightSearchCache] Supabase unreachable for ${key}: ${err.message}`);
      return null;
    }
  }

  /**
   * Stores a real provider result. Callers must not pass a simulated/fallback result —
   * see the class-level comment for why.
   */
  async set(keyParts, results) {
    const key = FlightSearchCache.buildKey(keyParts);
    this.memory.set(key, results);

    if (!this.supabase) return results;

    const expiresAt = new Date(this.now() + this.ttlMs).toISOString();

    try {
      const { error } = await this.supabase.from(this.table).upsert(
        {
          cache_key: key,
          origin: String(keyParts.origin || '').toUpperCase(),
          destination: String(keyParts.destination || '').toUpperCase(),
          departure_date: keyParts.departureDate || null,
          return_date: keyParts.returnDate || null,
          payload: results,
          expires_at: expiresAt,
          updated_at: new Date(this.now()).toISOString()
        },
        { onConflict: 'cache_key' }
      );

      // Failing to WRITE the cache costs a future API call. It must never cost this search.
      if (error) console.warn(`[flightSearchCache] Supabase write failed for ${key}: ${error.message}`);
    } catch (err) {
      console.warn(`[flightSearchCache] Supabase write unreachable for ${key}: ${err.message}`);
    }

    return results;
  }

  /** Drops the in-process tier. Durable rows expire on their own. Used by tests. */
  clear() {
    this.memory.clear();
  }

  get size() {
    return this.memory.size;
  }
}

/** Shared instance used by the API layer. */
export const flightSearchCache = new FlightSearchCache({ supabase: getServerSupabase() });
