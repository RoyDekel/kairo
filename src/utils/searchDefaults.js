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

/** Dynamic default return date: Tomorrow (Date.now() + 1 day) */
export const getTomorrowDateString = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return formatDateToYYYYMMDD(tomorrow);
};

export const DEFAULT_DEPARTURE_DATE = getTodayDateString();
export const DEFAULT_RETURN_DATE = getTomorrowDateString();

/** Returns a fresh passenger object so callers can never mutate a shared literal. */
export const createDefaultPassengers = () => ({ adults: 1, children: 0, infants: 0 });

/** The canonical shape of the app-wide `searchParams` state. */
export const createDefaultSearchParams = () => ({
  tripType: 'round-trip',
  origin: DEFAULT_ORIGIN,
  // Intentionally blank: "Search & Compare" requires an explicit destination choice,
  // and "When to Go" treats the destination as an output rather than an input.
  destination: '',
  departureDate: DEFAULT_DEPARTURE_DATE,
  returnDate: DEFAULT_RETURN_DATE,
  passengers: createDefaultPassengers(),
  stops: '0'
});
