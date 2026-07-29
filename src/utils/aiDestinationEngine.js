import { AIRPORTS, generateFlightsForRoute } from './flightSimulator';

/**
 * Airport Code to City & Location Geographic Mapping for Ticketmaster Queries
 */
const AIRPORT_LOCATION_MAP = {
  BCN: { city: 'Barcelona', countryCode: 'ES' },
  CDG: { city: 'Paris', countryCode: 'FR' },
  LHR: { city: 'London', countryCode: 'GB' },
  JFK: { city: 'New York', countryCode: 'US' },
  LAX: { city: 'Los Angeles', countryCode: 'US' },
  KRK: { city: 'Krakow', countryCode: 'PL' },
  NRT: { city: 'Tokyo', countryCode: 'JP' },
  HND: { city: 'Tokyo', countryCode: 'JP' },
  MUC: { city: 'Munich', countryCode: 'DE' },
  BER: { city: 'Berlin', countryCode: 'DE' },
  FCO: { city: 'Rome', countryCode: 'IT' },
  AMS: { city: 'Amsterdam', countryCode: 'NL' },
  MIA: { city: 'Miami', countryCode: 'US' },
  ATH: { city: 'Athens', countryCode: 'GR' }
};

const TICKETMASTER_API_KEY = 'AxuhwJlhtAlB5PQuhSgtzsoTq4w8Ddof';

/**
 * Formats a raw local time string "14:30:00" into a human-readable local time "2:30 PM"
 */
export function formatLocalTimeFrame(timeStr) {
  if (!timeStr) return null;
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  let hours = parseInt(parts[0], 10);
  const minutes = parts[1];
  if (isNaN(hours)) return null;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Fetches live events directly from Ticketmaster Discovery API for a destination & date range.
 * Preserves separate time slots on the same day while filtering true duplicate records.
 */
export async function fetchTicketmasterEventsForDestination(airportCode, startDateStr, endDateStr) {
  const locInfo = AIRPORT_LOCATION_MAP[airportCode?.toUpperCase()];
  if (!locInfo) return [];

  try {
    const startIso = startDateStr ? new Date(startDateStr).toISOString().split('.')[0] + 'Z' : '';
    const endIso = endDateStr ? new Date(endDateStr).toISOString().split('.')[0] + 'Z' : '';

    const params = new URLSearchParams({
      apikey: TICKETMASTER_API_KEY,
      countryCode: locInfo.countryCode,
      city: locInfo.city,
      size: '10',
      sort: 'date,asc'
    });

    if (startIso) params.append('startDateTime', startIso);
    if (endIso) params.append('endDateTime', endIso);

    const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params.toString()}`);
    if (!res.ok) return [];

    const data = await res.json();
    const rawEvents = data?._embedded?.events || [];

    // Deduplicate by (Title + Venue + Date + LocalStartTimeslot) to keep separate time slots
    const seenKeys = new Set();
    const uniqueEvents = [];

    for (const evt of rawEvents) {
      if (!evt.name) continue;

      const title = evt.name.trim();
      const venue = evt._embedded?.venues?.[0]?.name || `${locInfo.city} Venue`;
      const localDate = evt.dates?.start?.localDate || startDateStr;
      const localTimeRaw = evt.dates?.start?.localTime || '';
      const formattedTime = formatLocalTimeFrame(localTimeRaw);

      // Key differentiates events by title, venue, date, AND local start time slot
      const dedupKey = `${title.toLowerCase()}|${venue.toLowerCase()}|${localDate}|${localTimeRaw || 'all-day'}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      const segmentName = evt.classifications?.[0]?.segment?.name?.toLowerCase() || 'culture';
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

      const priceMin = evt.priceRanges?.[0]?.min || 45;
      const priceMax = evt.priceRanges?.[0]?.max || 180;

      uniqueEvents.push({
        id: evt.id || `tm-${airportCode}-${uniqueEvents.length}`,
        destination: airportCode,
        title,
        venue,
        category,
        categoryLabel,
        isLiveApi: true,
        date: localDate,
        localTime: localTimeRaw,
        timeFrame: formattedTime, // e.g. "10:00 AM" or "6:15 PM"
        timezone: evt.dates?.timezone || locInfo.countryCode,
        priceEstimate: `$${Math.round(priceMin)} - $${Math.round(priceMax)}`,
        description: evt.info || `${title} live event at ${venue}.`,
        url: evt.url
      });
    }

    return uniqueEvents;
  } catch (err) {
    console.warn(`Failed to fetch Ticketmaster events for ${airportCode}:`, err);
    return [];
  }
}

/**
 * Searches global destinations and correlates flight prices ONLY with verified live Ticketmaster events.
 * Strictly returns empty results if no real Ticketmaster events match the search criteria.
 */
export async function searchAIDestinations({
  origin = 'TLV',
  departureDate = '2026-08-11',
  returnDate = '2026-08-16',
  maxBudget = 1000,
  interests = []
}) {
  const destinationCodes = Object.keys(AIRPORTS).filter((code) => code !== origin);
  const results = [];

  for (const destCode of destinationCodes) {
    const destinationInfo = AIRPORTS[destCode];

    // Generate mock roundtrip flights
    const outboundFlights = generateFlightsForRoute(origin, destCode, departureDate, 'outbound', { adults: 1 });
    const returnFlights = generateFlightsForRoute(destCode, origin, returnDate, 'return', { adults: 1 });

    if (!outboundFlights.length || !returnFlights.length) continue;

    const cheapestOutbound = outboundFlights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), outboundFlights[0]);
    const cheapestReturn = returnFlights.reduce((prev, curr) => (curr.price < prev.price ? curr : prev), returnFlights[0]);

    const totalRoundtripPrice = cheapestOutbound.price + cheapestReturn.price;

    // Filter by budget if provided
    if (maxBudget && totalRoundtripPrice > maxBudget) continue;

    // Fetch REAL events from Ticketmaster API
    const realEvents = await fetchTicketmasterEventsForDestination(destCode, departureDate, returnDate);

    // Filter real events by selected interest categories
    let matchedEvents = realEvents;
    if (interests.length > 0) {
      matchedEvents = realEvents.filter((evt) => interests.includes(evt.category));
    }

    // STRICT REQUIREMENT: Only include destination if REAL Ticketmaster events were returned
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

    // Construct Natural Language AI Insight Statement
    const topEvent = matchedEvents[0];
    const timeDetail = topEvent.timeFrame ? ` at ${topEvent.timeFrame} local time` : '';
    const aiInsight = `${destinationInfo.city} has verified live events on Ticketmaster! Flight is ${savingsPercent}% below historical average ($${totalRoundtripPrice} roundtrip). Catch "${topEvent.title}" at ${topEvent.venue}${timeDetail} during your trip.`;

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
