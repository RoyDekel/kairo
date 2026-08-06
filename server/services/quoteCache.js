/**
 * In-memory cache of the cheapest roundtrip fare KAIRO has seen per route.
 *
 * This is what makes "When to Go" and "Search & Compare" agree. The discovery page
 * cannot afford a real provider search for all ~31 destinations (SerpApi bills per
 * search), so it asks for estimates. Whenever /api/flights performs a real search, the
 * resulting fare is recorded here; the estimates endpoint then serves that exact number
 * instead of a simulated one, and the two pages quote identically for any route the
 * user has actually opened.
 *
 * Deliberately process-local: this is a cost/latency optimisation, not a store of
 * record. On a multi-instance deploy each instance simply warms its own copy. Swap the
 * Map for Redis if that ever stops being acceptable.
 */

import { TtlCache } from './ttlCache.js';

/** How long a live provider quote stays trustworthy. Airfares move, but not by the minute. */
const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Hard ceiling on entries so a long-lived process can't grow without bound. */
const MAX_ENTRIES = 500;

export class QuoteCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    // Expiry and LRU eviction live in TtlCache, shared with the event cache.
    this.store = new TtlCache({ ttlMs, maxEntries, now });
  }

  /**
   * Cache key. Passenger counts and stops are included because they change the fare,
   * so a 2-adult quote must never be served for a 1-adult query.
   */
  static buildKey({ origin, destination, departureDate, returnDate, passengers = {}, stops = '0' }) {
    const { adults = 1, children = 0, infants = 0 } = passengers;
    return [
      String(origin || '').toUpperCase(),
      String(destination || '').toUpperCase(),
      departureDate || '',
      returnDate || '',
      adults,
      children,
      infants,
      stops
    ].join('|');
  }

  /** Returns the cached quote, or null when absent or expired. */
  get(keyParts) {
    return this.store.get(QuoteCache.buildKey(keyParts));
  }

  /**
   * Records a fare. `source` should be the provider name that produced it, so the client
   * can label a number as a real quote rather than an estimate.
   */
  set(keyParts, { roundtripPrice, outbound, return: returnFlight, source }) {
    const entry = {
      roundtripPrice,
      outbound,
      return: returnFlight,
      source,
      quotedAtMs: this.now(),
      quotedAt: new Date(this.now()).toISOString()
    };

    return this.store.set(QuoteCache.buildKey(keyParts), entry);
  }

  /** Drops every entry. Used by tests. */
  clear() {
    this.store.clear();
  }

  get size() {
    return this.store.size;
  }
}

/** Picks the lowest-priced flight from a list, or null for an empty list. */
export function cheapestFlight(flights) {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  return flights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), flights[0]);
}

/** Shared instance used by the API layer. */
export const quoteCache = new QuoteCache();
