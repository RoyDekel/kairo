import { describe, test, expect, vi, beforeEach } from 'vitest';
import { ApiSportsProvider } from '../../../server/providers/apiSportsProvider.js';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { EventCache } from '../../../server/services/eventCache.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';
import { TtlCache } from '../../../server/services/ttlCache.js';
import { normalizeTeam } from '../../../server/services/eventMerge.js';
import { airportForClub, CLUBS_BY_AIRPORT, resetClubIndex } from '../../../shared/clubCities.js';
import { AIRPORTS } from '../../../shared/catalog.js';

/**
 * API-Sports fixtures provider.
 *
 * Payload shapes below mirror real responses from /fixtures?date=2026-07-30, including the
 * two findings that shaped the implementation:
 *
 *   1. The free plan blocks league+season for the current season but NOT date queries.
 *      Errors arrive in the BODY with HTTP 200, as an object rather than an empty array.
 *   2. venue.city was null in 67 of 145 fixtures, and venue.name was often null too, so
 *      the home club is the only dependable way to place a fixture on the map.
 */

const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });

const makeProvider = (apiKey = 'test-key') =>
  new ApiSportsProvider({
    apiKey,
    limiter: instant(),
    dayCache: new TtlCache({ ttlMs: 60_000 })
  });

const BCN = { city: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.3, lon: 2.08 };
const WINDOW = { startDate: '2026-10-14', endDate: '2026-10-14' };

/** A fixture in the real response shape. */
const fixture = ({ id = 1, home = 'Barcelona', away = 'Sevilla', city = null, venue = null, status = 'NS', league = 'La Liga', date = '2026-10-14T19:00:00+00:00' } = {}) => ({
  fixture: {
    id,
    date,
    status: { short: status, long: status === 'NS' ? 'Not Started' : 'Match Finished' },
    venue: { id: null, name: venue, city }
  },
  league: { id: 140, name: league, country: 'Spain', season: 2026, round: 'Regular Season - 9' },
  teams: { home: { name: home }, away: { name: away } }
});

const okResponse = (fixtures) => ({
  ok: true,
  status: 200,
  json: async () => ({ get: 'fixtures', errors: [], results: fixtures.length, response: fixtures })
});

describe('club to city mapping', () => {
  beforeEach(() => resetClubIndex());

  test('every mapped airport exists in the shared catalog', () => {
    for (const code of Object.keys(CLUBS_BY_AIRPORT)) {
      expect(AIRPORTS[code], code).toBeDefined();
    }
  });

  test('places well-known clubs in the right destination', () => {
    expect(airportForClub('Barcelona', normalizeTeam)).toBe('BCN');
    expect(airportForClub('Real Madrid', normalizeTeam)).toBe('MAD');
    expect(airportForClub('Bayern Munich', normalizeTeam)).toBe('MUC');
    expect(airportForClub('Ajax', normalizeTeam)).toBe('AMS');
  });

  test('absorbs feed naming differences', () => {
    // Feeds disagree on club naming; normalisation strips accents and club noise tokens.
    expect(airportForClub('FC Barcelona', normalizeTeam)).toBe('BCN');
    expect(airportForClub('AC Milan', normalizeTeam)).toBe('MXP');
    expect(airportForClub('Sporting CP', normalizeTeam)).toBe('LIS');
  });

  /*
    Accent stripping is not translation: "München" normalises to "munchen", which does not
    resemble "munich". Local-language names therefore need explicit entries.
  */
  test('handles local-language club names', () => {
    expect(airportForClub('FC Bayern München', normalizeTeam)).toBe('MUC');
    expect(airportForClub('Rapid Wien', normalizeTeam)).toBe('VIE');
    expect(airportForClub('Ferencvárosi TC', normalizeTeam)).toBe('BUD');
  });

  /*
    Unicode decomposition splits "é" into e + a combining mark, but ø, ł and æ are distinct
    codepoints with nothing to strip. Before transliteration they were replaced by
    whitespace and then dropped as single letters, so "FC København" normalised to
    "benhavn" and "Wisła Kraków" to "wis krakow" — breaking two of the catalog's own
    destinations.
  */
  test('handles Latin letters that Unicode cannot decompose', () => {
    expect(airportForClub('FC København', normalizeTeam)).toBe('CPH');
    expect(airportForClub('Wisła Kraków', normalizeTeam)).toBe('KRK');
    expect(airportForClub('Brøndby IF', normalizeTeam)).toBe('CPH');
  });

  test('returns null for an unmapped club rather than guessing', () => {
    expect(airportForClub('Forward Madison', normalizeTeam)).toBeNull();
    expect(airportForClub('', normalizeTeam)).toBeNull();
  });

  /*
    Found by running the matcher over a real 145-fixture response.

    "Atletico FC" is Ecuadorian (Liga Pro Serie B). It normalises to "atletico", and
    two-way containment let the table's "atletico madrid" claim it — displaying an
    Ecuadorian fixture as being in Madrid. Containment now only accepts a feed name that
    CONTAINS a full table entry, never a fragment of one.
  */
  test('a fragment of a club name never places a fixture', () => {
    expect(airportForClub('Atletico FC', normalizeTeam)).toBeNull();
    expect(airportForClub('Sporting', normalizeTeam)).toBeNull();
    expect(airportForClub('Union', normalizeTeam)).toBeNull();
  });

  test('a more specific feed name still resolves', () => {
    // The safe direction: the feed name contains the whole table entry.
    expect(airportForClub('Ferencvarosi TC', normalizeTeam)).toBe('BUD');
    expect(airportForClub('Vasco da Gama U20', normalizeTeam)).toBe('GIG');
    expect(airportForClub('Maccabi Tel Aviv FC', normalizeTeam)).toBe('TLV');
  });

  /*
    "Inter" (Milan) must not swallow "Inter Miami". The containment fallback has a length
    floor for exactly this; a wrong match here would show a fixture under the wrong city.
  */
  test('does not confuse similarly named clubs in different cities', () => {
    expect(airportForClub('Inter Miami', normalizeTeam)).toBe('MIA');
    expect(airportForClub('Inter Milan', normalizeTeam)).toBe('MXP');
    expect(airportForClub('Internazionale', normalizeTeam)).toBe('MXP');
  });
});

describe('ApiSportsProvider', () => {
  test('declares itself the coverage provider', () => {
    expect(ApiSportsProvider.role).toBe('coverage');
    expect(ApiSportsProvider.key).toBe('apisports');
    expect(ApiSportsProvider.isSportsOnly).toBe(true);
  });

  test('is unconfigured without a key', () => {
    expect(new ApiSportsProvider({ apiKey: '' }).isConfigured()).toBe(false);
    expect(new ApiSportsProvider({ apiKey: 'abc' }).isConfigured()).toBe(true);
  });

  test('queries by date and never by season', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([]));

    await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');

    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('date=2026-10-14');
    // The free plan blocks league+season for the current season, so this must never appear.
    expect(url).not.toContain('season=');
    expect(url).not.toContain('league=');
  });

  test('sends the key as a header, not a query parameter', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([]));

    await makeProvider('secret-key').fetchEvents(BCN, WINDOW, 'BCN');

    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).not.toContain('secret-key');
    expect(init.headers['x-apisports-key']).toBe('secret-key');
  });

  test('locates a fixture by venue city when present', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([fixture({ city: 'Barcelona', venue: 'Spotify Camp Nou' })]));

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');

    expect(result.status).toBe('ok');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Barcelona vs Sevilla');
  });

  /* The 46% case: no city, no venue name. Only the home club can place this. */
  test('locates a fixture by home club when venue data is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([fixture({ city: null, venue: null })]));

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');

    expect(result.events).toHaveLength(1);
    expect(result.events[0].homeTeam).toBe('Barcelona');
  });

  test('excludes fixtures belonging to other cities', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okResponse([
        fixture({ id: 1, home: 'Barcelona', away: 'Sevilla' }),
        fixture({ id: 2, home: 'Forward Madison', away: 'Chattanooga Red Wolves', league: 'USL League One' })
      ])
    );

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');

    expect(result.events).toHaveLength(1);
    expect(result.events[0].homeTeam).toBe('Barcelona');
  });

  test('excludes finished and postponed matches', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okResponse([
        fixture({ id: 1, status: 'FT' }),
        fixture({ id: 2, status: 'PST' }),
        fixture({ id: 3, status: 'NS' })
      ])
    );

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');

    // A finished match is not something happening during your visit.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].id).toBe('as-3');
  });

  test('supplies fixture fields and no invented ticketing fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([fixture({ city: 'Barcelona' })]));

    const { events } = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');
    const e = events[0];

    expect(e.league).toBe('La Liga');
    expect(e.homeTeam).toBe('Barcelona');
    expect(e.awayTeam).toBe('Sevilla');
    expect(e.round).toContain('Regular Season');
    expect(e.date).toBe('2026-10-14');

    // Inventing these would feed the buy/wait verdict a number with nothing behind it.
    expect(e.priceEstimate).toBeUndefined();
    expect(e.isSoldOut).toBeUndefined();
    expect(e.eventImpactScore).toBeUndefined();
    expect(e.url).toBeUndefined();
  });

  /*
    THE COST-CRITICAL BEHAVIOUR.

    One /fixtures?date= call returns every fixture worldwide, and the service calls this
    provider once per destination. Without a date-level cache a single 31-destination search
    would issue 186 requests against a 100/day budget.
  */
  test('fetches each date once when destinations are queried in sequence', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([fixture({ city: 'Barcelona' })]));

    const provider = makeProvider();
    const window = { startDate: '2026-10-14', endDate: '2026-10-16' };

    await provider.fetchEvents(BCN, window, 'BCN');
    await provider.fetchEvents({ ...BCN, city: 'Madrid' }, window, 'MAD');
    await provider.fetchEvents({ ...BCN, city: 'Munich' }, window, 'MUC');

    // 3 dates, 3 destinations -> still only 3 requests.
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  /*
    THE CASE THAT MATTERS, AND THE ONE THE TEST ABOVE MISSED.

    /api/events/batch queries every destination CONCURRENTLY. The sequential test passed
    because each call finished before the next began, so the cache was always warm. Under
    real concurrency every destination checked the cache in the same tick, all missed
    (nothing had returned yet) and all issued their own request:

        20 destinations x 5 dates = 100 calls  — the entire free daily allowance,
                                                 from ONE search.

    Paced at 6s apart by the 10/minute limiter, that also meant ten minutes of sustained
    requests after each search. This test pins the in-flight deduplication that fixes it.
  */
  test('concurrent destinations share ONE request per date', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([fixture({ city: 'Barcelona' })]));

    const provider = makeProvider();
    const window = { startDate: '2026-10-14', endDate: '2026-10-18' }; // 5 dates
    const destinations = ['BCN', 'MAD', 'MUC', 'BER', 'VIE', 'PRG', 'BUD', 'LIS', 'DUB', 'MXP'];

    await Promise.all(
      destinations.map((code) => provider.fetchEvents({ ...BCN, city: code }, window, code))
    );

    // 5 dates, regardless of how many destinations ask at once.
    expect(globalThis.fetch).toHaveBeenCalledTimes(5);
  });

  test('a failed in-flight request is not left blocking later attempts', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const provider = makeProvider();
    const window = { startDate: '2026-10-14', endDate: '2026-10-14' };

    await Promise.all([
      provider.fetchEvents(BCN, window, 'BCN'),
      provider.fetchEvents(BCN, window, 'MAD')
    ]);
    // Shared while in flight...
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    // ...but released afterwards, so a later search retries rather than reusing a failure.
    await provider.fetchEvents(BCN, window, 'BCN');
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('enumerates the window inclusively and caps long trips', () => {
    expect(ApiSportsProvider.datesInWindow('2026-10-14', '2026-10-16')).toEqual([
      '2026-10-14',
      '2026-10-15',
      '2026-10-16'
    ]);
    expect(ApiSportsProvider.datesInWindow('2026-10-14', '2027-01-01').length).toBeLessThanOrEqual(10);
    expect(ApiSportsProvider.datesInWindow(null)).toEqual([]);
  });

  /*
    API-Sports reports plan and quota problems in the body with HTTP 200, as an object
    instead of an empty array. Treating that as success would report "no fixtures" for a
    subscription problem — the exact class of silent failure this codebase keeps removing.
  */
  test('treats a plan error in a 200 body as unavailable, not empty', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        errors: { plan: 'Free plans do not have access to this season, try from 2022 to 2024.' },
        results: 0,
        response: []
      })
    });

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');

    expect(result.status).toBe('unavailable');
    expect(result.reason).toBe('api-plan');
  });

  test('surfaces a quota error distinctly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: { requests: 'You have reached your daily limit.' }, response: [] })
    });

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');
    expect(result.reason).toBe('quota-exceeded');
  });

  test('a 429 reports unavailable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');
    expect(result).toMatchObject({ status: 'unavailable', reason: 'rate-limited' });
  });

  test('a failed date is not cached, so it can be retried', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const provider = makeProvider();
    await provider.fetchEvents(BCN, WINDOW, 'BCN');
    await provider.fetchEvents(BCN, WINDOW, 'BCN');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  test('an empty day reports empty, which is an answer', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([]));

    const result = await makeProvider().fetchEvents(BCN, WINDOW, 'BCN');
    expect(result.status).toBe('empty');
  });
});

describe('EventSearchService with the coverage provider', () => {
  test('registering it clears the coverage-gap warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    new EventSearchService({
      providers: [new ApiSportsProvider({ apiKey: 'k', limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('No coverage provider'));
    warn.mockRestore();
  });

  test('a fixture-only match survives alongside ticketing events', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(okResponse([fixture({ city: 'Barcelona' })]));

    const service = new EventSearchService({
      providers: [new ApiSportsProvider({ apiKey: 'k', limiter: instant(), dayCache: new TtlCache({ ttlMs: 1000 }) })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    const result = await service.fetchEvents('BCN', '2026-10-14', '2026-10-14');

    // The coverage gap this integration exists for: club-sold football.
    expect(result.status).toBe('ok');
    expect(result.events[0].source).toBe('apisports');
    expect(result.sources.apisports.count).toBe(1);
  });
});
