/**
 * Token-bucket rate limiter for outbound provider calls.
 *
 * Why: /api/events/batch fans out over ~31 destinations with Promise.allSettled, which
 * fires them all in the same second. Ticketmaster allows 5 requests per second, so most
 * of that burst came back 429 — and because a non-200 was read as "no events", those
 * destinations silently disappeared from the discovery page as though nothing was on.
 *
 * Each provider gets its own bucket because the free-tier limits differ by orders of
 * magnitude: Ticketmaster 5/second, TheSportsDB 30/minute, API-Sports 100/day.
 */
export class RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.limit      Requests allowed per window.
   * @param {number} options.windowMs   Window length in milliseconds.
   * @param {string} [options.name]     Label for logging.
   */
  constructor({ limit, windowMs, name = 'provider', minGapMs, onAcquire, now = () => Date.now(), sleep } = {}) {
    if (!limit || !windowMs) throw new Error('RateLimiter requires limit and windowMs');

    this.limit = limit;
    this.windowMs = windowMs;
    this.name = name;
    this.now = now;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    /*
      Called with the timestamp at the moment a token is consumed.

      Exists because measuring from outside is unreliable: a caller that records the clock
      after `await acquire()` sees whatever value other queued waiters have advanced it to
      by the time its continuation runs. That produced a phantom "6 calls in one window"
      and a duplicate timestamp in an earlier version of the pacing test — the limiter was
      correct and the measurement was not.
    */
    this.onAcquire = onAcquire || null;

    /*
      Minimum gap between consecutive calls, so the allowance is spread across the window
      rather than fired as a burst. Defaults to an even spread (window / limit), which for
      Ticketmaster's 5/second means roughly 200ms apart. Callers with a very high limit —
      the tests' effectively-unlimited limiter — get no gap.
    */
    this.minGapMs = minGapMs ?? (limit > 1000 ? 0 : Math.floor(windowMs / limit));

    // Timestamps of calls still inside the current window.
    this.recent = [];
    // Serialises waiters so concurrent callers don't all claim the same token.
    this.chain = Promise.resolve();
  }

  #prune() {
    const cutoff = this.now() - this.windowMs;
    while (this.recent.length > 0 && this.recent[0] <= cutoff) {
      this.recent.shift();
    }
  }

  /**
   * Milliseconds until the next call may go out; 0 when one may go now.
   *
   * Two constraints. The window budget, and a minimum gap between consecutive calls.
   *
   * The gap matters because a plain token bucket permits the whole allowance in the same
   * millisecond — five simultaneous requests are technically "5 per second" but arrive as a
   * burst, and Ticketmaster answered one of them with a 429 in production. Spacing calls
   * across the window is the same throughput with none of the spikiness.
   */
  msUntilAvailable() {
    this.#prune();

    const budgetWait =
      this.recent.length < this.limit ? 0 : Math.max(0, this.recent[0] + this.windowMs - this.now());

    const last = this.recent[this.recent.length - 1];
    const spacingWait = last === undefined ? 0 : Math.max(0, last + this.minGapMs - this.now());

    return Math.max(budgetWait, spacingWait);
  }

  /**
   * Resolves once a token is available, then consumes it.
   *
   * Calls are queued in arrival order, so a fan-out of 31 against a 5/second budget
   * completes in about six seconds rather than being throttled away.
   */
  async acquire() {
    const wait = this.chain.then(async () => {
      let delay = this.msUntilAvailable();
      while (delay > 0) {
        await this.sleep(delay);
        delay = this.msUntilAvailable();
      }
      const consumedAt = this.now();
      this.recent.push(consumedAt);
      if (this.onAcquire) this.onAcquire(consumedAt);
    });

    // Keep the chain alive even if a waiter throws.
    this.chain = wait.catch(() => {});
    return wait;
  }

  /** Runs fn once a token is available. */
  async schedule(fn) {
    await this.acquire();
    return fn();
  }

  /** Calls consumed in the current window. Exposed for tests and diagnostics. */
  get used() {
    this.#prune();
    return this.recent.length;
  }

  reset() {
    this.recent = [];
    this.chain = Promise.resolve();
  }
}

/**
 * Documented free-tier ceilings, kept in one place so a provider can't quietly disagree
 * with the limit it was written against.
 *
 * Ticketmaster Discovery: 5,000/day and 5/second.
 * API-Sports free:        100/day and 10/minute. The DAILY cap is the binding one, so a
 *                         provider built on it must query by date (a handful of calls per
 *                         travel window) rather than per destination (~31 per search).
 *
 * TheSportsDB was evaluated and dropped: its free tier limits RESULTS, not requests —
 * eventsday.php returns 3 events per day worldwide — so it cannot locate a city's events.
 */
export const PROVIDER_LIMITS = {
  ticketmaster: { limit: 5, windowMs: 1000, name: 'ticketmaster' },
  apisports: { limit: 10, windowMs: 60_000, name: 'apisports' }
};

/** Shared limiter per provider, so every caller in the process shares one budget. */
const limiters = new Map();

/**
 * @param {string} providerKey
 * @param {object} [fallbackConfig] Used when the key has no published ceiling — a provider
 *   that makes no outbound calls (the simulated engine) declares its own nominal limit
 *   rather than appearing in PROVIDER_LIMITS, which is reserved for real APIs.
 */
export function getLimiter(providerKey, fallbackConfig) {
  if (!limiters.has(providerKey)) {
    const config = PROVIDER_LIMITS[providerKey] || fallbackConfig;
    if (!config) throw new Error(`No rate limit configured for provider: ${providerKey}`);
    limiters.set(providerKey, new RateLimiter({ ...config, name: providerKey }));
  }
  return limiters.get(providerKey);
}

/** Test seam: drop the memoised limiters so budgets don't leak between cases. */
export function resetLimiters() {
  limiters.clear();
}
