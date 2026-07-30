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
  constructor({ limit, windowMs, name = 'provider', now = () => Date.now(), sleep } = {}) {
    if (!limit || !windowMs) throw new Error('RateLimiter requires limit and windowMs');

    this.limit = limit;
    this.windowMs = windowMs;
    this.name = name;
    this.now = now;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

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

  /** Milliseconds until a token frees up; 0 when one is available now. */
  msUntilAvailable() {
    this.#prune();
    if (this.recent.length < this.limit) return 0;
    return Math.max(0, this.recent[0] + this.windowMs - this.now());
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
      this.recent.push(this.now());
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
 * TheSportsDB free:       30/minute.
 * API-Sports free:        100/day and 10/minute — the daily cap is the binding one, and
 *                         is why that provider cannot back a per-destination fan-out.
 */
export const PROVIDER_LIMITS = {
  ticketmaster: { limit: 5, windowMs: 1000, name: 'ticketmaster' },
  thesportsdb: { limit: 30, windowMs: 60_000, name: 'thesportsdb' },
  apisports: { limit: 10, windowMs: 60_000, name: 'apisports' }
};

/** Shared limiter per provider, so every caller in the process shares one budget. */
const limiters = new Map();

export function getLimiter(providerKey) {
  if (!limiters.has(providerKey)) {
    const config = PROVIDER_LIMITS[providerKey];
    if (!config) throw new Error(`No rate limit configured for provider: ${providerKey}`);
    limiters.set(providerKey, new RateLimiter(config));
  }
  return limiters.get(providerKey);
}
