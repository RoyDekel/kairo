import { TtlCache } from './ttlCache.js';

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
 */

/** Event schedules change far more slowly than fares. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * A failed lookup is cached only briefly. Long enough to stop a refresh loop from
 * hammering a provider that is currently throttling us, short enough that a transient
 * 429 doesn't hide a destination for hours.
 */
const FAILURE_TTL_MS = 60 * 1000; // 1 minute

/** Outcome of an event lookup. */
export const EventStatus = {
  /** Provider answered and there are events in the window. */
  OK: 'ok',
  /** Provider answered and there are genuinely no events in the window. */
  EMPTY: 'empty',
  /** We could not find out — rate limited, server error, or transport failure. */
  UNAVAILABLE: 'unavailable'
};

export class EventCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, failureTtlMs = FAILURE_TTL_MS, maxEntries = 800, now = () => Date.now() } = {}) {
    this.successStore = new TtlCache({ ttlMs, maxEntries, now });
    this.failureStore = new TtlCache({ ttlMs: failureTtlMs, maxEntries, now });
  }

  static buildKey({ destination, startDate, endDate, provider = 'all' }) {
    return [provider, String(destination || '').toUpperCase(), startDate || '', endDate || ''].join('|');
  }

  /** Returns a cached result, or null on a miss. */
  get(keyParts) {
    const key = EventCache.buildKey(keyParts);
    return this.successStore.get(key) ?? this.failureStore.get(key);
  }

  /**
   * Stores a result. UNAVAILABLE goes to the short-lived store so a throttled destination
   * gets retried soon rather than being written off for the full TTL.
   */
  set(keyParts, result) {
    const key = EventCache.buildKey(keyParts);
    const store = result.status === EventStatus.UNAVAILABLE ? this.failureStore : this.successStore;
    return store.set(key, result);
  }

  clear() {
    this.successStore.clear();
    this.failureStore.clear();
  }

  get size() {
    return this.successStore.size + this.failureStore.size;
  }
}

export const eventCache = new EventCache();
