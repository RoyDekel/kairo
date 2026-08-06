/**
 * The Buy/Wait verdict on a "When to Go" card.
 *
 * -------------------------------------------------------------------------------------
 * WHAT WAS WRONG
 *
 * DestinationCard called the flight-detail engine with a synthetic object:
 *
 *   getPriceConfidenceInsight({ id: rec.id, price: rec.roundtripPrice }, rec.roundtripPrice)
 *
 * That object has no `insights` property, and `getPriceConfidenceInsight` guards on
 * exactly that — so it returned its "no history" stub every single time, for every card:
 *
 *   { verdict: null, recommendation: null, ... }
 *
 * Two consequences, both visible in production:
 *
 *   isWait = insight.recommendation === 'WAIT'   ->  null === 'WAIT'  ->  false, always.
 *            Every card read "Buy now". The verdict was a constant wearing a badge.
 *
 *   insight.low90Day was undefined, and the JSX rendered it as a bare `{expr}` after a
 *            literal "$" — so the card said "near the 90-day low of $" and stopped.
 *
 * This is the same failure the match score had (see destinationMatchScore.js): a number
 * presented as evidence that could only ever say one thing.
 *
 * WHAT REPLACES IT
 *
 * The verdict is derived from the route's own recorded fare history, which the
 * recommendation already carries and which genuinely varies:
 *
 *   historicalPercentile   where this fare sits among fares KAIRO has recorded for THIS
 *                          route. 0 = the cheapest we have ever seen it.
 *   historicalSampleSize   how many observations that percentile rests on.
 *   typicalPrice           the route's usual fare, when there are enough observations.
 *
 * Below MIN_HISTORY_OBSERVATIONS there is no verdict — not a cheerful default. A green
 * "Buy now" on a route we have priced twice is a claim we cannot support, and it is the
 * single most decision-relevant element on the card.
 *
 * Nothing here forecasts. The old copy promised "a drop of ~$X expected in N days"; no
 * forecast exists at this layer, so the wait state describes the fare's position instead
 * of inventing a timeline.
 * -------------------------------------------------------------------------------------
 */

import { MIN_HISTORY_OBSERVATIONS } from './destinationMatchScore';

export const VERDICT_BUY = 'BUY_NOW';
export const VERDICT_WAIT = 'WAIT';

/**
 * At or below this percentile the fare is called cheap for its own route.
 *
 * 35 rather than 50: "cheaper than most" is a weak reason to commit money. It sits
 * slightly above the bottom quartile so that a genuinely good fare is not withheld on a
 * technicality, and well below the median so "Buy now" keeps meaning something.
 */
export const BUY_PERCENTILE_CEILING = 35;

function isUsablePercentile(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * "$743", or "This fare" when there is no number to show.
 *
 * The bug this module replaces printed a literal "$" followed by an undefined value. A
 * price is interpolated into copy in several places here, so the guard lives in one
 * function rather than being repeated — and never at a call site that could forget it.
 */
function priceLabel(price) {
  return Number.isFinite(price) ? `$${Math.round(price)}` : 'This fare';
}

/**
 * @param {object} input
 * @param {number}  input.roundtripPrice       the fare shown on the card
 * @param {number?} input.historicalPercentile 0-100, 0 = cheapest ever recorded, or null
 * @param {number}  input.historicalSampleSize observations behind that percentile
 * @param {number?} input.typicalPrice         the route's usual fare, or null
 * @param {string}  input.priceSource          'live' | 'estimate'
 *
 * @returns {{
 *   verdict: 'BUY_NOW'|'WAIT'|null,
 *   tone: 'buy'|'wait'|'neutral',
 *   label: string,
 *   detail: string,
 *   tooltip: string,
 *   sampleSize: number,
 *   percentile: number|null
 * }}
 * `detail` is always a complete sentence fragment with no placeholder holes — every value
 * interpolated into it is checked before the branch that uses it.
 */
export function destinationFareVerdict({
  roundtripPrice,
  historicalPercentile = null,
  historicalSampleSize = 0,
  typicalPrice = null,
  priceSource = 'estimate'
} = {}) {
  const sampleSize = Number.isFinite(historicalSampleSize) ? historicalSampleSize : 0;
  const hasHistory = isUsablePercentile(historicalPercentile) && sampleSize >= MIN_HISTORY_OBSERVATIONS;

  if (!hasHistory) {
    return {
      verdict: null,
      tone: 'neutral',
      label: 'No verdict yet',
      detail: `${sampleSize} of ${MIN_HISTORY_OBSERVATIONS} fares recorded for this route`,
      tooltip:
        `KAIRO needs at least ${MIN_HISTORY_OBSERVATIONS} recorded fares on a route before ` +
        `it will call a fare cheap or expensive. It has ${sampleSize} so far. ` +
        `Track this route to help build the baseline.`,
      sampleSize,
      percentile: isUsablePercentile(historicalPercentile) ? historicalPercentile : null
    };
  }

  const percentile = Math.round(historicalPercentile);
  const cheaperThan = Math.max(0, Math.min(100, 100 - percentile));
  const estimateNote = priceSource === 'estimate'
    ? ' This is an estimated fare, not a live quote — track it for a verdict on the real price.'
    : '';

  if (percentile <= BUY_PERCENTILE_CEILING) {
    return {
      verdict: VERDICT_BUY,
      tone: 'buy',
      label: 'Buy now',
      detail: `Cheaper than ${cheaperThan}% of the ${sampleSize} fares recorded here`,
      tooltip:
        `${priceLabel(roundtripPrice)} sits in the bottom ${percentile}% of the ${sampleSize} ` +
        `fares KAIRO has recorded for this route.${estimateNote}`,
      sampleSize,
      percentile
    };
  }

  // Only claim a gap to the usual price when there genuinely is one.
  const gapToTypical =
    Number.isFinite(typicalPrice) && Number.isFinite(roundtripPrice) && roundtripPrice > typicalPrice
      ? Math.round(roundtripPrice - typicalPrice)
      : null;

  return {
    verdict: VERDICT_WAIT,
    tone: 'wait',
    label: 'Wait',
    detail: gapToTypical !== null
      ? `$${gapToTypical} above the ${priceLabel(typicalPrice)} usual for this route`
      : `pricier than ${percentile}% of the ${sampleSize} fares recorded here`,
    tooltip:
      `${priceLabel(roundtripPrice)} sits ${percentile}% up the range of the ${sampleSize} ` +
      `fares KAIRO has recorded for this route, so there is room for it to fall.${estimateNote}`,
    sampleSize,
    percentile
  };
}
