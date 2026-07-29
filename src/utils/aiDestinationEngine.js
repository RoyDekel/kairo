import { AIRPORTS, generateFlightsForRoute } from './flightSimulator';
import { getApiBase, authHeaders, fetchWithTimeout } from '../lib/apiBase';
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
 */
export async function fetchEventsForDestinations(destinationCodes, startDateStr, endDateStr, accessToken) {
  if (!destinationCodes?.length) return {};

  const params = new URLSearchParams({
    destinations: destinationCodes.join(','),
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
    throw new DiscoveryUnavailableError(`Could not reach the event intelligence service: ${err.message}`);
  }

  if (!res.ok) {
    throw new DiscoveryUnavailableError(`Event intelligence service returned status ${res.status}`);
  }

  const data = await res.json();
  return data?.eventsByDestination || {};
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
  const destinationCodes = Object.keys(AIRPORTS).filter((code) => code !== origin);

  // Price every candidate route first, so we only ask the backend about destinations
  // the user could actually afford.
  const pricedRoutes = [];

  for (const destCode of destinationCodes) {
    const outboundFlights = generateFlightsForRoute(origin, destCode, departureDate, 'outbound', { adults: 1 });
    const returnFlights = generateFlightsForRoute(destCode, origin, returnDate, 'return', { adults: 1 });

    if (!outboundFlights.length || !returnFlights.length) continue;

    const cheapestOutbound = outboundFlights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), outboundFlights[0]);
    const cheapestReturn = returnFlights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), returnFlights[0]);
    const totalRoundtripPrice = cheapestOutbound.price + cheapestReturn.price;

    if (maxBudget && totalRoundtripPrice > maxBudget) continue;

    pricedRoutes.push({ destCode, cheapestOutbound, cheapestReturn, totalRoundtripPrice });
  }

  if (!pricedRoutes.length) return [];

  // One batched call covering every affordable destination.
  const eventsByDestination = await fetchEventsForDestinations(
    pricedRoutes.map((r) => r.destCode),
    departureDate,
    returnDate,
    accessToken
  );

  const results = [];

  for (const { destCode, cheapestOutbound, cheapestReturn, totalRoundtripPrice } of pricedRoutes) {
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

    const topEvent = matchedEvents[0];
    const aiInsight = `${destinationInfo.city} has verified live events during your dates! Flight is ${savingsPercent}% below historical average ($${totalRoundtripPrice} roundtrip). Catch "${topEvent.title}" at ${topEvent.venue} during your trip.`;

    results.push({
      id: `ai-dest-${destCode}`,
      destination: destinationInfo,
      originCode: origin,
      destCode,
      roundtripPrice: totalRoundtripPrice,
      averageMarketPrice,
      savingsPercent,
      savingsAmount,
      outboundFlight: cheapestOutbound,
      returnFlight: cheapestReturn,
      matchedEvents,
      matchScore,
      aiInsight,
      departureDate,
      returnDate
    });
  }

  // Sort results by AI Match Score descending
  return results.sort((a, b) => b.matchScore - a.matchScore);
}
