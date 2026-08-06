/**
 * The "% match" on a "When to Go" card.
 *
 * -------------------------------------------------------------------------------------
 * WHAT WAS WRONG
 *
 * The previous score was:
 *
 *   averageMarketPrice = roundtripPrice * 1.35
 *   savingsPercent     = (avg - price) / avg          -> 26, for every fare that exists
 *   priceScore         = min(50, savings * 1.2)       -> 31.2, always
 *   interestBonus      = events match an interest?    -> 20, always: the events had
 *                                                        already been FILTERED to those
 *                                                        interests two lines earlier
 *   eventScore         = min(30, count * 15)          -> 15 or 30
 *
 * Two of the three terms were constants and the third was a step function, so the score
 * could return exactly two values: 81 for two or more events, 66 for one. Users saw 81
 * everywhere because 81 was almost the only thing it could say.
 *
 * WHAT REPLACES IT
 *
 * Four components, each computed from something that actually varies between
 * destinations, and each able to explain itself in one sentence on the card:
 *
 *   fare       where this fare sits against other destinations in THIS search, and
 *              against what KAIRO has really observed for the route when it has enough
 *              observations to say
 *   interests  how many of the interests the user selected are genuinely represented
 *   depth      how much is on, with diminishing returns
 *   spread     how much of the trip has something on, rather than one busy evening
 *
 * Confidence is deliberately NOT folded into the score. A thin-evidence 90 and a
 * well-evidenced 90 are the same claim about the destination and different claims about
 * how much we know, and averaging the two produces a number that means neither.
 * -------------------------------------------------------------------------------------
 */

export const MATCH_WEIGHTS = {
  fare: 40,
  interests: 25,
  depth: 15,
  spread: 20
};

/** Below this many observations a percentile describes our sample, not the market. */
export const MIN_HISTORY_OBSERVATIONS = 5;

/**
 * How much of the fare component the real history carries once it exists.
 *
 * History is the better evidence — it compares a fare to itself over time rather than to
 * unrelated cities — but the in-search rank still matters, because the user is choosing
 * between the destinations in front of them.
 */
const HISTORY_WEIGHT = 0.6;

/** Events beyond this many stop adding to the depth component. */
const DEPTH_SATURATION = 5;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** Nights between two ISO dates, floored at 1 so a day trip cannot divide by zero. */
export function tripNights(departureDate, returnDate) {
  const nights = Math.round((Date.parse(returnDate) - Date.parse(departureDate)) / 86_400_000);
  return Number.isFinite(nights) && nights > 0 ? nights : 1;
}

/**
 * Rank of each price in a list, as a 0-100 score where 100 is the cheapest.
 *
 * Ties share a rank, so two destinations at the same fare cannot be separated by an
 * accident of array order.
 */
export function fareRankPercentiles(prices = []) {
  const ranks = new Map();
  if (prices.length === 0) return ranks;
  if (prices.length === 1) return ranks.set(prices[0], 100);

  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Every route costs the same: rank carries no information, so award the neutral middle
  // rather than declaring all of them the cheapest.
  if (max === min) {
    prices.forEach((p) => ranks.set(p, 50));
    return ranks;
  }

  prices.forEach((p) => ranks.set(p, Math.round(((max - p) / (max - min)) * 100)));
  return ranks;
}

/** Distinct calendar days on which at least one matched event falls. */
function distinctEventDays(events) {
  return new Set(events.map((e) => String(e.date || '').slice(0, 10)).filter(Boolean)).size;
}

/**
 * Scores one destination.
 *
 * @param {object} input
 * @param {number}  input.fareRank            0-100, 100 = cheapest in this search
 * @param {number?} input.historicalPercentile 0-100, 0 = cheapest ever seen for the route
 * @param {number}  input.historicalSampleSize how many observations that percentile rests on
 * @param {Array}   input.events              events matching the user's interests
 * @param {Array}   input.interests           interest categories the user selected
 * @param {string}  input.priceSource         'live' | 'estimate'
 * @param {string}  input.coverage            'full' | 'ticketed-only'
 */
export function scoreDestination({
  fareRank = 50,
  historicalPercentile = null,
  historicalSampleSize = 0,
  events = [],
  interests = [],
  departureDate,
  returnDate,
  priceSource = 'estimate',
  coverage = 'ticketed-only'
} = {}) {
  const hasHistory =
    historicalPercentile !== null &&
    historicalPercentile !== undefined &&
    historicalSampleSize >= MIN_HISTORY_OBSERVATIONS;

  // ---- fare ---------------------------------------------------------------------------
  const inSearch = clamp01(fareRank / 100);
  const historical = hasHistory ? clamp01((100 - historicalPercentile) / 100) : null;
  const fareRatio = historical === null ? inSearch : HISTORY_WEIGHT * historical + (1 - HISTORY_WEIGHT) * inSearch;

  // ---- interests ----------------------------------------------------------------------
  /*
    Measured as COVERAGE, not as "did anything match".

    The old bonus asked whether a matched event matched an interest, after the list had
    been filtered to matching events — a question with one possible answer. Coverage asks
    how many of the interests the user actually selected are represented, which separates a
    city with music, sport and festivals from one with three concerts.
  */
  const presentCategories = new Set(events.map((e) => e.category).filter(Boolean));
  const interestRatio = interests.length
    ? interests.filter((i) => presentCategories.has(i)).length / interests.length
    : Math.min(1, presentCategories.size / 4);

  // ---- depth --------------------------------------------------------------------------
  // One event is the price of entry, not a distinguishing feature; the fifth adds little
  // over the fourth.
  const depthRatio = clamp01((events.length - 1) / (DEPTH_SATURATION - 1));

  // ---- spread -------------------------------------------------------------------------
  // Something on across the trip beats everything on one night.
  const nights = tripNights(departureDate, returnDate);
  const spreadRatio = clamp01(distinctEventDays(events) / Math.min(nights, DEPTH_SATURATION));

  const components = [
    {
      key: 'fare',
      label: 'Fare',
      points: Math.round(fareRatio * MATCH_WEIGHTS.fare),
      max: MATCH_WEIGHTS.fare,
      detail: hasHistory
        ? `Cheaper than ${100 - historicalPercentile}% of the ${historicalSampleSize} fares KAIRO has recorded for this route`
        : 'Ranked against the other destinations in this search (no route history yet)'
    },
    {
      key: 'interests',
      label: 'Your interests',
      points: Math.round(interestRatio * MATCH_WEIGHTS.interests),
      max: MATCH_WEIGHTS.interests,
      detail: interests.length
        ? `${interests.filter((i) => presentCategories.has(i)).length} of your ${interests.length} interests have events here`
        : `${presentCategories.size} event categories on during your dates`
    },
    {
      key: 'depth',
      label: 'How much is on',
      points: Math.round(depthRatio * MATCH_WEIGHTS.depth),
      max: MATCH_WEIGHTS.depth,
      detail: `${events.length} matching event${events.length === 1 ? '' : 's'} during your dates`
    },
    {
      key: 'spread',
      label: 'Across your trip',
      points: Math.round(spreadRatio * MATCH_WEIGHTS.spread),
      max: MATCH_WEIGHTS.spread,
      detail: `Events on ${distinctEventDays(events)} separate day${distinctEventDays(events) === 1 ? '' : 's'} of your ${nights}-night trip`
    }
  ];

  const score = components.reduce((total, c) => total + c.points, 0);

  return { score, components, confidence: assessConfidence({ priceSource, coverage, hasHistory }) };
}

/**
 * How much the score rests on.
 *
 * Reported beside the number rather than inside it, so the card can show a high score
 * honestly labelled as provisional instead of quietly deflating it.
 */
export function assessConfidence({ priceSource, coverage, hasHistory }) {
  const gaps = [];

  if (priceSource !== 'live') gaps.push('Fare is modelled, not a live quote');
  if (!hasHistory) gaps.push('No price history for this route yet');

  const level = gaps.length === 0 ? 'high' : gaps.length === 1 ? 'medium' : 'low';
  return { level, gaps };
}

/**
 * The saving against a real baseline, or null.
 *
 * Returns null rather than a plausible-looking number when there is no history. That
 * absence is the entire point: the old code could always produce 26%, which is why nobody
 * could tell a bargain from a rip-off by looking at it.
 */
export function savingsAgainstTypical(roundtripPrice, typicalPrice, sampleSize = 0) {
  if (!typicalPrice || sampleSize < MIN_HISTORY_OBSERVATIONS) return null;
  if (roundtripPrice >= typicalPrice) return null;

  return {
    typicalPrice,
    savingsAmount: Math.round(typicalPrice - roundtripPrice),
    savingsPercent: Math.round(((typicalPrice - roundtripPrice) / typicalPrice) * 100),
    sampleSize
  };
}
