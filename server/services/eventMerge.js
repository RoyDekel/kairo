/**
 * Cross-references events from multiple providers.
 *
 * The problem: Ticketmaster may list "FC Barcelona vs Real Madrid (El Clásico)" while a
 * fixture database lists the same match as home "Barcelona", away "Real Madrid". Those
 * strings share almost nothing, so title similarity alone cannot connect them. Conversely
 * two genuinely different matches in the same city on the same day must NOT be collapsed.
 *
 * Policy: conservative. A wrong merge deletes a real event AND attaches another event's
 * price and venue to it. A duplicate is merely untidy. So merging requires high
 * confidence; anything less keeps both records.
 *
 * Precedence: the ticketing record wins the shared fields, because only it can supply
 * price, purchase URL and sold-out status — the inputs verdictEvidence.js leans on
 * hardest. The fixture record contributes what ticketing lacks: league and team names.
 */

/** Nicknames that carry no team names at all, mapped to the pair they describe. */
export const FIXTURE_ALIASES = {
  'el clasico': ['barcelona', 'real madrid'],
  'el clásico': ['barcelona', 'real madrid'],
  'der klassiker': ['bayern munich', 'borussia dortmund'],
  'north london derby': ['arsenal', 'tottenham'],
  'manchester derby': ['manchester city', 'manchester united'],
  'merseyside derby': ['liverpool', 'everton'],
  'derby della madonnina': ['inter', 'milan'],
  'milan derby': ['inter', 'milan'],
  'derby d italia': ['juventus', 'inter'],
  'old firm': ['celtic', 'rangers'],
  'de klassieker': ['ajax', 'feyenoord'],
  'o classico': ['benfica', 'porto'],
  'superclasico': ['boca juniors', 'river plate'],
  'süperklasik': ['galatasaray', 'fenerbahce'],
  'le classique': ['paris saint germain', 'marseille']
};

/** Corporate/legal tokens that differ between sources for the same club. */
const CLUB_NOISE = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'sv', 'bv', 'vfb', 'vfl', 'ss', 'as', 'us', 'rc', 'cd',
  'club', 'futbol', 'football', 'calcio', 'the'
]);

/** Separators a "team vs team" title might use. */
const VS_SPLIT = /\s+(?:vs\.?|v\.?|versus|@|at|-|–|—)\s+/i;

/** Lowercase, strip accents, collapse punctuation and whitespace. */
export function normalizeText(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes a club name and drops tokens that vary between feeds.
 *
 * Single letters are dropped too: punctuation becomes whitespace during normalisation, so
 * "A.C. Milan" arrives as "a c milan" and the noise list alone would not catch it. No club
 * is identified by a lone letter, so this is safe while "St Pauli" keeps both words.
 */
export function normalizeTeam(value) {
  const words = normalizeText(value)
    .split(' ')
    .filter((w) => w.length > 1 && !CLUB_NOISE.has(w));
  return words.join(' ');
}

/**
 * Best-effort set of teams an event involves.
 *
 * Explicit homeTeam/awayTeam (fixture sources) are trusted first. Otherwise the title is
 * split on "vs"/"at"/"-". Failing that, the alias table catches nicknames like
 * "El Clásico" that contain no team names at all.
 */
export function extractTeams(event) {
  if (event?.homeTeam && event?.awayTeam) {
    return [normalizeTeam(event.homeTeam), normalizeTeam(event.awayTeam)].filter(Boolean).sort();
  }

  const rawTitle = event?.title || '';

  // Strip a trailing parenthetical so "Barcelona vs Real Madrid (El Clásico)" splits cleanly.
  const withoutParens = rawTitle.replace(/\([^)]*\)/g, ' ');

  if (VS_SPLIT.test(withoutParens)) {
    const parts = withoutParens
      .split(VS_SPLIT)
      .map(normalizeTeam)
      .filter(Boolean);
    if (parts.length >= 2) return parts.slice(0, 2).sort();
  }

  // Nickname-only titles, e.g. "El Clásico" with no teams named.
  const normalizedTitle = normalizeText(rawTitle);
  for (const [alias, teams] of Object.entries(FIXTURE_ALIASES)) {
    if (normalizedTitle.includes(normalizeText(alias))) {
      return teams.map(normalizeTeam).sort();
    }
  }

  return [];
}

/** Jaccard overlap of title tokens, ignoring very short words. */
export function titleOverlap(a, b) {
  const tokens = (v) => new Set(normalizeText(v).split(' ').filter((w) => w.length > 2));
  const setA = tokens(a);
  const setB = tokens(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;

  return shared / new Set([...setA, ...setB]).size;
}

/** Venue names differ cosmetically between feeds ("Camp Nou" vs "Spotify Camp Nou"). */
function venuesMatch(a, b) {
  const va = normalizeTeam(a);
  const vb = normalizeTeam(b);
  if (!va || !vb) return false;
  return va === vb || va.includes(vb) || vb.includes(va);
}

function sameCategory(a, b) {
  const ca = normalizeText(a?.category);
  const cb = normalizeText(b?.category);
  if (!ca || !cb) return false;
  const isSport = (c) => c.includes('sport') || c.includes('soccer') || c.includes('football');
  return ca === cb || (isSport(ca) && isSport(cb));
}

/**
 * Decides whether two events are the same real-world thing.
 *
 * @returns {{ merge: boolean, confidence: 'high'|'medium'|'none', reason: string }}
 */
export function compareEvents(a, b) {
  // Date is a hard gate. Without it, two different matches in one city would merge.
  if (!a?.date || !b?.date || a.date !== b.date) {
    return { merge: false, confidence: 'none', reason: 'different-date' };
  }

  const teamsA = extractTeams(a);
  const teamsB = extractTeams(b);
  const bothHaveTeams = teamsA.length === 2 && teamsB.length === 2;

  if (bothHaveTeams && teamsA[0] === teamsB[0] && teamsA[1] === teamsB[1]) {
    return { merge: true, confidence: 'high', reason: 'both-teams-match' };
  }

  // Two known fixtures on the same day whose teams disagree are definitively different —
  // this is what stops a double-header from collapsing into one card.
  if (bothHaveTeams) {
    return { merge: false, confidence: 'none', reason: 'teams-differ' };
  }

  const overlap = titleOverlap(a.title, b.title);

  if (normalizeText(a.title) === normalizeText(b.title)) {
    return { merge: true, confidence: 'high', reason: 'identical-title' };
  }

  if (venuesMatch(a.venue, b.venue) && sameCategory(a, b) && overlap >= 0.5) {
    return { merge: true, confidence: 'high', reason: 'venue-category-title' };
  }

  const oneTeamMatches =
    teamsA.length > 0 && teamsB.length > 0 && teamsA.some((t) => teamsB.includes(t));

  if (oneTeamMatches || venuesMatch(a.venue, b.venue) || overlap >= 0.3) {
    // Plausible but not certain. Conservative policy keeps both.
    return { merge: false, confidence: 'medium', reason: 'insufficient-evidence' };
  }

  return { merge: false, confidence: 'none', reason: 'no-evidence' };
}

/** Ticketing records lead: only they carry price, purchase URL and sold-out status. */
function ticketingRank(event) {
  let rank = 0;
  if (event?.priceEstimate) rank += 2;
  if (event?.url) rank += 2;
  if (typeof event?.isSoldOut === 'boolean') rank += 1;
  if (typeof event?.eventImpactScore === 'number') rank += 1;
  return rank;
}

/**
 * Combines two matched events, preferring the ticketing record for shared fields and
 * taking fixture-only fields from the other.
 */
export function mergePair(a, b) {
  const [primary, secondary] = ticketingRank(a) >= ticketingRank(b) ? [a, b] : [b, a];

  return {
    ...secondary,
    ...primary,
    // A fixture record must never blank out ticketing data by being spread last.
    priceEstimate: primary.priceEstimate ?? secondary.priceEstimate ?? null,
    url: primary.url ?? secondary.url ?? null,
    isSoldOut: primary.isSoldOut ?? secondary.isSoldOut ?? false,
    eventImpactScore: primary.eventImpactScore ?? secondary.eventImpactScore ?? null,

    // Fixture detail enriches what ticketing cannot describe.
    league: primary.league ?? secondary.league ?? null,
    homeTeam: primary.homeTeam ?? secondary.homeTeam ?? null,
    awayTeam: primary.awayTeam ?? secondary.awayTeam ?? null,

    // A venue name is more useful than a generic placeholder.
    venue:
      primary.venue && !/^major stadium/i.test(primary.venue)
        ? primary.venue
        : secondary.venue || primary.venue,

    isLiveApi: Boolean(primary.isLiveApi || secondary.isLiveApi),
    mergedFrom: [...new Set([primary.source, secondary.source].filter(Boolean))]
  };
}

/**
 * Merges events from several providers into one list.
 *
 * @param {Array<Array<object>>} eventsByProvider
 * @returns {Array<object>} deduplicated events, ticketing records preferred
 */
export function mergeEventLists(eventsByProvider = []) {
  // Providers with richer (ticketing) data first, so they become the merge base.
  const lists = [...eventsByProvider].sort((listA, listB) => {
    const score = (list) => (list[0] ? ticketingRank(list[0]) : 0);
    return score(listB) - score(listA);
  });

  const merged = [];

  for (const list of lists) {
    for (const candidate of list) {
      const existingIndex = merged.findIndex((kept) => compareEvents(kept, candidate).merge);

      if (existingIndex === -1) {
        merged.push(candidate);
        continue;
      }

      merged[existingIndex] = mergePair(merged[existingIndex], candidate);
    }
  }

  return merged;
}
