import { AIRLINES } from './flightSimulator';

/**
 * Turns KAIRO's signals into concrete, route-specific reasons.
 *
 * Replaces the four `rationalePillars`, which described the *method*
 * ("Seasonal travel demand forecasting models") rather than the *evidence* for this
 * particular flight. Every item here is derived from a real value already in the data:
 * live Ticketmaster events, the 90-day percentile, days to departure, seat inventory,
 * the departure weekday, and the carrier tier.
 *
 * Each item declares which way it points. Showing evidence that argues *against* the
 * recommendation is deliberate — a verdict backed only by confirming reasons reads like
 * marketing, not analysis.
 *
 * `direction`:
 *   'buy'     — argues for booking now
 *   'wait'    — argues for holding off
 *   'neutral' — context that doesn't push either way
 */

/** Weekend departures carry the 1.2x multiplier from shared/catalog.js. */
const WEEKEND_DAYS = new Set([0, 5, 6]); // Sun, Fri, Sat

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Parses "YYYY-MM-DD" as a LOCAL calendar date.
 *
 * `new Date('2026-08-15')` is parsed as UTC midnight, so west of Greenwich it reports the
 * previous day — a Saturday departure would be described as Friday. Departure dates here
 * are calendar dates, not instants, so they must not shift with the viewer's timezone.
 */
function parseCalendarDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    const loose = new Date(dateStr);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function buildVerdictEvidence({ flight, insight, departureDate } = {}) {
  if (!flight || !insight) return [];

  const evidence = [];
  const currentPrice = insight.currentPrice ?? flight.price;

  // --- 1. Live event pressure at the destination (real Ticketmaster data) ---
  const topEvent = insight.topEvent;
  if (topEvent?.title) {
    const impact = topEvent.eventImpactScore ?? insight.eventImpactScore;

    if (topEvent.isSoldOut || insight.isHighImpactEvent) {
      evidence.push({
        id: 'event-surge',
        direction: 'buy',
        headline: `${topEvent.isSoldOut ? 'Sold-out' : 'High-demand'} event on your dates`,
        detail: `"${topEvent.title}" at ${topEvent.venue}${impact ? ` — ${impact}% demand impact` : ''}. Seats into ${flight.destination} get scarce around events like this.`
      });
    } else {
      evidence.push({
        id: 'event-quiet',
        direction: 'wait',
        headline: 'No major event competing for seats',
        detail: `The biggest thing on is "${topEvent.title}"${impact ? ` (${impact}% impact)` : ''}, which isn't enough to move fares.`
      });
    }
  }

  // --- 2. Where this fare sits in its own 90-day range ---
  if (insight.low90Day && insight.high90Day) {
    const range = Math.max(1, insight.high90Day - insight.low90Day);
    const percentile = insight.pricePercentile ?? Math.round(((currentPrice - insight.low90Day) / range) * 100);
    const aboveLow = currentPrice - insight.low90Day;

    if (percentile <= 25) {
      evidence.push({
        id: 'price-low',
        direction: 'buy',
        headline: `Bottom ${percentile}% of the 90-day range`,
        detail: `$${currentPrice} against a $${insight.low90Day}–$${insight.high90Day} range. Only $${aboveLow} above the lowest fare seen.`
      });
    } else {
      evidence.push({
        id: 'price-high',
        direction: 'wait',
        headline: `$${aboveLow} above the 90-day low`,
        detail: `$${currentPrice} sits ${percentile}% up the $${insight.low90Day}–$${insight.high90Day} range, so there's room to fall.`
      });
    }
  }

  // --- 3. Days-to-departure curve ---
  if (typeof insight.daysToDeparture === 'number') {
    const days = insight.daysToDeparture;

    if (days <= 14) {
      evidence.push({
        id: 'departure-imminent',
        direction: 'buy',
        headline: `Only ${days} days to departure`,
        detail: 'Inside two weeks, airline revenue systems raise fares rather than discount them.'
      });
    } else if (days > 40) {
      evidence.push({
        id: 'departure-early',
        direction: 'wait',
        headline: `${days} days out — still early`,
        detail: 'Fares this far ahead usually soften as the airline starts managing load.'
      });
    } else {
      evidence.push({
        id: 'departure-window',
        direction: 'neutral',
        headline: `${days} days out — the usual sweet spot`,
        detail: 'This window is typically where fares bottom out, so movement either way is likely to be small.'
      });
    }
  }

  // --- 4. Seat inventory on this specific fare ---
  if (typeof flight.seatsRemaining === 'number' && flight.seatsRemaining <= 5) {
    evidence.push({
      id: 'seats-scarce',
      direction: 'buy',
      headline: `${flight.seatsRemaining} seat${flight.seatsRemaining === 1 ? '' : 's'} left at this fare`,
      detail: 'Once this bucket sells out the next one up is priced higher, regardless of the trend.'
    });
  }

  // --- 5. Weekend departure premium ---
  if (departureDate) {
    const parsed = parseCalendarDate(departureDate);
    if (parsed && WEEKEND_DAYS.has(parsed.getDay())) {
      evidence.push({
        id: 'weekend-premium',
        direction: 'neutral',
        headline: `${WEEKDAY_NAMES[parsed.getDay()]} departure carries a premium`,
        detail: 'Weekend departures price about 20% above midweek. Shifting a day or two is often worth more than waiting.'
      });
    }
  }

  // --- 6. Carrier tier ---
  const carrier = AIRLINES[flight.airlineCode];
  if (carrier?.type === 'lowcost') {
    evidence.push({
      id: 'carrier-lowcost',
      direction: 'wait',
      headline: `${carrier.name} fares move often`,
      detail: 'Low-cost carriers reprice far more frequently than flag carriers, so waiting has more upside here.'
    });
  }

  return evidence;
}

/** Counts how the evidence splits, for a one-line summary above the list. */
export function summariseEvidence(evidence) {
  const forBuy = evidence.filter((e) => e.direction === 'buy').length;
  const forWait = evidence.filter((e) => e.direction === 'wait').length;
  return { forBuy, forWait, total: evidence.length };
}
