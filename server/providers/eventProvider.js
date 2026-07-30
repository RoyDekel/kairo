import { EventStatus } from '../services/eventCache.js';
import { RateLimiter } from '../services/rateLimiter.js';

export { EventStatus };

/**
 * Base class for event data sources, mirroring FlightProvider.
 *
 * One important difference from flights: FlightSearchService picks a single provider and
 * falls back on failure, because every provider answers the same question ("what does
 * this route cost?"). Event providers answer *different* questions and are combined
 * rather than chosen — see EventSearchService.
 *
 * ---------------------------------------------------------------------------
 * NORMALIZED EVENT SHAPE
 *
 * Every provider must return objects in this shape. Fields marked (ticketing) can only
 * come from a source that sells tickets; fields marked (fixture) only from a sports
 * schedule database. Consumers must treat both as optional.
 *
 *   id              string   Stable per provider.
 *   source          string   Provider key that produced it.
 *   destination     string   Airport code this was looked up for.
 *   title           string   Human-readable name.
 *   venue           string   Venue name, or a city-level placeholder.
 *   date            string   'YYYY-MM-DD' local calendar date.
 *   category        string   Raw provider category; normalised downstream.
 *   categoryLabel   string   Display label.
 *   isLiveApi       boolean  False for simulated content.
 *
 *   priceEstimate   string?  (ticketing) e.g. '$85 - $240'.
 *   isSoldOut       boolean? (ticketing) Sold-out signals peak travel demand.
 *   url             string?  (ticketing) Purchase link.
 *   eventImpactScore number? (ticketing) Demand pressure, drives the buy/wait verdict.
 *
 *   league          string?  (fixture) e.g. 'La Liga'.
 *   homeTeam        string?  (fixture)
 *   awayTeam        string?  (fixture)
 *
 * WHY THIS MATTERS: verdictEvidence.js builds its strongest reason — "sold-out event on
 * your dates" — from isSoldOut and eventImpactScore. A fixture-only source cannot supply
 * either, so merging naively would weaken the verdict on exactly the big matches that
 * should strengthen it. Stage 3 must prefer the ticketing record when both describe the
 * same event.
 * ---------------------------------------------------------------------------
 */
export class EventProvider {
  /**
   * @param {object} options
   * @param {object} [options.limiter] Injectable for tests; defaults to this provider's rate limit.
   */
  constructor({ limiter } = {}) {
    this.limiter = limiter || new RateLimiter({ ...this.constructor.rateLimit, name: this.constructor.key });
  }

  /** Short identifier used in cache keys, logs and the `source` field. */
  static get key() {
    throw new Error('EventProvider subclasses must define a static key');
  }

  /** Published rate limit: { limit, windowMs }. */
  static get rateLimit() {
    throw new Error('EventProvider subclasses must define a static rateLimit');
  }

  /** Does this provider only cover sports? Used to skip it when sport isn't of interest. */
  static get isSportsOnly() {
    return false;
  }

  /** Can this provider actually be called (credential present, etc.)? */
  isConfigured() {
    return true;
  }

  /**
   * Look up events at a resolved location within a date window.
   *
   * @param {object} location  { city, country, countryCode, lat, lon }
   * @param {object} window    { startDate, endDate }
   * @param {string} airportCode
   * @returns {Promise<{status: string, events: Array, reason?: string}>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetchEvents(location, window, airportCode) {
    throw new Error("Method 'fetchEvents()' must be implemented by subclasses.");
  }

  /** Convenience wrapper so subclasses don't each re-implement pacing. */
  async paced(fn) {
    return this.limiter.schedule(fn);
  }

  /** Standard shape for "we could not find out". */
  unavailable(reason) {
    return { status: EventStatus.UNAVAILABLE, events: [], reason };
  }

  /** Standard shape for "the provider answered and there is nothing on". */
  empty(reason) {
    return { status: EventStatus.EMPTY, events: [], reason };
  }

  /** Standard shape for a successful lookup. */
  ok(events, reason) {
    return { status: EventStatus.OK, events, reason };
  }
}
