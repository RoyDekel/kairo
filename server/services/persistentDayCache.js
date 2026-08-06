import { TtlCache } from './ttlCache.js';

/**
 * A day cache that survives the process.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The in-memory TtlCache claimed a six-hour TTL. On Render's free tier that was fiction:
 * the service spins down after ~15 minutes without traffic and the Map goes with it. For
 * a low-traffic app that means almost every search is a cold start paying full price, so
 * the real TTL was "until you stop using the app for a quarter of an hour".
 *
 * Two tiers: memory first (free, per-process), then Supabase (survives cold starts and
 * deploys, shared by every instance and every user). Only the API is expensive, and it is
 * the last resort.
 *
 * Supabase rather than Redis or SQLite because the project already has one: Render's free
 * disk is ephemeral, so SQLite would be exactly as volatile as the Map it replaced, and
 * Redis would be a second service to run for something Postgres already does here.
 * -------------------------------------------------------------------------------------
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * How long a day's fixture list stays trustworthy, by distance from today.
 *
 * A flat 24 hours is wrong in both directions. Tomorrow's fixtures DO move — kickoff times
 * shift and matches get postponed, and since we filter on PLANNED_STATUSES a postponement
 * we failed to notice would show a cancelled match as playing. Fixtures months out barely
 * change at all and can be held far longer.
 *
 * The exception is an EMPTY far-future day, which usually means the schedule has not been
 * published yet rather than that nothing is on. Caching that for days would keep the
 * absence long after the real fixtures appeared.
 */
export const ttlForDate = (date, { isEmpty = false, now = Date.now() } = {}) => {
  const daysAway = (Date.parse(`${date}T00:00:00Z`) - now) / DAY;

  if (!Number.isFinite(daysAway)) return 6 * HOUR;
  if (daysAway < 2) return HOUR;          // in flux: times move, matches get postponed
  if (daysAway < 30) return DAY;
  return isEmpty ? DAY : 3 * DAY;         // far out and empty: the schedule may not be out
};

/**
 * Memory in front, Supabase behind. Interface-compatible with TtlCache except that get()
 * and set() are async, which callers must await.
 */
export class PersistentDayCache {
  /**
   * @param {object}  opts
   * @param {object}  [opts.supabase]  Supabase client; without one this is memory-only.
   * @param {string}  [opts.table]     Table name.
   * @param {TtlCache}[opts.memory]    Front tier, injectable for tests.
   */
  constructor({ supabase = null, table = 'fixtures_cache', memory, now = () => Date.now() } = {}) {
    this.supabase = supabase;
    this.table = table;
    this.now = now;

    // The front tier holds entries for an hour at most; the durable TTL lives in Postgres,
    // so a long-lived row is not pinned in memory by a stale local copy.
    this.memory = memory || new TtlCache({ ttlMs: HOUR, maxEntries: 120, now });
  }

  /** True when durable storage is wired up. */
  get isPersistent() {
    return Boolean(this.supabase);
  }

  async get(date) {
    const local = this.memory.get(date);
    if (local) return local;

    if (!this.supabase) return null;

    try {
      const { data, error } = await this.supabase
        .from(this.table)
        .select('payload, expires_at')
        .eq('fixture_date', date)
        .maybeSingle();

      if (error) {
        // A cache miss is survivable; a thrown error here would fail the whole search.
        console.warn(`[dayCache] Supabase read failed for ${date}: ${error.message}`);
        return null;
      }
      if (!data) return null;

      if (Date.parse(data.expires_at) <= this.now()) return null;

      // Promote into memory so the rest of this request is free.
      this.memory.set(date, data.payload);
      return data.payload;
    } catch (err) {
      console.warn(`[dayCache] Supabase unreachable for ${date}: ${err.message}`);
      return null;
    }
  }

  async set(date, value) {
    this.memory.set(date, value);
    if (!this.supabase) return;

    const isEmpty = !value?.fixtures?.length;
    const expiresAt = new Date(this.now() + ttlForDate(date, { isEmpty, now: this.now() }));

    try {
      const { error } = await this.supabase
        .from(this.table)
        .upsert(
          { fixture_date: date, payload: value, expires_at: expiresAt.toISOString() },
          { onConflict: 'fixture_date' }
        );

      // Failing to WRITE the cache costs a future API call. It must never cost this search.
      if (error) console.warn(`[dayCache] Supabase write failed for ${date}: ${error.message}`);
    } catch (err) {
      console.warn(`[dayCache] Supabase write unreachable for ${date}: ${err.message}`);
    }
  }

  clear() {
    this.memory.clear();
  }
}
