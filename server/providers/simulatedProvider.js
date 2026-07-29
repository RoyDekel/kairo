import { FlightProvider } from './flightProvider.js';
import {
  AIRPORTS,
  AIRLINES,
  getDistance,
  formatDuration,
  calculatePassengerCost,
  getCarriersForDistance,
  getBaseAdultPrice
} from './constants.js';

export class SimulatedProvider extends FlightProvider {
  async searchAsync(searchRequest) {
    const { origin, destination, departureDate, returnDate, passengers } = searchRequest;

    console.log(`[SimulatedProvider] Generating flights for route: ${origin} -> ${destination}`);
    const outboundFlights = this.generateFlightsForRoute(origin, destination, departureDate, 'outbound', passengers);
    
    let returnFlights = [];
    if (returnDate) {
      console.log(`[SimulatedProvider] Generating flights for route: ${destination} -> ${origin}`);
      returnFlights = this.generateFlightsForRoute(destination, origin, returnDate, 'return', passengers);
    }

    return {
      outbound: outboundFlights,
      return: returnFlights
    };
  }

  generateFlightsForRoute(originCode, destinationCode, dateStr, direction, passengers) {
    const origin = AIRPORTS[originCode];
    const destination = AIRPORTS[destinationCode];
    
    if (!origin || !destination) return [];
    
    // Fare model lives in shared/catalog.js so the client fallback simulator agrees.
    const basePrice = getBaseAdultPrice(getDistance(origin.coords, destination.coords), dateStr);

    return this.generateFlightsWithBasePrice(originCode, destinationCode, dateStr, direction, passengers, basePrice);
  }

  generateFlightsWithBasePrice(originCode, destinationCode, dateStr, direction, passengers, basePrice) {
    const origin = AIRPORTS[originCode];
    const destination = AIRPORTS[destinationCode];
    if (!origin || !destination) return [];
    
    const distance = getDistance(origin.coords, destination.coords);
    const durationHours = (distance / 760) + 0.5;
    const durationStr = formatDuration(durationHours);
    
    const availableCarriers = getCarriersForDistance(distance)
      .map(code => AIRLINES[code] || AIRLINES.LO)
      .slice(0, 4);
      
    const departures = ['06:20', '11:45', '16:10', '21:30'];
    const aircraftModels = [
      distance > 4000 ? 'Boeing 777-300ER' : 'Boeing 737 MAX 8',
      distance > 4000 ? 'Airbus A350-900' : 'Airbus A321neo',
      distance > 4000 ? 'Boeing 787-9 Dreamliner' : 'Boeing 737-800',
      distance > 4000 ? 'Airbus A330-900neo' : 'Boeing 737-900ER'
    ];

    return availableCarriers.map((airline, idx) => {
      const tierMultiplier = airline.type === 'lowcost' ? 0.85 : 1.15;
      const timeMultiplier = idx === 0 ? 0.95 : idx === 2 ? 1.05 : 1.0;
      const adultPrice = Math.round(basePrice * tierMultiplier * timeMultiplier);
      const priceDetails = calculatePassengerCost(adultPrice, passengers);
      
      const [depHours, depMins] = departures[idx].split(':').map(Number);
      let arrHours = Math.floor(depHours + durationHours);
      let arrMins = Math.round(depMins + (durationHours - Math.floor(durationHours)) * 60);
      if (arrMins >= 60) {
        arrHours += 1;
        arrMins -= 60;
      }
      const nextDay = arrHours >= 24;
      arrHours = arrHours % 24;
      
      const formattedArrival = `${String(arrHours).padStart(2, '0')}:${String(arrMins).padStart(2, '0')}`;
      const baggageDesc = airline.type === 'lowcost' 
        ? '1 small personal bag (underseat) included. Carry-on costs extra.' 
        : '1 carry-on (8kg) + 1 checked bag (23kg) included.';

      return {
        id: `SIMULATED-${airline.code}-${idx + 100}-${direction}-${dateStr}`,
        flightNumber: `${airline.code} ${idx + 101 + (direction === 'return' ? 10 : 0)}`,
        airlineCode: airline.code,
        airlineName: airline.name,
        departureTime: departures[idx],
        arrivalTime: formattedArrival + (nextDay ? ' (+1d)' : ''),
        duration: durationStr,
        durationVal: durationHours,
        price: adultPrice,
        passengerCosts: priceDetails,
        cabinClass: airline.type === 'lowcost' ? 'Economy' : 'Economy Standard',
        stops: 'Direct',
        planeType: aircraftModels[idx],
        terminal: `${originCode} T${idx === 2 ? '1' : '3'} → ${destinationCode} T1`,
        baggage: baggageDesc,
        reliability: `${90 + (idx % 3) * 3}% On-Time`,
        seatsRemaining: Math.floor(2 + (airline.code.charCodeAt(0) % 8)),
        direction,
        origin: originCode,
        destination: destinationCode,
        distance
      };
    });
  }
}
