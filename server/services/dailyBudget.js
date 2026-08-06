/**
 * A hard daily ceiling on outbound calls to a provider.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * rateLimiter.js documented the constraint accurately —
 *
 *     "API-Sports free: 100/day and 10/minute. The DAILY cap is the binding one"
 *
 * — and then enforced only the per-minute half. That gap is what let the original incident
 * run to completion: the limiter paced requests perfectly, six seconds apart, and went on
 * pacing them all the way past a hundred until the account was suspended.
 *
 * A rate limit is not a ceiling. It controls how fast the budget is spent, not whether it
 * runs out. This is the ceiling.
 * -------------------------------------------------------------------------------------
 *
 * The counter is stored in Postgres rather than memory because Render's free tier restarts
 * the service constantly, and a counter that resets on every cold start enforces nothing.
 * Without a database this degrades to an in-process count and says so — better than
 * nothing, but explicitly not a guarantee.
 */

/** UTC, because the provider's quota resets on its clock and not the server's. */
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export class DailyBudget {
  /**
   * @param {object}  opts
   * @param {string}  opts.provider  Provider key, so several can share one table.
   * @param {number}  opts.limit     Ceiling. Set BELOW the real quota, deliberately.
   * @param {object}  [opts.supabase]
   */
  constructor({ provider, limit, supabase = null, table = 'api_usage_daily', now = () => Date.now() } = {}) {
    if (!provider) throw new Error('DailyBudget requires a provider');

    /*
      Zero is a legitimate ceiling meaning "block every call", so the check is for a valid
      number rather than a truthy one. `if (!limit)` rejected it, which would have made the
      one setting that guarantees no outbound traffic impossible to express.
    */
    if (!Number.isFinite(limit) || limit < 0) {
      throw new Error('DailyBudget requires a limit (a non-negative number)');
    }

    this.provider = provider;
    this.limit = limit;
    this.supabase = supabase;
    this.table = table;
    this.now = now;

    // Local mirror, so an exhausted budget short-circuits without a round trip.
    this.localDay = null;
    this.localCount = 0;
    this.warned = false;
  }

  get isDurable() {
    return Boolean(this.supabase);
  }

  #resetIfNewDay(day) {
    if (this.localDay !== day) {
      this.localDay = day;
      this.localCount = 0;
      this.warned = false;
    }
  }

  /**
   * Reserves one call.
   *
   * @returns {Promise<{allowed: boolean, used: number, remaining: number}>}
   */
  async consume() {
    const day = utcDay(this.now());
    this.#resetIfNewDay(day);

    // Fast path: already known to be exhausted today.
    if (this.localCount >= this.limit) {
      this.#warnOnce(day);
      return { allowed: false, used: this.localCount, remaining: 0 };
    }

    if (!this.supabase) {
      this.localCount += 1;
      const allowed = this.localCount <= this.limit;
      if (!allowed) this.#warnOnce(day);
      return { allowed, used: this.localCount, remaining: Math.max(0, this.limit - this.localCount) };
    }

    try {
      /*
        Atomic increment in the database, so concurrent requests and multiple instances
        cannot each read "99" and all decide they may proceed. Returns the count AFTER
        incrementing.
      */
      const { data, error } = await this.supabase.rpc('increment_api_usage', {
        p_provider: this.provider,
        p_day: day
      });

      if (error) throw new Error(error.message);

      const used = typeof data === 'number' ? data : data?.calls ?? 0;
      this.localCount = Math.max(this.localCount, used);

      const allowed = used <= this.limit;
      if (!allowed) this.#warnOnce(day);
      return { allowed, used, remaining: Math.max(0, this.limit - used) };
    } catch (err) {
      /*
        The database is unreachable. Fall back to the local count rather than blocking the
        provider outright: a cache/accounting outage should degrade the guarantee, not the
        feature. The local count still bounds any runaway within this process.
      */
      console.warn(`[budget] ${this.provider}: usage store unreachable (${err.message}); counting in memory only.`);
      this.localCount += 1;
      const allowed = this.localCount <= this.limit;
      if (!allowed) this.#warnOnce(day);
      return { allowed, used: this.localCount, remaining: Math.max(0, this.limit - this.localCount) };
    }
  }

  #warnOnce(day) {
    if (this.warned) return;
    this.warned = true;
    console.warn(
      `[budget] ${this.provider}: daily ceiling of ${this.limit} reached for ${day}. ` +
      'Further calls are blocked until 00:00 UTC. Destinations will report "not checked", ' +
      'never "no events" — a suppressed lookup is not an empty one.'
    );
  }
}
