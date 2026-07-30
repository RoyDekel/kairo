import dotenv from 'dotenv';
import { AIRPORTS } from '../../shared/catalog.js';
import { eventCache, EventStatus } from './eventCache.js';
import { getLimiter } from './rateLimiter.js';
dotenv.config();

export { EventStatus };

/*
  Location lookup for Ticketmaster queries, resolved from the shared catalog.

  This module used to keep a private 11-airport map and fall back to
  `{ city: airportCode, countryCode: 'FR' }` for anything it didn't recognise. Since the
  catalog has 32 airports, that meant more than twenty destinations — Dublin, Athens,
  Copenhagen, Edinburgh, Dubai, Milan, Lisbon, Zurich, Vienna, Prague, Budapest, Madrid
  and others — were silently querying events in FRANCE. The Render logs showed it:
  destinations printed as a bare airport code ("for DUB") were the unmapped ones.

  Returns null for an unknown code so callers surface nothing rather than the wrong city.
*/
function resolveLocation(airportCode) {
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

export class TicketmasterService {
  constructor({ cache, limiter } = {}) {
    // Credential comes from the environment only. Never hardcode a fallback key here:
    // this module is imported by tests that also run in the browser toolchain, and a
    // literal would be one bad import away from the public bundle again.
    // When unset, lookups degrade to the simulated event engine.
    this.apiKey = process.env.TICKETMASTER_API_KEY || '';
    this.baseUrl = 'https://app.ticketmaster.com/discovery/v2/events.json';

    // Injectable so tests can supply a fresh cache and an instant limiter.
    this.cache = cache || eventCache;
    this.limiter = limiter || getLimiter('ticketmaster');
  }

  /**
   * Looks up events for an airport and date window.
   *
   * Returns a result object rather than a bare array, because "there is nothing on" and
   * "we could not find out" are different answers and were previously indistinguishable:
   * a 429 made res.ok false, which produced an empty array, which was logged as
   * "0 events". Since the undated fallback was removed, throttled destinations silently
   * vanished from the discovery page as though they had nothing on.
   *
   * @returns {Promise<{status: string, events: Array, reason?: string, cached?: boolean}>}
   */
  async fetchEvents(airportCode, startDateStr, endDateStr) {
    const locInfo = resolveLocation(airportCode);

    // Unknown airport: return nothing rather than events from an unrelated country.
    if (!locInfo) {
      console.warn(`[TicketmasterService] No location mapping for ${airportCode}; returning no events.`);
      return { status: EventStatus.EMPTY, events: [], reason: 'unmapped-airport' };
    }

    const cacheKey = { destination: airportCode, startDate: startDateStr, endDate: endDateStr, provider: 'ticketmaster' };
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const result = await this.#lookup(airportCode, locInfo, startDateStr, endDateStr);
    this.cache.set(cacheKey, result);
    return result;
  }

  async #lookup(airportCode, locInfo, startDateStr, endDateStr) {
    if (!this.apiKey || this.apiKey.trim() === '') {
      console.log(`[TicketmasterService] TICKETMASTER_API_KEY not configured; utilizing event simulation engine.`);
      return {
        status: EventStatus.OK,
        events: this.generateSimulatedEvents(airportCode, locInfo),
        reason: 'no-credential'
      };
    }

    const startIso = startDateStr ? new Date(startDateStr).toISOString().split('.')[0] + 'Z' : '';
    const endIso = endDateStr ? new Date(endDateStr).toISOString().split('.')[0] + 'Z' : '';

    /*
      Query the destination city within the requested travel window.

      `city` was previously omitted despite the comment claiming otherwise, so every
      query was country-wide: searching Barcelona returned events anywhere in Spain,
      and Munich and Berlin returned the same German results.
    */
    const params = new URLSearchParams({
      apikey: this.apiKey,
      countryCode: locInfo.countryCode,
      city: locInfo.city,
      size: '10',
      sort: 'date,asc'
    });

    if (startIso) params.append('startDateTime', startIso);
    if (endIso) params.append('endDateTime', endIso);

    try {
      // Paced to the documented 5 requests/second. The batch endpoint fans out over ~31
      // destinations at once, which previously exceeded this by six-fold.
      const res = await this.limiter.schedule(() => fetch(`${this.baseUrl}?${params.toString()}`));

      if (res.status === 429) {
        console.warn(`[TicketmasterService] Rate limited (429) for ${locInfo.city}; result unknown.`);
        return { status: EventStatus.UNAVAILABLE, events: [], reason: 'rate-limited' };
      }

      if (!res.ok) {
        console.warn(`[TicketmasterService] HTTP ${res.status} for ${locInfo.city}; result unknown.`);
        return { status: EventStatus.UNAVAILABLE, events: [], reason: `http-${res.status}` };
      }

      const data = await res.json();
      const rawEvents = data?._embedded?.events || [];

      /*
        No second, undated attempt.

        There used to be a "Strategy B" that refetched without any date filter when the
        travel window came back empty. Those events were rendered under "While you're
        there" despite being months outside the trip, and because the discovery page
        only lists destinations that have matching events, it made nearly every
        destination look eventful. An empty window now genuinely means no events.
      */
      if (rawEvents.length > 0) {
        console.log(`[TicketmasterService] Retrieved ${rawEvents.length} events for ${locInfo.city} between ${startDateStr} and ${endDateStr}.`);
        return { status: EventStatus.OK, events: this.formatTicketmasterEvents(rawEvents, airportCode, true) };
      }

      console.log(`[TicketmasterService] No events in ${locInfo.city} for ${startDateStr}–${endDateStr}.`);
      return { status: EventStatus.EMPTY, events: [] };
    } catch (err) {
      // Transport failure: we genuinely don't know, so don't claim the city is quiet.
      console.warn(`[TicketmasterService] Request failed for ${locInfo.city}:`, err.message);
      return { status: EventStatus.UNAVAILABLE, events: [], reason: 'transport-error' };
    }
  }

  /**
   * Backwards-compatible array form.
   *
   * Callers that only need a list keep working, but note this collapses EMPTY and
   * UNAVAILABLE back into the same empty array — prefer fetchEvents() where the
   * distinction matters.
   */
  async getEventsForDestination(airportCode, startDateStr, endDateStr) {
    const { events } = await this.fetchEvents(airportCode, startDateStr, endDateStr);
    return events;
  }

  /**
   * Format raw Ticketmaster API response into standardized KAIRO event objects
   */
  formatTicketmasterEvents(rawEvents, airportCode, isLive = false) {
    const seenTitles = new Set();
    const uniqueEvents = [];

    for (const evt of rawEvents) {
      if (!evt.name) continue;
      const title = evt.name.trim();
      const normalizedTitle = title.toLowerCase();

      if (seenTitles.has(normalizedTitle)) continue;
      seenTitles.add(normalizedTitle);

      const idx = uniqueEvents.length;
      const venue = evt._embedded?.venues?.[0]?.name || 'Major Stadium / Arena';
      const category = evt.classifications?.[0]?.segment?.name?.toLowerCase() || 'entertainment';
      const categoryLabel = category.includes('music') ? 'Music 🎵' : category.includes('sports') ? 'Sports ⚽' : 'Event 🎟️';
      const priceMin = evt.priceRanges?.[0]?.min || 55;
      const priceMax = evt.priceRanges?.[0]?.max || 220;

      // Calculate Impact Score based on ticket status and venue capacity
      let impactScore = 75 + (idx % 20);
      if (evt.dates?.status?.code === 'offsale' || evt.dates?.status?.code === 'soldout') {
        impactScore = 96;
      }

      uniqueEvents.push({
        id: evt.id || `tm-${airportCode}-${idx}`,
        destination: airportCode,
        title,
        venue,
        category,
        categoryLabel,
        isLiveApi: isLive,
        date: evt.dates?.start?.localDate || 'Upcoming',
        priceEstimate: `$${Math.round(priceMin)} - $${Math.round(priceMax)}`,
        eventImpactScore: impactScore,
        isSoldOut: evt.dates?.status?.code === 'soldout' || impactScore > 90
      });
    }

    return uniqueEvents;
  }

  /**
   * Simulated Event Engine for zero-downtime offline & development environments
   */
  generateSimulatedEvents(airportCode, locInfo) {
    const city = locInfo.city;
    
    const eventDatabase = {
      BCN: [
        { id: 'tm-bcn-1', title: 'FC Barcelona vs Real Madrid (El Clásico)', venue: 'Camp Nou / Estadi Olímpic', category: 'sports', categoryLabel: 'Sports ⚽', priceEstimate: '$120 - $350', eventImpactScore: 96, isSoldOut: true, description: 'La Liga marquee fixture with global fan travel demand.' },
        { id: 'tm-bcn-2', title: 'Primavera Sound Festival', venue: 'Parc del Fòrum', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$85 - $240', eventImpactScore: 92, isSoldOut: false, description: 'Major international music festival drawing 200,000+ attendees.' }
      ],
      CDG: [
        { id: 'tm-cdg-1', title: 'Coldplay Music of the Spheres', venue: 'Stade de France', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$95 - $280', eventImpactScore: 98, isSoldOut: true, description: 'Stadium world tour concert performance with massive travel surge.' },
        { id: 'tm-cdg-2', title: 'PSG Champions League Night', venue: 'Parc des Princes', category: 'sports', categoryLabel: 'Sports ⚽', priceEstimate: '$110 - $320', eventImpactScore: 90, isSoldOut: true, description: 'European knockout match bringing football supporters across Europe.' }
      ],
      LHR: [
        { id: 'tm-lhr-1', title: 'Premier League London Derby', venue: 'Wembley Stadium', category: 'sports', categoryLabel: 'Sports ⚽', priceEstimate: '$100 - $300', eventImpactScore: 94, isSoldOut: true, description: 'High-stakes derby match with intense ticket demand.' },
        { id: 'tm-lhr-2', title: 'Hyde Park British Summer Time Concert', venue: 'Hyde Park London', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$80 - $210', eventImpactScore: 89, isSoldOut: false, description: 'Outdoor summer festival featuring headlining global artists.' }
      ],
      JFK: [
        { id: 'tm-jfk-1', title: 'US Open Tennis Championships', venue: 'Arthur Ashe Stadium', category: 'sports', categoryLabel: 'Sports 🎾', priceEstimate: '$150 - $450', eventImpactScore: 97, isSoldOut: true, description: 'Grand Slam tennis tournament bringing worldwide visitors to NYC.' },
        { id: 'tm-jfk-2', title: 'Taylor Swift Eras Tour Encore', venue: 'MetLife Stadium', category: 'music', categoryLabel: 'Music 🎵', priceEstimate: '$200 - $600', eventImpactScore: 99, isSoldOut: true, description: 'Record-breaking stadium concert series.' }
      ]
    };

    const fallbackEvents = eventDatabase[airportCode?.toUpperCase()] || [
      {
        id: `tm-${airportCode}-gen1`,
        destination: airportCode,
        title: `${city} International Music & Cultural Festival`,
        venue: `${city} Main Exhibition Center`,
        category: 'music',
        categoryLabel: 'Music 🎵',
        priceEstimate: '$75 - $190',
        eventImpactScore: 88,
        isSoldOut: false,
        description: `Premier annual music and culture gathering in ${city}.`
      },
      {
        id: `tm-${airportCode}-gen2`,
        destination: airportCode,
        title: `${city} Championship Sports Showcase`,
        venue: `${city} Arena Stadium`,
        category: 'sports',
        categoryLabel: 'Sports ⚽',
        priceEstimate: '$65 - $160',
        eventImpactScore: 85,
        isSoldOut: false,
        description: `High-impact regional championship sporting event.`
      }
    ];

    return fallbackEvents.map(e => ({ ...e, destination: airportCode }));
  }
}
