/**
 * Maps football clubs to the KAIRO destination they play in.
 *
 * WHY THIS EXISTS: API-Sports fixtures do not reliably say where a match is. In a real
 * sample of 145 fixtures from /fixtures?date=2026-07-30:
 *
 *   venue.city populated .... 78/145  (54%)
 *   venue.city null ......... 67/145  (46%)
 *
 * and when city was null, venue.name was frequently null too — the payload looked like
 * `{"city": null, "id": null, "name": null}`. The one field always present is
 * `teams.home`, so the home club is the reliable way to place a fixture on the map.
 *
 * Only the 32 airports in the shared catalog are covered, and only clubs likely to appear
 * in fixture feeds. This is static data that changes on the timescale of promotions and
 * stadium moves, so it needs revisiting rarely.
 *
 * MATCHING IS TOLERANT ON PURPOSE. API-Sports' exact club strings aren't documented, and
 * feeds disagree ("Bayern Munich" / "FC Bayern München" / "Bayern München"). Lookup
 * normalises both sides and allows containment either way, so a near-miss still resolves.
 * The cost of a wrong match here is a fixture shown under the wrong city, so entries are
 * kept distinctive — no bare "United" or "City".
 */

/** airportCode -> clubs whose home ground is in or immediately around that city. */
export const CLUBS_BY_AIRPORT = {
  TLV: ['Maccabi Tel Aviv', 'Hapoel Tel Aviv', 'Bnei Yehuda'],
  KRK: ['Wisla Krakow', 'Cracovia'],
  LHR: ['Arsenal', 'Chelsea', 'Tottenham', 'West Ham', 'Crystal Palace', 'Fulham', 'Brentford', 'Queens Park Rangers', 'Millwall', 'Charlton'],
  CDG: ['Paris Saint Germain', 'Paris FC'],
  JFK: ['New York City', 'New York Red Bulls'],
  DXB: ['Al Wasl', 'Al Nasr', 'Shabab Al Ahli'],
  FCO: ['Roma', 'Lazio'],
  NRT: ['FC Tokyo', 'Tokyo Verdy', 'Machida Zelvia'],
  HND: ['FC Tokyo', 'Tokyo Verdy', 'Machida Zelvia'],
  ATH: ['AEK Athens', 'Panathinaikos', 'Olympiakos Piraeus'],
  LAX: ['Los Angeles FC', 'LA Galaxy'],
  SIN: ['Lion City Sailors', 'Albirex Niigata FC'],
  AMS: ['Ajax'],
  SYD: ['Sydney FC', 'Western Sydney Wanderers', 'Macarthur'],
  BCN: ['Barcelona', 'Espanyol'],
  HKG: ['Kitchee', 'Eastern'],
  MAD: ['Real Madrid', 'Atletico Madrid', 'Rayo Vallecano', 'Getafe', 'Leganes'],
  BER: ['Union Berlin', 'Hertha Berlin'],
  // Local-language variants matter: accent stripping turns "München" into "munchen",
  // which does not resemble "munich". Same story for Wien/Vienna and København/Copenhagen.
  MUC: ['Bayern Munich', 'Bayern Munchen', '1860 Munich', '1860 Munchen'],
  VIE: ['Rapid Vienna', 'Rapid Wien', 'Austria Vienna', 'Austria Wien'],
  PRG: ['Slavia Praha', 'Sparta Praha', 'Bohemians 1905'],
  BUD: ['Ferencvarosi', 'Ferencvaros', 'MTK Budapest', 'Honved'],
  LIS: ['Benfica', 'Sporting CP', 'Belenenses'],
  DUB: ['Shamrock Rovers', 'Bohemian', 'St Patricks Athletic', 'Shelbourne'],
  MXP: ['AC Milan', 'Internazionale', 'Inter Milan'],
  ZRH: ['Zurich', 'Grasshopper', 'Grasshoppers'],
  MIA: ['Inter Miami'],
  ICN: ['FC Seoul', 'Seoul E-Land'],
  BKK: ['Bangkok United', 'Muangthong United', 'Port FC'],
  CPH: ['FC Copenhagen', 'Kobenhavn', 'Brondby'],
  EDI: ['Hearts', 'Heart of Midlothian', 'Hibernian'],
  GIG: ['Flamengo', 'Fluminense', 'Botafogo', 'Vasco DA Gama']
  // Deliberately absent: airports whose cities have no club likely to surface in these
  // feeds. An absent entry means "cannot place a fixture here", which is correct.
};

/**
 * Builds a reverse lookup once, at module load.
 * normalised club name -> airport code
 */
function buildIndex(normalize) {
  const index = new Map();
  for (const [airport, clubs] of Object.entries(CLUBS_BY_AIRPORT)) {
    for (const club of clubs) {
      const key = normalize(club);
      if (key) index.set(key, airport);
    }
  }
  return index;
}

let cachedIndex = null;
let cachedNormalize = null;

/**
 * Resolves a club name to an airport code, or null.
 *
 * @param {string} clubName        e.g. "FC Bayern München"
 * @param {Function} normalize     normaliser from eventMerge (strips accents, club noise)
 * @returns {string|null}          airport code, or null when unknown
 */
export function airportForClub(clubName, normalize) {
  if (!clubName || typeof normalize !== 'function') return null;

  if (!cachedIndex || cachedNormalize !== normalize) {
    cachedIndex = buildIndex(normalize);
    cachedNormalize = normalize;
  }

  const needle = normalize(clubName);
  if (!needle) return null;

  // Exact normalised match first — cheapest and safest.
  if (cachedIndex.has(needle)) return cachedIndex.get(needle);

  /*
    Then containment — but in ONE direction only: the feed name must contain a full table
    entry, never the reverse.

    Testing against a real 145-fixture response showed why. Two-way containment matched the
    Ecuadorian club "Atletico FC" — which normalises to just "atletico" — against the table's
    "atletico madrid", and displayed a Liga Pro Serie B fixture as being in Madrid. A
    fragment of a club name is not evidence of a city; "Atletico", "Sporting", "Union" and
    "Racing" belong to dozens of clubs worldwide.

    The safe direction is a feed name that is MORE specific than the table entry:
    "Ferencvarosi TC" contains "ferencvarosi", "Vasco da Gama U20" contains "vasco da gama".
    The cost is a miss when a feed abbreviates below the table entry, which is the right
    trade: no badge beats a fixture pinned to the wrong continent.
  */
  let best = null;
  let bestLength = 0;

  for (const [club, airport] of cachedIndex) {
    if (club.length < 5) continue;

    if (needle.includes(club) && club.length > bestLength) {
      best = airport;
      bestLength = club.length;
    }
  }

  return best;
}

/** Test seam: forget the memoised index. */
export function resetClubIndex() {
  cachedIndex = null;
  cachedNormalize = null;
}
