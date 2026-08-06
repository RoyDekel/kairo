import dotenv from 'dotenv';
import { EventProvider } from './eventProvider.js';
import { PROVIDER_LIMITS } from '../services/rateLimiter.js';

dotenv.config();

const BASE_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

/**
 * Ticketmaster Discovery API — an ENRICHMENT source.
 *
 * Deliberately not treated as coverage. KAIRO doesn't sell tickets, so "what is on in this
 * city" is a schedule question, and a ticketing feed answers it only partially: European
 * football tickets are sold by the clubs, so those matches never appear here at all.
 *
 * What it uniquely provides is the demand signal — price range, purchase link, and
 * sold-out status. verdictEvidence.js builds its strongest reason from isSoldOut, and
 * insightsEngine.js derives BUY_NOW from isHighImpactEvent. A fixture feed can tell you a
 * derby is being played; only this can tell you it sold out.
 *
 * NOTE: it is currently the only configured provider, so in practice it is also carrying
 * coverage. EventSearchService warns about that, because it means the discovery page is
 * blind to anything not sold through Ticketmaster.
 */
export class TicketmasterProvider extends EventProvider {
  static get key() {
    return 'ticketmaster';
  }

  static get role() {
    return 'enrichment';
  }

  static get rateLimit() {
    return PROVIDER_LIMITS.ticketmaster;
  }

  constructor({ apiKey, limiter } = {}) {
    super({ limiter });
    // Credential comes from the environment only. Never hardcode a fallback here: this
    // module sits next to code imported by the browser toolchain, and a literal would be
    // one bad import away from the public bundle again.
    this.apiKey = apiKey !== undefined ? apiKey : process.env.TICKETMASTER_API_KEY || '';
    this.baseUrl = BASE_URL;
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim() !== '');
  }

  async fetchEvents(location, { startDate, endDate }, airportCode) {
    const startIso = startDate ? new Date(startDate).toISOString().split('.')[0] + 'Z' : '';
    const endIso = endDate ? new Date(endDate).toISOString().split('.')[0] + 'Z' : '';

    /*
      Query the destination city within the requested travel window.

      `city` was previously omitted despite a comment claiming otherwise, so every query
      was country-wide: Barcelona returned events anywhere in Spain, and Munich and Berlin
      returned identical German results.
    */
    const params = new URLSearchParams({
      apikey: this.apiKey,
      countryCode: location.countryCode,
      city: location.city,
      size: '10',
      sort: 'date,asc'
    });

    if (startIso) params.append('startDateTime', startIso);
    if (endIso) params.append('endDateTime', endIso);

    try {
      // Paced to the documented 5 requests/second. The batch endpoint fans out over ~31
      // destinations at once, which previously exceeded this six-fold and was 429'd.
      const res = await this.paced(() => fetch(`${this.baseUrl}?${params.toString()}`));

      if (res.status === 429) {
        console.warn(`[ticketmaster] Rate limited for ${location.city}; result unknown.`);
        return this.unavailable('rate-limited');
      }

      if (!res.ok) {
        console.warn(`[ticketmaster] HTTP ${res.status} for ${location.city}; result unknown.`);
        return this.unavailable(`http-${res.status}`);
      }

      const data = await res.json();
      const rawEvents = data?._embedded?.events || [];

      /*
        No second, undated attempt.

        A previous "Strategy B" refetched without any date filter when the travel window
        came back empty. Those events rendered under "While you're there" despite being
        months outside the trip, and since the discovery page only lists destinations that
        have matching events, it made nearly every destination look eventful.
      */
      if (rawEvents.length === 0) {
        console.log(`[ticketmaster] No events in ${location.city} for ${startDate}–${endDate}.`);
        return this.empty();
      }

      console.log(`[ticketmaster] Retrieved ${rawEvents.length} events for ${location.city} between ${startDate} and ${endDate}.`);
      return this.ok(this.format(rawEvents, airportCode));
    } catch (err) {
      // Transport failure: we genuinely don't know, so don't claim the city is quiet.
      console.warn(`[ticketmaster] Request failed for ${location.city}:`, err.message);
      return this.unavailable('transport-error');
    }
  }

  /** Formats classification hierarchy into normalized category and user-facing categoryLabel */
  parseTicketmasterCategory(evt) {
    const classification = evt.classifications?.[0];
    const segment = classification?.segment?.name?.toLowerCase() || '';
    const genre = classification?.genre?.name?.toLowerCase() || '';
    const subGenre = classification?.subGenre?.name?.toLowerCase() || '';
    const title = (evt.name || '').toLowerCase();

    // Sports & Matches
    if (segment.includes('sport') || genre.includes('sport') || title.includes(' vs') || title.includes('derby')) {
      if (genre.includes('soccer') || genre.includes('football') || title.includes('fc ') || title.includes(' football')) {
        return { category: 'sports', categoryLabel: 'Football ⚽' };
      }
      if (genre.includes('basket') || subGenre.includes('nba')) {
        return { category: 'sports', categoryLabel: 'Basketball 🏀' };
      }
      if (genre.includes('tennis')) {
        return { category: 'sports', categoryLabel: 'Tennis 🎾' };
      }
      if (genre.includes('racing') || genre.includes('motorsport') || genre.includes('formula') || genre.includes('f1')) {
        return { category: 'sports', categoryLabel: 'Motorsport 🏎️' };
      }
      return { category: 'sports', categoryLabel: 'Sports 🏆' };
    }

    // Comedy
    if (genre.includes('comedy') || subGenre.includes('comedy') || title.includes('comedy') || title.includes('stand-up')) {
      return { category: 'culture', categoryLabel: 'Comedy 🎤' };
    }

    // Theatre, Musicals & Performing Arts
    if (segment.includes('art') || segment.includes('theatre') || genre.includes('theatre') || genre.includes('musical') || genre.includes('ballet') || genre.includes('dance')) {
      if (genre.includes('musical') || subGenre.includes('musical')) {
        return { category: 'culture', categoryLabel: 'Musical 🎭' };
      }
      return { category: 'culture', categoryLabel: 'Arts & Theatre 🎭' };
    }

    // Festivals
    if (genre.includes('festival') || subGenre.includes('festival') || title.includes('festival') || title.includes('fest')) {
      return { category: 'festivals', categoryLabel: 'Festival 🎪' };
    }

    // Music Concerts
    if (segment.includes('music') || genre.includes('music') || genre.includes('rock') || genre.includes('pop') || genre.includes('hip-hop') || genre.includes('electronic') || genre.includes('metal') || genre.includes('jazz')) {
      return { category: 'music', categoryLabel: 'Music 🎵' };
    }

    // Film & Cinema
    if (segment.includes('film') || genre.includes('film') || genre.includes('cinema')) {
      return { category: 'culture', categoryLabel: 'Film 🎬' };
    }

    // Default Fallback
    return { category: 'culture', categoryLabel: 'Event 🎟️' };
  }

  /** Maps the Discovery payload onto the normalized shape, deduplicating by title. */
  format(rawEvents, airportCode) {
    const seenTitles = new Set();
    const events = [];

    for (const evt of rawEvents) {
      if (!evt.name) continue;

      const title = evt.name.trim();
      const normalizedTitle = title.toLowerCase();
      if (seenTitles.has(normalizedTitle)) continue;
      seenTitles.add(normalizedTitle);

      const idx = events.length;
      const venue = evt._embedded?.venues?.[0]?.name || 'Major Stadium / Arena';
      const { category, categoryLabel } = this.parseTicketmasterCategory(evt);

      const priceMin = evt.priceRanges?.[0]?.min || 55;
      const priceMax = evt.priceRanges?.[0]?.max || 220;

      // Demand pressure. A sold-out or off-sale event means the city is filling up, which
      // is the signal the buy/wait verdict leans on hardest.
      const statusCode = evt.dates?.status?.code;
      const isSoldOut = statusCode === 'soldout' || statusCode === 'offsale';
      const impactScore = isSoldOut ? 96 : 75 + (idx % 20);

      events.push({
        id: evt.id || `tm-${airportCode}-${idx}`,
        source: TicketmasterProvider.key,
        destination: airportCode,
        title,
        venue,
        category,
        categoryLabel,
        isLiveApi: true,
        date: evt.dates?.start?.localDate || null,
        priceEstimate: `$${Math.round(priceMin)} - $${Math.round(priceMax)}`,
        eventImpactScore: impactScore,
        isSoldOut,
        url: evt.url || null
      });
    }

    return events;
  }
}
