import { FlightProvider } from './flightProvider.js';
import {
  AIRPORTS,
  getDistance,
  calculatePassengerCost
} from './constants.js';

/**
 * How long to let a single SerpApi Google Flights request run before giving up.
 *
 * The fetch below had no timeout at all, so a slow (or hung) request would hold the
 * connection open indefinitely — the frontend gives up after its own timeout, but the
 * backend kept the search running to nowhere, tying up a connection until Node or Render
 * itself finally cut it off. Google Flights is scraped live by SerpApi on an uncached
 * query, and that can take a long time; this is generous specifically so a real search
 * has a fair chance to finish, while still guaranteeing FlightSearchService's fallback to
 * simulated results fires within a bounded time instead of never.
 */
const REQUEST_TIMEOUT_MS = 45000;

export class SerpApiProvider extends FlightProvider {
  constructor() {
    super();
    this.apiKey = process.env.SERPAPI_KEY;
  }

  async searchAsync(searchRequest) {
    const { origin, destination, departureDate, returnDate, passengers, stops, travelClass } = searchRequest;

    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error("SerpAPI key is missing in environment.");
    }

    console.log(`[SerpApiProvider] Querying ${origin} -> ${destination} on ${departureDate}${returnDate ? ' (return ' + returnDate + ')' : ''} (stops: ${stops}, travel_class: ${travelClass || 'ALL'})`);

    const [outboundOffers, returnOffers] = await Promise.all([
      this.fetchSerpApiOffers(origin, destination, departureDate, stops, travelClass),
      returnDate
        ? this.fetchSerpApiOffers(destination, origin, returnDate, stops, travelClass)
        : Promise.resolve([])
    ]);

    const outboundFlights = outboundOffers
      .map(offer => this.mapSerpApiToFlight(offer, 'outbound', passengers, travelClass))
      .filter(Boolean);

    const returnFlights = returnOffers
      .map(offer => this.mapSerpApiToFlight(offer, 'return', passengers, travelClass))
      .filter(Boolean);

    return {
      outbound: outboundFlights,
      return: returnFlights
    };
  }

  async fetchSerpApiOffers(dep, arr, dateStr, stops, travelClass = 'ALL') {
    const params = {
      engine: 'google_flights',
      departure_id: dep,
      arrival_id: arr,
      outbound_date: dateStr,
      type: '2', // Explicitly specify One-way flight
      currency: 'USD',
      hl: 'en',
      api_key: this.apiKey.trim()
    };

    if (travelClass && travelClass !== 'ALL' && travelClass !== '0') {
      params.travel_class = travelClass;
    }

    if (stops && stops !== '0') {
      params.stops = stops;
    }

    const queryParams = new URLSearchParams(params);

    const url = `https://serpapi.com/search.json?${queryParams.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`SerpAPI request timed out after ${REQUEST_TIMEOUT_MS}ms for ${dep} -> ${arr} on ${dateStr}`, { cause: err });
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`SerpAPI returned status ${response.status}: ${errText}`);
    }

    const resData = await response.json();

    // Combine best flights and other flights list
    const bestFlights = resData.best_flights || [];
    const otherFlights = resData.other_flights || [];
    return [...bestFlights, ...otherFlights];
  }

  mapSerpApiToFlight(offer, direction, passengers, requestedTravelClass = 'ALL') {
    try {
      const segments = offer.flights || [];
      const firstSegment = segments[0];
      const lastSegment = segments[segments.length - 1];
      if (!firstSegment || !lastSegment) return null;

      const airlineName = firstSegment.airline || 'LOT Polish Airlines';

      // Determine airline code and flight number
      const flightNum = firstSegment.flight_number || 'LO 101';
      const airlineCode = flightNum.split(' ')[0] || 'LO';

      // Parse date-time and format as HH:MM
      const getHourMinute = (timeStr) => {
        if (!timeStr) return '12:00';
        const parts = timeStr.split(' ');
        return parts[1] || '12:00';
      };

      const depTimeStr = getHourMinute(firstSegment.departure_airport?.time);
      const arrTimeStr = getHourMinute(lastSegment.arrival_airport?.time);

      // Duration is returned in minutes
      const durationMins = offer.total_duration || 120;
      const durationHours = Math.floor(durationMins / 60);
      const durationRemMins = durationMins % 60;
      const durationStr = `${durationHours}h ${durationRemMins}m`;
      const durationVal = durationHours + durationRemMins / 60;

      const priceVal = parseFloat(offer.price || '0');
      const priceDetails = calculatePassengerCost(priceVal, passengers);

      const planeType = firstSegment.airplane || 'Boeing 737 neo';
      
      const rawCabin = firstSegment.travel_class || offer.travel_class;
      let cabinClass = 'Economy';
      if (rawCabin) {
        const cabinStr = String(rawCabin).trim().toLowerCase();
        if (cabinStr === '2' || cabinStr.includes('premium')) {
          cabinClass = 'Premium Economy';
        } else if (cabinStr === '3' || cabinStr.includes('business')) {
          cabinClass = 'Business';
        } else if (cabinStr === '4' || cabinStr.includes('first')) {
          cabinClass = 'First';
        } else {
          cabinClass = 'Economy';
        }
      } else if (requestedTravelClass && requestedTravelClass !== 'ALL') {
        const reqStr = String(requestedTravelClass).trim().toLowerCase();
        if (reqStr === '2' || reqStr.includes('premium')) cabinClass = 'Premium Economy';
        else if (reqStr === '3' || reqStr.includes('business')) cabinClass = 'Business';
        else if (reqStr === '4' || reqStr.includes('first')) cabinClass = 'First';
      }

      const originCode = firstSegment.departure_airport?.id || depTimeStr;
      const destinationCode = lastSegment.arrival_airport?.id || arrTimeStr;

      const originTerminal = firstSegment.departure_airport?.terminal ? ` T${firstSegment.departure_airport.terminal}` : '';
      const destTerminal = lastSegment.arrival_airport?.terminal ? ` T${lastSegment.arrival_airport.terminal}` : '';
      const terminalStr = `${originCode}${originTerminal} → ${destinationCode}${destTerminal}`;

      const codeHash = (airlineCode.charCodeAt(0) || 0) + (airlineCode.charCodeAt(1) || 0);
      const reliability = `${88 + (codeHash % 10)}% On-Time`;

      const stopsCount = segments.length - 1;
      const stopsVal = stopsCount <= 0 ? 'Direct' : `${stopsCount} stop${stopsCount > 1 ? 's' : ''}`;

      const originAirport = AIRPORTS[originCode];
      const destAirport = AIRPORTS[destinationCode];
      let distance = 1000;
      if (originAirport && destAirport) {
        distance = getDistance(originAirport.coords, destAirport.coords);
      }

      const departureDateStr = firstSegment.departure_airport?.time?.split(' ')?.[0] || '2026-08-11';

      return {
        id: `SERPAPI-${offer.id || Math.random().toString(36).substring(7)}-${direction}-${departureDateStr}`,
        flightNumber: flightNum,
        airlineCode,
        airlineName,
        airlineLogo: firstSegment?.airline_logo || '',
        departureTime: depTimeStr,
        arrivalTime: arrTimeStr,
        duration: durationStr,
        durationVal,
        price: Math.round(priceVal),
        passengerCosts: priceDetails,
        cabinClass: cabinClass,
        stops: stopsVal,
        planeType,
        terminal: terminalStr,
        baggage: '1 carry-on (8kg) + 1 checked bag (23kg) included.',
        reliability,
        seatsRemaining: 5,
        direction,
        origin: originCode,
        destination: destinationCode,
        distance
      };
    } catch (err) {
      console.error("Mapping error for SerpApi offer:", err);
      return null;
    }
  }
}
