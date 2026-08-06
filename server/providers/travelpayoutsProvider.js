import { FlightProvider } from './flightProvider.js';
import { 
  AIRPORTS, 
  getDistance, 
  generateFlightsWithBasePrice 
} from './constants.js';

export class TravelPayoutsProvider extends FlightProvider {
  constructor() {
    super();
    this.token = process.env.TRAVELPAYOUTS_TOKEN;
  }

  async searchAsync(searchRequest) {
    const { origin, destination, departureDate, returnDate, passengers } = searchRequest;

    if (!this.token || this.token.trim() === '') {
      throw new Error("TravelPayouts API token is missing in environment.");
    }

    // Geodesic distance baseline calculation as fallback
    const originAirport = AIRPORTS[origin];
    const destinationAirport = AIRPORTS[destination];
    const distance = (originAirport && destinationAirport) 
      ? getDistance(originAirport.coords, destinationAirport.coords) 
      : 1000;
    const fallbackBasePrice = Math.round(40 + distance * 0.075);

    // 1. Fetch Outbound base price
    console.log(`[TravelPayoutsProvider] Querying outbound: ${origin} -> ${destination} on ${departureDate}`);
    const outboundBase = await this.getTravelPayoutsBasePrice(origin, destination, departureDate);
    const finalOutboundBase = outboundBase || fallbackBasePrice;
    const outboundFlights = generateFlightsWithBasePrice(origin, destination, departureDate, 'outbound', passengers, finalOutboundBase);

    // 2. Fetch Return base price
    let returnFlights = [];
    if (returnDate) {
      console.log(`[TravelPayoutsProvider] Querying return: ${destination} -> ${origin} on ${returnDate}`);
      const returnBase = await this.getTravelPayoutsBasePrice(destination, origin, returnDate);
      const finalReturnBase = returnBase || fallbackBasePrice;
      returnFlights = generateFlightsWithBasePrice(destination, origin, returnDate, 'return', passengers, finalReturnBase);
    }

    return {
      outbound: outboundFlights,
      return: returnFlights
    };
  }

  async getTravelPayoutsBasePrice(dep, arr, date) {
    try {
      const monthStart = date.substring(0, 7) + '-01'; // Extract YYYY-MM-01 for period search
      const url = `https://api.travelpayouts.com/v2/prices/latest?origin=${dep}&destination=${arr}&currency=usd&period_type=month&beginning_of_period=${monthStart}&limit=30`;
      
      console.log(`[TravelPayoutsProvider Query] URL: ${url}`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Access-Token': this.token.trim(),
          'Accept-Encoding': 'gzip'
        }
      });

      if (!response.ok) {
        throw new Error(`TravelPayouts API responded with status ${response.status}`);
      }

      const resData = await response.json();
      const records = resData.data || [];
      
      if (records.length === 0) {
        console.log(`[TravelPayoutsProvider] No cached records found for ${dep} -> ${arr} in ${monthStart.substring(0, 7)}`);
        return null;
      }

      // Try to find a pricing record matching the exact departure date
      const exactMatch = records.find(r => r.depart_date === date);
      if (exactMatch) {
        console.log(`[TravelPayoutsProvider] Exact date match found for ${date}: $${exactMatch.value}`);
        return exactMatch.value;
      }

      // Fall back to sorting by price and getting the cheapest record in that month
      const cheapestRecord = [...records].sort((a, b) => a.value - b.value)[0];
      console.log(`[TravelPayoutsProvider] No exact date match. Using cheapest monthly cached price: $${cheapestRecord.value} (on ${cheapestRecord.depart_date})`);
      return cheapestRecord.value;
    } catch (err) {
      console.error("[TravelPayoutsProvider] Error querying API, falling back:", err.message || err);
      return null;
    }
  }
}
