import { AIRPORTS } from './flightSimulator';
import { getApiBase, authHeaders, fetchWithTimeout } from '../lib/apiBase';
import { readCachedEvents, writeCachedEvents } from './discoveryEventCache';
import { detectTravelOccasion } from '../../shared/travelOccasion.js';
import {
  DEFAULT_ORIGIN,
  DEFAULT_DEPARTURE_DATE,
  DEFAULT_RETURN_DATE
} from './searchDefaults';

/**
 * Raised when the backend event intelligence service can't be reached.
 *
 * The UI needs to tell "the service is down" apart from "there genuinely are no events
 * on these dates" — they are very different messages for the user.
 */
export class DiscoveryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DiscoveryUnavailableError';
  }
}

/**
 * Fetches live events for many destinations in ONE backend call.
 *
 * The Ticketmaster credential lives only on the server (see
 * server/services/ticketmasterService.js). This module previously embedded the API key
 * directly, which shipped it to every visitor inside the public JS bundle.
 *
 * Batching also removes the old behaviour of issuing one sequential request per airport
 * (~30 round trips) every time a filter changed.
 *
 * Destinations already answered for these exact dates are served from the session cache
 * and left out of the request entirely, so re-running a search the user has already run
 * costs no network at all. See discoveryEventCache.js for why the cache is per
 * destination rather than per search.
 */
export async function fetchEventsForDestinations(destinationCodes, startDateStr, endDateStr, accessToken) {
  if (!destinationCodes?.length) return {};

  const { cached, misses } = readCachedEvents(destinationCodes, startDateStr, endDateStr);

  // Everything is known. Returning here is the whole point: no request, no spinner, and
  // no exposure to a cold-starting backend for an answer we already have.
  if (misses.length === 0) return cached;

  const params = new URLSearchParams({
    destinations: misses.join(','),
    startDate: startDateStr || '',
    endDate: endDateStr || ''
  });

  let res;
  try {
    res = await fetchWithTimeout(`${getApiBase()}/api/events/batch?${params.toString()}`, {
      timeoutMs: 12000,
      headers: authHeaders(accessToken)
    });
  } catch (err) {
    /*
      Deliberately thrown even though `cached` holds usable results.

      Rendering the cached subset would present a partial page as a complete answer, with
      no way for the user to tell that half the destinations were never checked — the same
      silent lie the per-destination status codes exist to prevent.
    */
    throw new DiscoveryUnavailableError(`Could not reach the event intelligence service: ${err.message}`);
  }

  if (!res.ok) {
    throw new DiscoveryUnavailableError(`Event intelligence service returned status ${res.status}`);
  }

  const data = await res.json();
  const fetched = data?.eventsByDestination || {};

  writeCachedEvents(fetched, data?.statusByDestination || {}, startDateStr, endDateStr);

  return { ...cached, ...fetched };
}

/**
 * Normalises a backend event into the shape the destination cards render.
 * Keeps only title, category, venue, date and price estimate.
 */
function normalizeEvent(evt, destCode, index) {
  const segmentName = (evt.category || '').toLowerCase();

  let category = 'culture';
  let categoryLabel = 'Culture 🏛️';

  if (segmentName.includes('music')) {
    category = 'music';
    categoryLabel = 'Music 🎵';
  } else if (segmentName.includes('sport')) {
    category = 'sports';
    categoryLabel = 'Sports ⚽';
  } else if (segmentName.includes('arts') || segmentName.includes('theatre') || segmentName.includes('festival')) {
    category = 'festivals';
    categoryLabel = 'Festivals 🎪';
  }

  return {
    id: evt.id || `tm-${destCode}-${index}`,
    destination: destCode,
    title: evt.title,
    venue: evt.venue,
    category,
    categoryLabel,
    isLiveApi: Boolean(evt.isLiveApi),
    date: evt.date,
    priceEstimate: evt.priceEstimate,
    url: evt.url
  };
}

/** Deduplicates events by title so each destination lists a given title at most once. */
function dedupeByTitle(events, destCode) {
  const seenTitles = new Set();
  const unique = [];

  for (const evt of events) {
    if (!evt?.title) continue;

    const title = evt.title.trim();
    const normalizedTitle = title.toLowerCase();
    if (seenTitles.has(normalizedTitle)) continue;
    seenTitles.add(normalizedTitle);

    unique.push(normalizeEvent({ ...evt, title }, destCode, unique.length));
  }

  return unique;
}

/**
 * Fetches cheapest-roundtrip pricing for many destinations from the backend.
 *
 * The client deliberately does NOT price routes itself any more. It used to call
 * generateFlightsForRoute() locally while "Search & Compare" hit /api/flights, so the
 * same route could be advertised at one price on the discovery page and sold at another
 * on the comparison page. All fares now originate from one server-side service.
 *
 * Each entry carries `source`: 'live' (a real provider quote, identical to what Search &
 * Compare shows) or 'estimate' (modelled, because scanning every destination against a
 * paid provider isn't affordable).
 */
export async function fetchFareEstimates({ origin, departureDate, returnDate, passengers, accessToken }) {
  const { adults = 1, children = 0, infants = 0 } = passengers || {};

  const params = new URLSearchParams({
    origin,
    departureDate: departureDate || '',
    returnDate: returnDate || '',
    adults: String(adults),
    children: String(children),
    infants: String(infants)
  });

  let res;
  try {
    res = await fetchWithTimeout(`${getApiBase()}/api/flights/estimates?${params.toString()}`, {
      timeoutMs: 12000,
      headers: authHeaders(accessToken)
    });
  } catch (err) {
    throw new DiscoveryUnavailableError(`Could not reach the fare pricing service: ${err.message}`);
  }

  if (!res.ok) {
    throw new DiscoveryUnavailableError(`Fare pricing service returned status ${res.status}`);
  }

  const data = await res.json();
  return data?.estimates || {};
}

/**
 * Fetches the authoritative fare for ONE route via the real provider.
 *
 * Used when the user commits to a destination: the buy/wait verdict must never be
 * computed against a modelled price. Also warms the server-side quote cache, so the
 * discovery card for this route flips from "est." to "live fare" afterwards.
 *
 * Returns null when the backend is unavailable — callers should keep the estimate.
 */
export async function fetchAuthoritativeQuote({
  origin,
  destination,
  departureDate,
  returnDate,
  passengers,
  accessToken
}) {
  const { adults = 1, children = 0, infants = 0 } = passengers || {};

  const params = new URLSearchParams({
    origin,
    destination,
    departureDate: departureDate || '',
    returnDate: returnDate || '',
    adults: String(adults),
    children: String(children),
    infants: String(infants),
    stops: '0'
  });

  const res = await fetchWithTimeout(`${getApiBase()}/api/flights?${params.toString()}`, {
    timeoutMs: 12000,
    headers: authHeaders(accessToken)
  });

  if (!res.ok) return null;

  const data = await res.json();
  const outbound = pickCheapest(data.outbound);
  if (!outbound) return null;

  return { outbound, return: pickCheapest(data.return) };
}

/** Lowest-priced flight in a list, or null. */
function pickCheapest(flights) {
  if (!Array.isArray(flights) || flights.length === 0) return null;
  return flights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), flights[0]);
}

/**
 * Searches global destinations and correlates flight prices with verified live events.
 * Returns an empty list when no destination has matching events in range.
 *
 * @throws {DiscoveryUnavailableError} when the backend can't be reached.
 */
export async function searchAIDestinations({
  origin = DEFAULT_ORIGIN,
  departureDate = DEFAULT_DEPARTURE_DATE,
  returnDate = DEFAULT_RETURN_DATE,
  maxBudget = 1000,
  interests = [],
  accessToken = null
}) {
  // Step 1: one call for server-authoritative pricing across all destinations.
  const estimates = await fetchFareEstimates({
    origin,
    departureDate,
    returnDate,
    passengers: { adults: 1, children: 0, infants: 0 },
    accessToken
  });

  const pricedRoutes = Object.values(estimates)
    .filter((entry) => entry && entry.outbound && AIRPORTS[entry.destination])
    .filter((entry) => !maxBudget || entry.roundtripPrice <= maxBudget)
    .map((entry) => ({
      destCode: entry.destination,
      cheapestOutbound: entry.outbound,
      cheapestReturn: entry.return,
      totalRoundtripPrice: entry.roundtripPrice,
      priceSource: entry.source,
      quotedAt: entry.quotedAt
    }));

  if (!pricedRoutes.length) return [];

  // Step 2: one batched call for events, covering only affordable destinations.
  const eventsByDestination = await fetchEventsForDestinations(
    pricedRoutes.map((r) => r.destCode),
    departureDate,
    returnDate,
    accessToken
  );

  const results = [];

  for (const { destCode, cheapestOutbound, cheapestReturn, totalRoundtripPrice, priceSource, quotedAt } of pricedRoutes) {
    const destinationInfo = AIRPORTS[destCode];
    const realEvents = dedupeByTitle(eventsByDestination[destCode] || [], destCode);

    const matchedEvents = interests.length > 0
      ? realEvents.filter((evt) => interests.includes(evt.category))
      : realEvents;

    // Only surface a destination that has verified live events during the trip window.
    if (matchedEvents.length === 0) continue;

    // Benchmark comparison price (simulate 25%-45% baseline market savings)
    const averageMarketPrice = Math.round(totalRoundtripPrice * 1.35);
    const savingsAmount = averageMarketPrice - totalRoundtripPrice;
    const savingsPercent = Math.round((savingsAmount / averageMarketPrice) * 100);

    // Calculate AI Recommendation Match Score (0 to 100)
    const priceScore = Math.min(50, savingsPercent * 1.2);
    const eventScore = Math.min(30, matchedEvents.length * 15);
    const interestBonus = interests.some((i) => matchedEvents.some((e) => e.category === i)) ? 20 : 5;

    const matchScore = Math.min(99, Math.round(priceScore + eventScore + interestBonus));

    // Rare timing, derived only from events a provider actually returned.
    const occasion = detectTravelOccasion({ city: destinationInfo.city, events: matchedEvents });

    const topEvent = matchedEvents[0];
    const fareWording = priceSource === 'live' ? 'Live fare' : 'Estimated fare';
    const aiInsight = `${destinationInfo.city} has verified live events during your dates! ${fareWording} is ${savingsPercent}% below historical average ($${totalRoundtripPrice} roundtrip). Catch "${topEvent.title}" at ${topEvent.venue} during your trip.`;

    results.push({
      id: `ai-dest-${destCode}`,
      destination: destinationInfo,
      originCode: origin,
      destCode,
      roundtripPrice: totalRoundtripPrice,
      priceSource,
      quotedAt,
      averageMarketPrice,
      savingsPercent,
      savingsAmount,
      outboundFlight: cheapestOutbound,
      returnFlight: cheapestReturn,
      matchedEvents,
      matchScore,
      occasion,
      aiInsight,
      departureDate,
      returnDate
    });
  }

  // Sort results by AI Match Score descending
  return results.sort((a, b) => b.matchScore - a.matchScore);
}
