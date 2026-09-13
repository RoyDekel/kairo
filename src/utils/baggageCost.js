/**
 * Bag-cost estimates for the Search & Compare listings.
 *
 * Choosing a bag does not change which flights exist, only what they cost to actually
 * fly with — so this re-prices the results already on screen instead of searching again.
 * No provider call, no cache key, and nothing here reaches fare_observations or the
 * BUY / WAIT verdict: those keep working on the fare alone, because a bag-inclusive price
 * compared against a fare-only history would measure the bag, not the market.
 *
 * Every number produced here is an ESTIMATE from shared/airlineBaggage.js and must be
 * labelled as one wherever it is shown.
 */
import { AIRLINE_BAGGAGE, LONG_HAUL_KM } from '../../shared/airlineBaggage.js';

export const BAG_OPTIONS = [
  { value: 'personal', label: 'Personal item' },
  { value: 'carryon', label: 'Carry-on' },
  { value: 'checked', label: 'Checked bag 23kg' }
];

/** Personal item only: every fare includes it, so the default changes no price. */
export const DEFAULT_BAG_OPTION = 'personal';

const POLICY_KEY = { carryon: 'carryOn', checked: 'checked' };
const BAG_NOUN = { carryon: 'carry-on', checked: 'checked bag' };

/** The fee table is in USD. A fare in any other currency cannot take a USD fee. */
const FEE_CURRENCY = 'USD';

const NO_BAG = Object.freeze({ status: 'none', fee: 0, range: null });

/**
 * The estimated cost of `bagOption` on one flight, per passenger, one way.
 *
 * @param {object} flight     a /api/flights result (airlineCode, distance, currency)
 * @param {string} bagOption  one of BAG_OPTIONS' values
 * @returns {{status: 'none'|'included'|'extra'|'fare-dependent'|'unknown', fee: number, range: number[]|null}}
 *   `fee` is what gets added to the fare; it is 0 for everything but 'extra' and
 *   'fare-dependent'. 'unknown' also adds 0 — and says so — rather than inventing a fee.
 */
export function estimateBagFee(flight, bagOption) {
  const key = POLICY_KEY[bagOption];
  if (!key || !flight) return NO_BAG;

  if (flight.currency && String(flight.currency).toUpperCase() !== FEE_CURRENCY) {
    return { status: 'unknown', fee: 0, range: null };
  }

  const code = String(flight.airlineCode || '').toUpperCase();
  const policy = AIRLINE_BAGGAGE[code]?.[key];
  if (!policy) return { status: 'unknown', fee: 0, range: null };

  if (policy.included === true) return { status: 'included', fee: 0, range: null };

  const isLongHaul = Number.isFinite(flight.distance) && flight.distance >= LONG_HAUL_KM;
  const range = (isLongHaul && policy.longHaulFee) || policy.fee;
  if (!Array.isArray(range)) return { status: 'unknown', fee: 0, range: null };

  return {
    status: policy.included === 'fare' ? 'fare-dependent' : 'extra',
    fee: Math.round((range[0] + range[1]) / 2),
    range
  };
}

/**
 * Passengers who pay for a bag. An infant on a lap has no bag allowance to buy.
 */
export function bagPayingPassengers(passengers) {
  const { adults = 1, children = 0 } = passengers || {};
  return Math.max(0, Number(adults) || 0) + Math.max(0, Number(children) || 0);
}

/** The per-adult fare plus the estimated bag fee — what "Cheapest" sorts on. */
export function fareWithBag(flight, bagOption) {
  return (Number(flight?.price) || 0) + estimateBagFee(flight, bagOption).fee;
}

const bagCostUnknown = (flight, bagOption) =>
  estimateBagFee(flight, bagOption).status === 'unknown';

/**
 * "Cheapest" sort order with a bag: fare plus bag, with every flight whose bag cost is
 * unknown AFTER every flight whose cost is known.
 *
 * An unknown bag adds 0, so ranking it on fare alone would float a carrier with no policy
 * on file above ones that honestly carry a fee — "cheapest with a checked bag" awarded to
 * the flight whose checked bag we know nothing about.
 */
export function compareFareWithBag(a, b, bagOption) {
  const ua = bagCostUnknown(a, bagOption);
  const ub = bagCostUnknown(b, bagOption);
  if (ua !== ub) return ua ? 1 : -1;
  return fareWithBag(a, bagOption) - fareWithBag(b, bagOption);
}

/**
 * Ids of the flight(s) that earn the "Cheapest Deal" tag with this bag. Same rule as the
 * sort: an unknown bag cost cannot win unless no flight's cost is known.
 */
export function cheapestFlightIdsWithBag(flights, bagOption) {
  const list = Array.isArray(flights) ? flights : [];
  const known = list.filter((f) => !bagCostUnknown(f, bagOption));
  const pool = known.length > 0 ? known : list;
  if (pool.length === 0) return new Set();
  const cheapest = Math.min(...pool.map((f) => fareWithBag(f, bagOption)));
  return new Set(pool.filter((f) => fareWithBag(f, bagOption) === cheapest).map((f) => f.id));
}

/** The whole party's fare for this leg plus every paying passenger's bag. */
export function totalWithBags(flight, bagOption, passengers) {
  const base = Number(flight?.passengerCosts?.total) || 0;
  return base + estimateBagFee(flight, bagOption).fee * bagPayingPassengers(passengers);
}

/**
 * The line shown under a fare: a short `text` and a longer `detail` for a tooltip.
 * Returns null for the personal-item default, which has nothing to say.
 */
export function describeBagEstimate(estimate, bagOption) {
  const noun = BAG_NOUN[bagOption];
  if (!noun || !estimate || estimate.status === 'none') return null;

  const [min, max] = estimate.range || [];
  switch (estimate.status) {
    case 'included':
      return {
        text: `${capitalize(noun)} included`,
        detail: `This airline's lowest fare typically includes a ${noun}. Check the fare conditions before booking.`
      };
    case 'extra':
      return {
        text: `+~$${estimate.fee} ${noun} (est.)`,
        detail: `Typical ${noun} fee $${min}–$${max} one way per passenger, bought online. Estimate — check with the airline.`
      };
    case 'fare-dependent':
      return {
        text: `+~$${estimate.fee} ${noun} (est.)`,
        detail: `Usually not in this airline's lowest fare (Light / Basic); higher fare families include it. Typical fee $${min}–$${max} one way per passenger.`
      };
    default:
      return {
        text: `${capitalize(noun)} fee unknown`,
        detail: `No baggage policy on file for this airline, so the ${noun} is not added to the total.`
      };
  }
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
