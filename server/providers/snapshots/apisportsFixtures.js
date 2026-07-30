/**
 * A committed snapshot of /fixtures?date=, served to local development instead of the
 * live API.
 *
 * -------------------------------------------------------------------------------------
 * WHY
 *
 * The unit tests were already isolated — an unmocked fetch rejects loudly — but running
 * `npm run dev` with a real key in .env hit the live API on every manual search, with no
 * guard at all. On a 100-request daily allowance that is the path most likely to burn the
 * quota, because it is the one exercised by hand, repeatedly, while iterating.
 *
 * Live calls now require APISPORTS_LIVE=1, so reaching the real API in development is a
 * deliberate act rather than the default.
 * -------------------------------------------------------------------------------------
 *
 * The shape mirrors real responses exactly, including the two traits that matter:
 *   - venue.city is null for many fixtures, so the home club is the only way to place them
 *   - status.short distinguishes scheduled (NS) from postponed (PST) and finished (FT)
 *
 * To refresh from real data:
 *   curl -H "x-apisports-key: $APISPORTS_API_KEY" \
 *        "https://v3.football.api-sports.io/fixtures?date=2026-08-15" > snapshot.json
 * then paste the `response` array below.
 */

const fixture = ({ id, home, away, city = null, venue = null, league, country, status = 'NS', time = '19:00:00' }) => ({
  fixture: {
    id,
    date: `__DATE__T${time}+00:00`,
    status: { short: status, long: status === 'NS' ? 'Not Started' : status },
    venue: { id, name: venue, city }
  },
  league: { id: 0, name: league, country, season: 2026, round: 'Regular Season - 4' },
  teams: { home: { name: home }, away: { name: away } }
});

/** Deliberately spans several catalog cities, plus noise that must NOT be placed. */
const SNAPSHOT = [
  fixture({ id: 9001, home: 'Barcelona', away: 'Sevilla', city: 'Barcelona', venue: 'Spotify Camp Nou', league: 'La Liga', country: 'Spain' }),
  fixture({ id: 9002, home: 'Real Madrid', away: 'Valencia', city: null, venue: 'Estadio Santiago Bernabeu', league: 'La Liga', country: 'Spain' }),
  fixture({ id: 9003, home: 'Bayern Munich', away: 'Werder Bremen', city: null, venue: null, league: 'Bundesliga', country: 'Germany' }),
  fixture({ id: 9004, home: 'Ajax', away: 'Feyenoord', city: 'Amsterdam', venue: 'Johan Cruijff ArenA', league: 'Eredivisie', country: 'Netherlands' }),
  fixture({ id: 9005, home: 'Sporting CP', away: 'Benfica', city: null, venue: 'Estadio Jose Alvalade', league: 'Primeira Liga', country: 'Portugal' }),
  fixture({ id: 9006, home: 'FC Copenhagen', away: 'Midtjylland', city: null, venue: 'Parken', league: 'Superliga', country: 'Denmark' }),
  fixture({ id: 9007, home: 'Wisla Krakow', away: 'Legia Warszawa', city: null, venue: null, league: 'Ekstraklasa', country: 'Poland' }),
  fixture({ id: 9008, home: 'Inter Milan', away: 'Napoli', city: 'Milano', venue: 'San Siro', league: 'Serie A', country: 'Italy' }),

  // A postponed match: must be filtered out rather than shown as happening.
  fixture({ id: 9009, home: 'Rapid Wien', away: 'Sturm Graz', city: 'Vienna', venue: 'Allianz Stadion', league: 'Bundesliga', country: 'Austria', status: 'PST' }),

  // Noise from cities Kairo does not serve: must never be placed on the map.
  fixture({ id: 9010, home: 'Atletico FC', away: 'Mushuc Runa', city: null, venue: null, league: 'Liga Pro Serie B', country: 'Ecuador' }),
  fixture({ id: 9011, home: 'Forward Madison', away: 'Union Omaha', city: 'Madison', venue: 'Breese Stevens Field', league: 'USL League One', country: 'USA' })
];

/** The snapshot re-dated to the requested day, in the exact response envelope. */
export const snapshotForDate = (date) => ({
  get: 'fixtures',
  parameters: { date },
  errors: [],
  results: SNAPSHOT.length,
  response: JSON.parse(JSON.stringify(SNAPSHOT).replaceAll('__DATE__', date))
});

/**
 * True when this process should use the snapshot.
 *
 * Production always goes live, and reaching the real API from the dev server takes an
 * explicit opt-in.
 *
 * Tests are excluded deliberately. They have their own, stricter isolation — setupTests.js
 * makes an unmocked fetch reject by name — and they need to stub fetch to exercise 429s,
 * quota errors and transport failures. Feeding them a snapshot instead would quietly
 * neutralise those cases: the tests would still pass, but against fabricated data rather
 * than the responses they were written to pin.
 */
export const shouldUseSnapshot = (env = process.env) => {
  if (env.APISPORTS_LIVE === '1') return false;
  if (env.NODE_ENV === 'production' || env.NODE_ENV === 'test') return false;
  return true;
};
