/**
 * Validation for the departure date on /api/flights.
 *
 * The endpoint used to accept any string. A search for a date that had already passed
 * still reached the provider, came back with no flights, and the empty result was written
 * to flight_search_cache like a real answer — the cache held rows for departures that were
 * days old when they were searched. Rejecting them up front costs nothing and tells the
 * user why, instead of showing an empty result that looks like "no flights on this route".
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Returns a user-readable error for an unusable departure date, or null when it is fine.
 *
 * The client sends a LOCAL calendar date, and this server runs on UTC. West of UTC the
 * user's today can be the server's yesterday (as far back as UTC−12), so a departure
 * dated yesterday-in-UTC may still be a legitimate same-day search. Only dates before
 * that are rejected; a same-day departure is a real (if last-minute) search.
 *
 * @param {string} departureDate  YYYY-MM-DD
 * @param {number} [now]          epoch ms, injectable for tests
 * @returns {string|null}
 */
export function departureDateError(departureDate, now = Date.now()) {
  const parsed = ISO_DATE.test(String(departureDate)) ? Date.parse(departureDate) : NaN;

  // Round-trip the parse so an impossible day (2026-02-30) is rejected rather than
  // silently rolled into the next month.
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== departureDate) {
    return 'The departure date must be a real date in YYYY-MM-DD format.';
  }

  const startOfUtcToday = Math.floor(now / DAY_MS) * DAY_MS;
  if (parsed < startOfUtcToday - DAY_MS) {
    return `The departure date ${departureDate} has already passed. Choose today or a later date.`;
  }

  return null;
}
