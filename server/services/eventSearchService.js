import { AIRPORTS } from '../../shared/catalog.js';
import { eventCache, EventStatus } from './eventCache.js';
import { TicketmasterProvider } from '../providers/ticketmasterProvider.js';
import { SimulatedEventProvider } from '../providers/simulatedEventProvider.js';

export { EventStatus };

/**
 * Orchestrates event lookups across providers.
 *
 * Deliberately different from FlightSearchService, which selects ONE provider and falls
 * back on failure. Every flight provider answers the same question, so picking one is
 * right. Event providers answer different questions — Ticketmaster knows what is on sale,
 * a fixture database knows what is being played — so they are combined.
 *
 * Stage 2 wires the structure with Ticketmaster alone, preserving current behaviour
 * exactly. Stage 3 adds sports providers and the cross-referencing merge.
 */
export class EventSearchService {
  constructor({ providers, cache, mergeEvents } = {}) {
    this.cache = cache || eventCache;

    // Providers that can actually be called, in priority order. Ticketmaster leads
    // because it is the only source of price, purchase links and sold-out status.
    const candidates = providers || [new TicketmasterProvider()];
    this.providers = candidates.filter((p) => p.isConfigured());

    /*
      With no live provider configured (local dev without credentials) fall back to
      hand-written data. This is NOT used when a provider is merely unreachable — that
      reports `unavailable`, because fabricating listings that look real is worse than
      admitting we don't know.
    */
    this.usingSimulation = this.providers.length === 0;
    if (this.usingSimulation) {
      console.log('[EventSearchService] No live event provider configured; using simulated events.');
      this.providers = [new SimulatedEventProvider()];
    }

    // Injected in stage 3. Until then, results are concatenated as-is.
    this.mergeEvents = mergeEvents || ((eventsByProvider) => eventsByProvider.flat());

    console.log(`[EventSearchService] Active event providers: [${this.providers.map((p) => p.constructor.key).join(', ')}]`);
  }

  /** Resolves an airport code to a queryable location using the shared catalog. */
  static resolveLocation(airportCode) {
    const airport = AIRPORTS[airportCode?.toUpperCase()];
    if (!airport?.countryCode) return null;

    return {
      city: airport.city,
      country: airport.country,
      countryCode: airport.countryCode,
      lat: airport.coords[0],
      lon: airport.coords[1]
    };
  }

  /**
   * Looks up events for an airport and date window across all active providers.
   *
   * @returns {Promise<{status: string, events: Array, reason?: string, cached?: boolean, sources?: object}>}
   */
  async fetchEvents(airportCode, startDate, endDate) {
    const location = EventSearchService.resolveLocation(airportCode);

    // Unknown airport: return nothing rather than events from an unrelated country. The
    // old private location map defaulted unmapped codes to France, so more than twenty
    // destinations were querying French events.
    if (!location) {
      console.warn(`[EventSearchService] No location mapping for ${airportCode}; returning no events.`);
      return { status: EventStatus.EMPTY, events: [], reason: 'unmapped-airport' };
    }

    const cacheKey = { destination: airportCode, startDate, endDate, provider: 'merged' };
    const cached = this.cache.get(cacheKey);
    if (cached) return { ...cached, cached: true };

    const result = await this.#queryProviders(location, { startDate, endDate }, airportCode);
    this.cache.set(cacheKey, result);
    return result;
  }

  async #queryProviders(location, window, airportCode) {
    const settled = await Promise.allSettled(
      this.providers.map((provider) => provider.fetchEvents(location, window, airportCode))
    );

    const eventsByProvider = [];
    const sources = {};

    settled.forEach((outcome, idx) => {
      const key = this.providers[idx].constructor.key;

      if (outcome.status === 'rejected') {
        console.warn(`[EventSearchService] ${key} threw:`, outcome.reason?.message || outcome.reason);
        sources[key] = { status: EventStatus.UNAVAILABLE, reason: 'threw', count: 0 };
        return;
      }

      const { status, events = [], reason } = outcome.value;
      sources[key] = { status, reason, count: events.length };
      if (events.length > 0) eventsByProvider.push(events);
    });

    const events = this.mergeEvents(eventsByProvider, { location, window });

    if (events.length > 0) {
      return { status: EventStatus.OK, events, sources };
    }

    /*
      Nothing came back. Distinguish the two reasons, because they are very different
      answers: every provider said the window is quiet, versus we couldn't reach any of
      them. Collapsing both into an empty list is what made throttled destinations
      silently disappear from the discovery page.
    */
    const entries = Object.values(sources);
    const allAnswered = entries.length > 0 && entries.every((s) => s.status === EventStatus.EMPTY);

    if (allAnswered) {
      return { status: EventStatus.EMPTY, events: [], sources };
    }

    /*
      Keep the provider's specific reason when it is unambiguous.

      Collapsing everything to a generic 'no-provider-answered' would throw away exactly
      the detail that matters for diagnosis — 'rate-limited' versus 'http-500' versus
      'transport-error' are different operational problems, and the whole point of this
      status is to stop hiding them.
    */
    const failureReasons = [
      ...new Set(entries.filter((s) => s.status === EventStatus.UNAVAILABLE && s.reason).map((s) => s.reason))
    ];

    return {
      status: EventStatus.UNAVAILABLE,
      events: [],
      reason: failureReasons.length === 1 ? failureReasons[0] : 'no-provider-answered',
      sources
    };
  }

  /** Array form for callers that don't need the status distinction. */
  async getEventsForDestination(airportCode, startDate, endDate) {
    const { events } = await this.fetchEvents(airportCode, startDate, endDate);
    return events;
  }

  get providerKeys() {
    return this.providers.map((p) => p.constructor.key);
  }
}
