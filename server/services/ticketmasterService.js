import dotenv from 'dotenv';
import { AIRPORTS } from '../../shared/catalog.js';
dotenv.config();

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
  constructor() {
    // Credential comes from the environment only. Never hardcode a fallback key here:
    // this module is imported by tests that also run in the browser toolchain, and a
    // literal would be one bad import away from the public bundle again.
    // When unset, getEventsForDestination() degrades to the simulated event engine.
    this.apiKey = process.env.TICKETMASTER_API_KEY || '';
    this.baseUrl = 'https://app.ticketmaster.com/discovery/v2/events.json';
  }

  /**
   * Fetch live events from Ticketmaster for a specific airport & date range
   */
  async getEventsForDestination(airportCode, startDateStr, endDateStr) {
    const locInfo = resolveLocation(airportCode);

    // Unknown airport: return nothing rather than events from an unrelated country.
    if (!locInfo) {
      console.warn(`[TicketmasterService] No location mapping for ${airportCode}; returning no events.`);
      return [];
    }

    if (this.apiKey && this.apiKey.trim() !== '') {
      try {
        console.log(`[TicketmasterService] Calling LIVE Ticketmaster Discovery API for ${locInfo.city} (${locInfo.countryCode})...`);
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

        const res = await fetch(`${this.baseUrl}?${params.toString()}`);
        const data = res.ok ? await res.json() : null;
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
          console.log(`[TicketmasterService] Live API Success: Retrieved ${rawEvents.length} real-time events for ${locInfo.city} between ${startDateStr} and ${endDateStr}.`);
          return this.formatTicketmasterEvents(rawEvents, airportCode, true);
        }

        console.log(`[TicketmasterService] No events in ${locInfo.city} for ${startDateStr}–${endDateStr}.`);
        return [];
      } catch (err) {
        console.warn(`[TicketmasterService] Live API request failed, utilizing high-fidelity fallback engine:`, err.message);
      }
    } else {
      console.log(`[TicketmasterService] TICKETMASTER_API_KEY not configured in .env; utilizing event simulation engine.`);
    }

    // Simulated engine: only for a missing credential or an unreachable API, never as a
    // substitute for a genuinely empty date window.
    return this.generateSimulatedEvents(airportCode, locInfo);
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
