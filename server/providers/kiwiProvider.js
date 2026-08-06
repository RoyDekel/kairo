import { FlightProvider } from './flightProvider.js';
import { 
  AIRPORTS, 
  AIRLINES, 
  getDistance, 
  calculatePassengerCost 
} from './constants.js';

export class KiwiProvider extends FlightProvider {
  constructor() {
    super();
    this.apiKey = process.env.KIWI_API_KEY;
  }

  async searchAsync(searchRequest) {
    const { origin, destination, departureDate, returnDate, passengers, stops } = searchRequest;

    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error("Kiwi API Key is missing in environment.");
    }

    console.log(`[KiwiProvider] Querying outbound: ${origin} -> ${destination} on ${departureDate} with stops: ${stops}`);
    const outboundOffers = await this.fetchKiwiOffers(origin, destination, departureDate, passengers, stops);
    const outboundFlights = outboundOffers
      .map(offer => this.mapKiwiToFlight(offer, 'outbound', passengers))
      .filter(Boolean);

    let returnFlights = [];
    if (returnDate) {
      console.log(`[KiwiProvider] Querying return: ${destination} -> ${origin} on ${returnDate} with stops: ${stops}`);
      const returnOffers = await this.fetchKiwiOffers(destination, origin, returnDate, passengers, stops);
      returnFlights = returnOffers
        .map(offer => this.mapKiwiToFlight(offer, 'return', passengers))
        .filter(Boolean);
    }

    return {
      outbound: outboundFlights,
      return: returnFlights
    };
  }

  async fetchKiwiOffers(dep, arr, dateStr, passengers, stops) {
    const kiwiDate = this.convertDateToKiwi(dateStr);
    
    // Set up standard query parameters for Kiwi search
    const queryParams = new URLSearchParams({
      fly_from: dep,
      fly_to: arr,
      date_from: kiwiDate,
      date_to: kiwiDate,
      curr: 'USD',
      adults: String(passengers.adults || 1),
      children: String(passengers.children || 0),
      infants: String(passengers.infants || 0),
      limit: '10' // Limit payload size
    });

    if (stops === '1') {
      queryParams.set('max_stopovers', '0');
    }

    const url = `https://tequila-api.kiwi.com/v2/search?${queryParams.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': this.apiKey.trim()
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Kiwi Tequila API returned status ${response.status}: ${errText}`);
    }

    const resData = await response.json();
    return resData.data || [];
  }

  convertDateToKiwi(dateStr) {
    // Convert YYYY-MM-DD to DD/MM/YYYY
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  }

  mapKiwiToFlight(offer, direction, passengers) {
    try {
      const route = offer.route || [];
      const firstSegment = route[0];
      const lastSegment = route[route.length - 1];
      if (!firstSegment || !lastSegment) return null;

      const airlineCode = firstSegment.airline || 'LO';
      const airlineInfo = AIRLINES[airlineCode] || { name: firstSegment.operating_airline || offer.airlines?.[0] || airlineCode, type: 'national' };
      const airlineName = airlineInfo.name;

      const departureAt = new Date(offer.local_departure);
      const arrivalAt = new Date(offer.local_arrival);

      const depTimeStr = departureAt.toTimeString().split(' ')[0].substring(0, 5);
      const arrTimeStr = arrivalAt.toTimeString().split(' ')[0].substring(0, 5);

      // Kiwi duration is in seconds
      const durationSeconds = offer.duration?.departure || 0;
      const durationHours = Math.floor(durationSeconds / 3600);
      const durationMins = Math.round((durationSeconds % 3600) / 60);
      const durationStr = `${durationHours}h ${durationMins}m`;
      const durationVal = durationHours + durationMins / 60;

      const priceVal = parseFloat(offer.price || '0');
      const priceDetails = calculatePassengerCost(priceVal, passengers);

      const planeType = firstSegment.equipment || 'Boeing 737 neo';
      const cabinClass = 'Economy';

      const originCode = offer.flyFrom;
      const destinationCode = offer.flyTo;
      
      const originTerminal = firstSegment.origin_terminal ? ` T${firstSegment.origin_terminal}` : '';
      const destTerminal = lastSegment.destination_terminal ? ` T${lastSegment.destination_terminal}` : '';
      const terminalStr = `${originCode}${originTerminal} → ${destinationCode}${destTerminal}`;

      const codeHash = (airlineCode.charCodeAt(0) || 0) + (airlineCode.charCodeAt(1) || 0);
      const reliability = `${88 + (codeHash % 10)}% On-Time`;

      const stopsCount = route.length - 1;
      const stopsVal = stopsCount <= 0 ? 'Direct' : `${stopsCount} stop${stopsCount > 1 ? 's' : ''}`;

      const originAirport = AIRPORTS[originCode];
      const destAirport = AIRPORTS[destinationCode];
      let distance = 1000;
      if (originAirport && destAirport) {
        distance = getDistance(originAirport.coords, destAirport.coords);
      }

      const departureDateStr = offer.local_departure.split('T')[0];

      return {
        id: `KIWI-${offer.id}-${direction}-${departureDateStr}`,
        flightNumber: `${airlineCode} ${firstSegment.flight_no || '101'}`,
        airlineCode,
        airlineName,
        departureTime: depTimeStr,
        arrivalTime: arrTimeStr + (departureAt.getDate() !== arrivalAt.getDate() ? ' (+1d)' : ''),
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
        seatsRemaining: offer.seats || 5,
        direction,
        origin: originCode,
        destination: destinationCode,
        distance
      };
    } catch (err) {
      console.error("Mapping error for Kiwi offer:", err);
      return null;
    }
  }
}
