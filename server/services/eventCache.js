import { TtlCache } from './ttlCache.js';
import { getServerSupabase } from './supabaseServer.js';

/**
 * Cache of event lookups, keyed by destination and travel window.
 *
 * Before this there was no event cache at all: every debounced keystroke on the discovery
 * page re-queried all ~31 destinations. Against Ticketmaster's 5,000/day budget that is
 * roughly 161 searches per day for the entire product.
 *
 * The key is (destination, start, end) rather than anything per-user, so two people
 * searching the same dates share the same entry and only a cold window pays the
 * rate-limited fan-out.
 *
 * -------------------------------------------------------------------------------------
 * TWO TIERS
 *
 * Memory first (free, per-process), then Supabase (survives cold starts and deploys,
 * shared by every instance and every user). The provider call is the expensive tier and
 * is the last resort.
 *
 * The memory-only version advertised a six-hour TTL that was fiction in production:
 * Render's free tier spins the service down after ~15 minutes idle and the Map goes with
 * it, so a user re-running yesterday's search — or the same search after lunch — paid the
 * full fan-out again for dates the app had already looked up.
 *
 * Supabase rather than Redis or SQLite for the same reason PersistentDayCache chose it:
 * the project already has a Postgres, Render's free disk is ephemeral, and a second
 * service is not worth running for something Postgres already does here.
 * -------------------------------------------------------------------------------------
 */

/** Event schedules change far more slowly than fares. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * A failed lookup is cached only briefly. Long enough to stop a refresh loop from
 * hammering a provider that is currently throttling us, short enough that a transient
 * 429 doesn't hide a destination for hours.
 */
const FAILURE_TTL_MS = 60 * 1000; // 1 minute

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Outcome of an event lookup. */
export const EventStatus = {
  /** Provider answered and there are events in the window. */
  OK: 'ok',
  /** Provider answered and there are genuinely no events in the window. */
  EMPTY: 'empty',
  /** We could not find out — rate limited, server error, or transport failure. */
  UNAVAILABLE: 'unavailable'
};

/**
 * How long a durable row stays trustworthy, as a function of how far away the window is.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS IS A LADDER AND NOT A CONSTANT
 *
 * A flat TTL is wrong at both ends, for opposite reasons.
 *
 * At the near end it is too long. Inside a couple of days a lineup firms up, kickoff times
 * move and matches get postponed, and a row written before a postponement would keep
 * advertising a cancelled match to every instance rather than just to the one process that
 * fetched it — the cost of making the cache durable.
 *
 * At the far end it is far too short, and that end is where the budget actually goes.
 * API-Sports is capped at 80 calls a day (apiSportsProvider.js) and one cold discovery
 * search fans out across ~31 destinations, so the entire daily ceiling buys fewer than
 * three cold searches. At a flat six hours, a window three weeks out is re-fetched four
 * times a day for a schedule that was fixed months ago. Those repeats are not paying for
 * freshness, they are paying for a timer.
 *
 * Scaling the far end is the cheapest capacity the system has: it costs no API calls, no
 * new infrastructure and no new failure mode, and it multiplies what the same 80 calls
 * cover. It is worth doing before anything that SPENDS from that ceiling — a pre-warm job
 * moves budget from reactive to speculative, it does not create any.
 *
 * WHAT IT COSTS, STATED PLAINLY: a newly announced event in a far window can stay
 * invisible for up to the tier's TTL — three days at the top step. That is the real
 * trade. It is accepted because the near steps keep imminent travel fresh, and because a
 * concert announced today for a date six weeks out does not change whether the flight is
 * worth booking this afternoon.
 *
 * Steps are multiples of the caller's ttlMs rather than absolute durations, so a caller
 * that lowers ttlMs lowers the whole ladder with it instead of silently keeping
 * three-day rows.
 * -------------------------------------------------------------------------------------
 */
const TTL_LADDER = [
  // Postponements and kickoff changes land here. Held for an hour at most.
  { withinDays: 2, multiplier: 1 / 6, cap: HOUR_MS },
  // Close enough that late additions still matter. The historical default.
  { withinDays: 7, multiplier: 1 },
  // Schedules are settled; re-checking four times a day buys nothing.
  { withinDays: 30, multiplier: 4 },
  // Fixture lists and tour dates at this range were published long ago.
  { withinDays: Infinity, multiplier: 12 }
];

export const durableTtlMs = (startDate, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) => {
  const daysAway = (Date.parse(`${startDate}T00:00:00Z`) - now) / DAY_MS;

  // Unparseable or missing: the neutral default, never NaN.
  if (!Number.isFinite(daysAway)) return ttlMs;

  const step = TTL_LADDER.find((s) => daysAway < s.withinDays);
  const ttl = ttlMs * step.multiplier;

  // `cap` exists so the near step stays an hour even if a caller raises ttlMs. Freshness
  // close to departure is a correctness requirement, not a tunable.
  return step.cap ? Math.min(step.cap, ttl) : ttl;
};

export class EventCache {
  /**
   * @param {object}   opts
   * @param {object}   [opts.supabase]  Supabase client. Null (the default) is memory-only,
   *                                    which is what every unit test wants.
   * @param {string}   [opts.table]     Durable table name.
   */
  constructor({
    ttlMs = DEFAULT_TTL_MS,
    failureTtlMs = FAILURE_TTL_MS,
    maxEntries = 800,
    now = () => Date.now(),
    supabase = null,
    table = 'event_cache'
  } = {}) {
    this.successStore = new TtlCache({ ttlMs, maxEntries, now });
    this.failureStore = new TtlCache({ ttlMs: failureTtlMs, maxEntries, now });
    this.ttlMs = ttlMs;
    this.now = now;
    this.supabase = supabase;
    this.table = table;
  }

  /** True when durable storage is wired up. */
  get isPersistent() {
    return Boolean(this.supabase);
  }

  static buildKey({ destination, startDate, endDate, provider = 'all' }) {
    return [provider, String(destination || '').toUpperCase(), startDate || '', endDate || ''].join('|');
  }

  /** Returns a cached result, or null on a miss. */
  async get(keyParts) {
    const key = EventCache.buildKey(keyParts);

    const local = this.successStore.get(key) ?? this.failureStore.get(key);
    if (local) return local;

    if (!this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('payload, expires_at')
        .eq('cache_key', key)
        .maybeSingle();

      // A cache miss is survivable; throwing here would fail the whole search.
      if (error) {
        console.warn(`[eventCache] Supabase read failed for ${key}: ${error.message}`);
        return null;
      }
      if (!data) return null;
      if (Date.parse(data.expires_at) <= this.now()) return null;

      // Promote so the rest of this request — and this process — is free.
      this.successStore.set(key, data.payload);
      return data.payload;
    } catch (err) {
      console.warn(`[eventCache] Supabase unreachable for ${key}: ${err.message}`);
      return null;
    }
  }

  /**
   * Loads many keys in ONE query and promotes the live ones into memory.
   *
   * The discovery page asks about ~31 destinations at once. Reading them one at a time
   * would trade 31 provider calls for 31 database round trips, which on a cold start is
   * most of the latency the cache exists to remove. Callers warm the memory tier with
   * this, then read each destination normally.
   *
   * @returns {Promise<number>} how many keys were served from durable storage.
   */
  async prefetch(keyPartsList = []) {
    if (!this.supabase || keyPartsList.length === 0) return 0;

    const keys = keyPartsList
      .map((parts) => EventCache.buildKey(parts))
      .filter((key) => !this.successStore.has(key) && !this.failureStore.has(key));

    if (keys.length === 0) return 0;

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('cache_key, payload, expires_at')
        .in('cache_key', keys);

      if (error) {
        console.warn(`[eventCache] Supabase batch read failed: ${error.message}`);
        return 0;
      }

      let promoted = 0;
      for (const row of data || []) {
        if (Date.parse(row.expires_at) <= this.now()) continue;
        this.successStore.set(row.cache_key, row.payload);
        promoted += 1;
      }
      return promoted;
    } catch (err) {
      console.warn(`[eventCache] Supabase unreachable during batch read: ${err.message}`);
      return 0;
    }
  }

  /**
   * Stores a result.
   *
   * UNAVAILABLE goes to the short-lived memory store and is deliberately NEVER persisted:
   * the point of its one-minute TTL is a fast retry, and writing a transient 429 to a
   * table every instance reads would turn one throttled process into a product-wide
   * outage for as long as the row lived.
   */
  async set(keyParts, result) {
    const key = EventCache.buildKey(keyParts);

    if (result.status === EventStatus.UNAVAILABLE) {
      return this.failureStore.set(key, result);
    }

    this.successStore.set(key, result);
    if (!this.supabase) return result;

    const ttl = durableTtlMs(keyParts.startDate, { ttlMs: this.ttlMs, now: this.now() });
    const expiresAt = new Date(this.now() + ttl).toISOString();

    try {
      const { error } = await this.supabase.from(this.table).upsert(
        {
          cache_key: key,
          destination: String(keyParts.destination || '').toUpperCase(),
          start_date: keyParts.startDate || null,
          end_date: keyParts.endDate || null,
          status: result.status,
          payload: result,
          expires_at: expiresAt,
          updated_at: new Date(this.now()).toISOString()
        },
        { onConflict: 'cache_key' }
      );

      // Failing to WRITE the cache costs a future API call. It must never cost this search.
      if (error) console.warn(`[eventCache] Supabase write failed for ${key}: ${error.message}`);
    } catch (err) {
      console.warn(`[eventCache] Supabase write unreachable for ${key}: ${err.message}`);
    }

    return result;
  }

  /** Drops the in-process tiers. Durable rows expire on their own. */
  clear() {
    this.successStore.clear();
    this.failureStore.clear();
  }

  get size() {
    return this.successStore.size + this.failureStore.size;
  }
}

export const eventCache = new EventCache({ supabase: getServerSupabase() });
