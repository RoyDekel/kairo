import dotenv from 'dotenv';
import { EventProvider } from './eventProvider.js';
import { PROVIDER_LIMITS } from '../services/rateLimiter.js';
import { TtlCache } from '../services/ttlCache.js';
import { normalizeTeam } from '../services/eventMerge.js';
import { airportForClub } from '../../shared/clubCities.js';

dotenv.config();

const BASE_URL = 'https://v3.football.api-sports.io';

/** Bounds the fan-out for a long trip. */
const MAX_DAYS = 10;

/** A day's worldwide fixture list barely changes; six hours is generous. */
const DAY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Statuses worth showing a traveller.
 *
 * A finished, cancelled or postponed match is not something happening during your visit,
 * and listing one under "While you're there" would be wrong. Future windows return NS/TBD
 * anyway; this guards the case where someone searches a past or disrupted date.
 */
const PLANNED_STATUSES = new Set(['TBD', 'NS']);

/**
 * API-Sports football fixtures — the COVERAGE provider.
 *
 * Answers the question the discovery page actually asks: what is happening in this city on
 * these dates. Complements Ticketmaster rather than duplicating it, since European club
 * football is sold by the clubs and never appears in the Discovery API.
 *
 * -------------------------------------------------------------------------------------
 * TWO FINDINGS FROM REAL RESPONSES SHAPED THIS
 *
 * 1. The free plan's season lock does NOT apply to date queries.
 *      ?league=140&season=2026 -> errors: {"plan":"Free plans do not have access to this
 *                                 season, try from 2022 to 2024."}
 *      ?date=2026-07-30        -> errors: [], results: 145, of which 138 were season 2026
 *    So current-season data is reachable, but only via `date`. Querying by league/season
 *    would be blocked — which is also why this provider never does.
 *
 * 2. Caching must be keyed by DATE, not destination.
 *    One /fixtures?date= call returns every fixture on Earth for that day. The service
 *    calls this provider once per destination, so without a date-level cache a single
 *    search would issue 31 x 6 = 186 requests against a 100/day budget. With it, a
 *    six-day window costs six requests shared by every destination and every user.
 * -------------------------------------------------------------------------------------
 */
export class ApiSportsProvider extends EventProvider {
  static get key() {
    return 'apisports';
  }

  static get rateLimit() {
    return PROVIDER_LIMITS.apisports;
  }

  static get role() {
    return 'coverage';
  }

  static get isSportsOnly() {
    return true;
  }

  constructor({ apiKey, limiter, dayCache } = {}) {
    super({ limiter });
    this.apiKey = apiKey !== undefined ? apiKey : process.env.APISPORTS_API_KEY || '';
    this.baseUrl = BASE_URL;

    // Raw daily payloads, shared across all destinations. Injectable for tests.
    this.dayCache = dayCache || new TtlCache({ ttlMs: DAY_CACHE_TTL_MS, maxEntries: 120 });
  }

  isConfigured() {
    return Boolean(this.apiKey && this.apiKey.trim() !== '');
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

  /**
   * Fetches one day's worldwide fixtures, via the cache.
   *
   * @returns {Promise<{fixtures: Array}|{error: string}>}
   */
  async #fixturesForDate(date) {
    const cached = this.dayCache.get(date);
    if (cached) return cached;

    let res;
    try {
      res = await this.paced(() =>
        fetch(`${this.baseUrl}/fixtures?date=${date}`, {
          headers: { 'x-apisports-key': this.apiKey }
        })
      );
    } catch (err) {
      console.warn(`[apisports] Request failed for ${date}:`, err.message);
      return { error: 'transport-error' };
    }

    /*
      Every failure path logs.

      These returns were silent, and on Render that produced a provider which simply
      vanished: a 20-destination search printed twenty [ticketmaster] lines and not one
      [apisports] line, with no way to tell whether it was throttled, out of quota, or
      never called. Ticketmaster logs its failures; this must too. A diagnostic that goes
      quiet exactly when something breaks is worse than no diagnostic.
    */
    if (res.status === 429) {
      console.warn(`[apisports] Rate limited (429) on ${date}; result unknown.`);
      return { error: 'rate-limited' };
    }

    if (!res.ok) {
      console.warn(`[apisports] HTTP ${res.status} on ${date}; result unknown.`);
      return { error: `http-${res.status}` };
    }

    const body = await res.json();

    /*
      API-Sports signals problems in the BODY with HTTP 200. A plan or quota problem arrives
      as `errors: {"plan": "..."}` or `errors: {"requests": "..."}` — an object, whereas a
      successful call returns an empty array. Treating this as success would silently report
      "no fixtures" for a subscription problem.
    */
    const errors = body?.errors;
    const hasErrors = errors && !Array.isArray(errors) && Object.keys(errors).length > 0;
    if (hasErrors) {
      const [field, message] = Object.entries(errors)[0];
      console.warn(`[apisports] API reported ${field}: ${message}`);
      return { error: field === 'requests' ? 'quota-exceeded' : `api-${field}` };
    }

    const payload = { fixtures: body?.response || [] };

    // Only successful lookups are cached; a failure must be retried, not memoised.
    this.dayCache.set(date, payload);
    return payload;
  }

  async fetchEvents(location, { startDate, endDate }, airportCode) {
    const dates = ApiSportsProvider.datesInWindow(startDate, endDate);
    if (dates.length === 0) {
      console.warn(`[apisports] No usable dates in window ${startDate}–${endDate}; skipping ${airportCode}.`);
      return this.empty('no-dates');
    }

    const collected = [];
    let anyAnswered = false;
    let lastError = null;
    const failedDates = [];

    for (const date of dates) {
      const result = await this.#fixturesForDate(date);

      if (result.error) {
        lastError = result.error;
        failedDates.push(date);
        continue;
      }

      anyAnswered = true;
      collected.push(...this.#fixturesInCity(result.fixtures, location, airportCode, date));
    }

    // Not one date resolved: we don't know whether the city is quiet.
    if (!anyAnswered) {
      console.warn(
        `[apisports] Could NOT check ${location.city} for ${startDate}–${endDate} ` +
        `(${lastError || 'transport-error'}); ${failedDates.length}/${dates.length} dates failed.`
      );
      return this.unavailable(lastError || 'transport-error');
    }

    // Partial success is worth saying out loud: the city was checked, but not fully.
    if (failedDates.length > 0) {
      console.warn(
        `[apisports] Partial window for ${location.city}: ${failedDates.length}/${dates.length} ` +
        `dates unavailable (${lastError}). Result may be incomplete.`
      );
    }

    if (collected.length === 0) {
      console.log(`[apisports] No fixtures in ${location.city} for ${startDate}–${endDate}.`);
      return this.empty();
    }

    console.log(`[apisports] Found ${collected.length} fixtures in ${location.city} for ${startDate}–${endDate}.`);
    return this.ok(collected);
  }

  /**
   * Narrows a day's worldwide fixtures to the destination.
   *
   * Three signals, most reliable first. venue.city is preferred when present but is null
   * in roughly half of all fixtures, so the home club is the workhorse.
   */
  #fixturesInCity(fixtures, location, airportCode, date) {
    const cityKey = normalizeTeam(location.city);
    const events = [];

    for (const item of fixtures) {
      const fixture = item?.fixture;
      const league = item?.league;
      const home = item?.teams?.home?.name;
      const away = item?.teams?.away?.name;
      if (!fixture || !home) continue;

      const status = fixture.status?.short;
      if (status && !PLANNED_STATUSES.has(status)) continue;

      const venueCity = normalizeTeam(fixture.venue?.city);
      const venueName = normalizeTeam(fixture.venue?.name);

      const placed =
        (venueCity && venueCity === cityKey) ||
        airportForClub(home, normalizeTeam) === airportCode ||
        (venueName && cityKey && venueName.includes(cityKey));

      if (!placed) continue;

      events.push({
        id: `as-${fixture.id}`,
        source: ApiSportsProvider.key,
        destination: airportCode,
        title: `${home} vs ${away || 'TBD'}`,
        venue: fixture.venue?.name || `${location.city} stadium`,
        category: 'sports',
        categoryLabel: 'Sports ⚽',
        isLiveApi: true,
        date: (fixture.date || `${date}T00:00:00Z`).slice(0, 10),

        // Fixture-only fields. Deliberately no priceEstimate, url, isSoldOut or
        // eventImpactScore: this source cannot know them, and inventing them would feed
        // the buy/wait verdict a number with nothing behind it.
        league: league?.name || null,
        homeTeam: home,
        awayTeam: away || null,
        round: league?.round || null
      });
    }

    return events;
  }
}
