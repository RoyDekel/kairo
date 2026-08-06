/**
 * Generic in-memory cache with a TTL and LRU eviction.
 *
 * Extracted from quoteCache.js so the fare cache and the new event cache share one
 * implementation instead of each hand-rolling expiry and eviction.
 *
 * Deliberately process-local: this is a cost and latency optimisation, not a store of
 * record. On a multi-instance deploy each instance warms its own copy. Swap for Redis if
 * cross-instance consistency ever matters.
 */
export class TtlCache {
  constructor({ ttlMs, maxEntries = 500, now = () => Date.now() } = {}) {
    if (!ttlMs) throw new Error('TtlCache requires a ttlMs');
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.entries = new Map();
  }

  /** Returns the stored value, or null when absent or expired. */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (this.now() - entry.storedAtMs > this.ttlMs) {
      this.entries.delete(key);
      return null;
    }

    // Refresh recency so eviction below is genuinely least-recently-used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** Stores a value, evicting the least recently used entries at capacity. */
  set(key, value) {
    while (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, { value, storedAtMs: this.now() });
    return value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }
}
