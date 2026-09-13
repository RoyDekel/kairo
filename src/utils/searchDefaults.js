/**
 * KAIRO shared search defaults.
 *
 * Single source of truth for the seed route/date/passenger values. Previously these
 * literals were duplicated across App.jsx, AIDestinationExplorer.jsx and
 * aiDestinationEngine.js, which let the pages drift apart from each other.
 */

export const DEFAULT_ORIGIN = 'TLV';
export const DEFAULT_DESTINATION = 'KRK';

/** Formats a Date object to YYYY-MM-DD string format in local time */
export const formatDateToYYYYMMDD = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/** Dynamic default departure date: Today (Date.now()) */
export const getTodayDateString = () => formatDateToYYYYMMDD(new Date());

/**
 * How far ahead the seed search departs.
 *
 * It used to be today. Late in the day no flight on the default route is left to depart,
 * so the login search came back with no outbound flights and the dashboard silently kept
 * its simulated bundle; when flights did exist, the server's "≤14 days → BUY_NOW" rule
 * decided the verdict, not the fare.
 *
 * 16, not 14: the server counts days as ceil((departure at UTC midnight − now) / 1 day),
 * and this is a LOCAL calendar date, so 14 lands on exactly 14 (still BUY_NOW) and 15
 * can too late in the evening west of UTC. 16 clears the rule in every timezone.
 */
export const DEFAULT_DEPARTURE_OFFSET_DAYS = 16;

/** Nights between the default departure and return — the length the seed trip always had. */
export const DEFAULT_TRIP_LENGTH_DAYS = 1;

const daysFrom = (now, days) => {
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  return formatDateToYYYYMMDD(d);
};

/*
  Functions, not constants. These were module-level constants evaluated once at import,
  so a tab left open past midnight kept searching the day it was opened — including dates
  that had already passed. Call them at the moment the date is needed.
*/
export const getDefaultDepartureDate = (now = new Date()) =>
  daysFrom(now, DEFAULT_DEPARTURE_OFFSET_DAYS);

export const getDefaultReturnDate = (now = new Date()) =>
  daysFrom(now, DEFAULT_DEPARTURE_OFFSET_DAYS + DEFAULT_TRIP_LENGTH_DAYS);

/** Returns a fresh passenger object so callers can never mutate a shared literal. */
export const createDefaultPassengers = () => ({ adults: 1, children: 0, infants: 0 });

/** The canonical shape of the app-wide `searchParams` state. */
export const createDefaultSearchParams = (now = new Date()) => ({
  tripType: 'round-trip',
  origin: DEFAULT_ORIGIN,
  // Intentionally blank: "Search & Compare" requires an explicit destination choice,
  // and "When to Go" treats the destination as an output rather than an input.
  destination: '',
  departureDate: getDefaultDepartureDate(now),
  returnDate: getDefaultReturnDate(now),
  passengers: createDefaultPassengers(),
  stops: '0',
  travelClass: 'ALL'
});
