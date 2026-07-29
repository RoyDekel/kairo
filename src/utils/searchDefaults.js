/**
 * KAIRO shared search defaults.
 *
 * Single source of truth for the seed route/date/passenger values. Previously these
 * literals were duplicated across App.jsx, AIDestinationExplorer.jsx and
 * aiDestinationEngine.js, which let the pages drift apart from each other.
 */

export const DEFAULT_ORIGIN = 'TLV';
export const DEFAULT_DESTINATION = 'KRK';
export const DEFAULT_DEPARTURE_DATE = '2026-08-11';
export const DEFAULT_RETURN_DATE = '2026-08-16';

/** Returns a fresh passenger object so callers can never mutate a shared literal. */
export const createDefaultPassengers = () => ({ adults: 1, children: 0, infants: 0 });

/** The canonical shape of the app-wide `searchParams` state. */
export const createDefaultSearchParams = () => ({
  tripType: 'round-trip',
  origin: DEFAULT_ORIGIN,
  // Intentionally blank: "Search & Compare" requires an explicit destination choice,
  // and "Where to Go" treats the destination as an output rather than an input.
  destination: '',
  departureDate: DEFAULT_DEPARTURE_DATE,
  returnDate: DEFAULT_RETURN_DATE,
  passengers: createDefaultPassengers(),
  stops: '0'
});
