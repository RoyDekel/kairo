import dotenv from 'dotenv';
import { EventProvider } from './eventProvider.js';
import { PROVIDER_LIMITS } from '../services/rateLimiter.js';
import { normalizeTeam } from '../services/eventMerge.js';

dotenv.config();

/**
 * TheSportsDB — a fixture source.
 *
 * Complements Ticketmaster rather than duplicating it: European football tickets are
 * generally sold by the clubs, so those matches never appear in the Discovery API at all.
 * A fixture database knows the match is happening regardless, which is exactly the signal
 * KAIRO needs — a sold-out derby drives flight demand whether or not Ticketmaster sells
 * the seats.
 *
 * It cannot supply price, purchase links or sold-out status. See eventProvider.js for why
 * that matters to the buy/wait verdict.
 *
 * -------------------------------------------------------------------------------------
 * DISABLED WITHOUT A KEY, AND THE FREE KEY IS NOT ENOUGH.
 *
 * The published free tier limits are on RESULTS, not requests:
 *   eventsday.php      free 3 results   / premium 1500
 *   searchteams.php    free 1 result    — and hardcoded to the string "Arsenal"
 *   eventsseason.php   free 15 results  / premium 3000
 *
 * Three events per day worldwide cannot locate a match in a given city, so the free key
 * ('123') is treated as unconfigured. Set THESPORTSDB_API_KEY to a premium key to enable.
 * -------------------------------------------------------------------------------------
 */

const BASE_URL = 'https://www.thesportsdb.com/api/v1/json';

/** The documented free key. Present in every tutorial; useless for this workload. */
const FREE_TIER_KEY = '123';

/** Bounds the per-date fan-out for a long trip. */
const MAX_DAYS = 10;

export class TheSportsDbProvider extends EventProvider {
  static get key() {
    return 'thesportsdb';
  }

  static get rateLimit() {
    return PROVIDER_LIMITS.thesportsdb;
  }

  static get isSportsOnly() {
    return true;
  }

  constructor({ apiKey, limiter, sport = 'Soccer' } = {}) {
    super({ limiter });
    this.apiKey = apiKey !== undefined ? apiKey : process.env.THESPORTSDB_API_KEY || '';
    this.sport = sport;
  }

  /**
   * The free key is deliberately rejected. Enabling it would return three events for the
   * whole planet per day and quietly produce almost no matches, which looks like "no
   * sport on" rather than "this tier can't answer".
   */
  isConfigured() {
    const key = (this.apiKey || '').trim();
    if (!key) return false;

    if (key === FREE_TIER_KEY) {
      console.warn(
        '[thesportsdb] Free key detected. eventsday.php returns only 3 results per day on the free tier, ' +
        'which cannot locate events in a specific city. Provider disabled — set a premium THESPORTSDB_API_KEY.'
      );
      return false;
    }

    return true;
  }

  /** Inclusive list of ISO dates in the window, capped. */
  static datesInWindow(startDate, endDate) {
    if (!startDate) return [];

    const start = new Date(`${startDate}T00:00:00Z`);
    const end = endDate ? new Date(`${endDate}T00:00:00Z`) : start;
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];

    const dates = [];
    for (let d = new Date(start); d <= end && dates.length < MAX_DAYS; d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  async fetchEvents(location, { startDate, endDate }, airportCode) {
    const dates = TheSportsDbProvider.datesInWindow(startDate, endDate);
    if (dates.length === 0) return this.empty('no-dates');

    const collected = [];
    let anyAnswered = false;
    let lastFailure = null;

    for (const date of dates) {
      const url = `${BASE_URL}/${this.apiKey}/eventsday.php?d=${date}&s=${encodeURIComponent(this.sport)}`;

      try {
        const res = await this.paced(() => fetch(url));

        if (res.status === 429) {
          lastFailure = 'rate-limited';
          continue;
        }
        if (!res.ok) {
          lastFailure = `http-${res.status}`;
          continue;
        }

        anyAnswered = true;
        const data = await res.json();
        // The API returns { events: null } rather than an empty array for a quiet day.
        const raw = data?.events || [];
        collected.push(...this.#matchesInCity(raw, location, airportCode, date));
      } catch (err) {
        lastFailure = 'transport-error';
        console.warn(`[thesportsdb] Request failed for ${date}:`, err.message);
      }
    }

    // Nothing answered at all: we don't know whether the city is quiet.
    if (!anyAnswered) return this.unavailable(lastFailure || 'transport-error');

    if (collected.length === 0) {
      console.log(`[thesportsdb] No ${this.sport} fixtures in ${location.city} for ${startDate}–${endDate}.`);
      return this.empty();
    }

    console.log(`[thesportsdb] Found ${collected.length} fixtures in ${location.city} for ${startDate}–${endDate}.`);
    return this.ok(collected);
  }

  /**
   * eventsday.php returns fixtures worldwide, so they must be narrowed to the destination.
   * Matching on the home team's city is unreliable across feeds, so the venue and country
   * fields are used, falling back to a city mention in the venue string.
   */
  #matchesInCity(rawEvents, location, airportCode, date) {
    const city = normalizeTeam(location.city);

    return rawEvents
      .filter((evt) => {
        const venue = normalizeTeam(evt.strVenue);
        const country = normalizeTeam(evt.strCountry);
        if (!venue && !country) return false;

        return (
          (venue && venue.includes(city)) ||
          (country && country === normalizeTeam(location.country) && venue.includes(city))
        );
      })
      .map((evt) => ({
        id: `tsdb-${evt.idEvent}`,
        source: TheSportsDbProvider.key,
        destination: airportCode,
        title: evt.strEvent || `${evt.strHomeTeam} vs ${evt.strAwayTeam}`,
        venue: evt.strVenue || `${location.city} Stadium`,
        category: 'sports',
        categoryLabel: 'Sports ⚽',
        isLiveApi: true,
        date: evt.dateEvent || date,

        // Fixture-only fields. Deliberately no priceEstimate, url, isSoldOut or
        // eventImpactScore — this source cannot know them, and inventing them would
        // feed the buy/wait verdict a number with nothing behind it.
        league: evt.strLeague || null,
        homeTeam: evt.strHomeTeam || null,
        awayTeam: evt.strAwayTeam || null
      }));
  }
}
