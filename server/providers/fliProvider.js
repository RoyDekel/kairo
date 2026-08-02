import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlightProvider } from './flightProvider.js';
import {
  AIRPORTS,
  getDistance,
  calculatePassengerCost
} from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_PATH = path.join(__dirname, 'fliBridge.py');

/** Bounded execution timeout for Python fli bridge (15s). */
const EXEC_TIMEOUT_MS = 15000;

export class FliProvider extends FlightProvider {
  constructor() {
    super();
    this.id = 'fli';
    this.name = 'Google Flights (fli)';
  }

  async searchAsync(searchRequest) {
    const {
      origin,
      destination,
      departureDate,
      returnDate,
      passengers = { adults: 1, children: 0, infants: 0 },
      currency = 'USD'
    } = searchRequest;

    const payload = JSON.stringify({
      origin: String(origin).toUpperCase(),
      destination: String(destination).toUpperCase(),
      departureDate,
      returnDate: returnDate || null,
      currency
    });

    try {
      const output = await this.runBridge(payload);
      if (!output || output.error) {
        if (output?.error) {
          console.warn(`[FliProvider] Bridge returned error for ${origin}->${destination}: ${output.error}`);
        }
        return { outbound: [], return: [] };
      }

      const rawFlights = output.flights || [];
      const outboundFlights = [];
      const returnFlights = [];

      const dist = getDistance(origin, destination);

      for (const flightData of rawFlights) {
        if (flightData.outbound) {
          const mappedOutbound = this.mapLegToFlight(
            flightData.outbound,
            flightData.price,
            'outbound',
            origin,
            destination,
            dist,
            passengers
          );
          if (mappedOutbound) outboundFlights.push(mappedOutbound);
        }

        if (flightData.return) {
          const mappedReturn = this.mapLegToFlight(
            flightData.return,
            0, // Return leg price covered in roundtrip total
            'return',
            destination,
            origin,
            dist,
            passengers
          );
          if (mappedReturn) returnFlights.push(mappedReturn);
        }
      }

      return {
        outbound: outboundFlights,
        return: returnFlights
      };
    } catch (err) {
      console.warn(`[FliProvider] Process execution failed for ${origin}->${destination}: ${err.message}`);
      return { outbound: [], return: [] };
    }
  }

  runBridge(payload) {
    return new Promise((resolve) => {
      execFile(
        'python',
        [BRIDGE_PATH, payload],
        { timeout: EXEC_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            resolve({ error: error.message, flights: [] });
            return;
          }
          try {
            const data = JSON.parse(stdout.trim());
            resolve(data);
          } catch (jsonErr) {
            resolve({ error: `JSON parse error: ${jsonErr.message}`, flights: [] });
          }
        }
      );
    });
  }

  mapLegToFlight(leg, totalPrice, direction, origin, destination, distance, passengers) {
    if (!leg) return null;

    const basePrice = totalPrice > 0 ? totalPrice : 200;
    const passengerCosts = calculatePassengerCost(basePrice, passengers);

    return {
      id: `fli-${direction}-${origin}-${destination}-${leg.flightNumber || '100'}-${Date.now()}`,
      flightNumber: leg.flightNumber || 'GF-100',
      airlineCode: leg.airlineCode || 'GF',
      airlineName: leg.airline || 'Google Flights',
      departureTime: leg.departureTime || '08:00',
      arrivalTime: leg.arrivalTime || '11:00',
      duration: leg.durationMinutes ? `${Math.floor(leg.durationMinutes / 60)}h ${leg.durationMinutes % 60}m` : '3h 0m',
      durationVal: leg.durationMinutes || 180,
      price: passengerCosts.total,
      passengerCosts,
      cabinClass: 'ECONOMY',
      stops: leg.stops || 0,
      planeType: 'Boeing 737-800',
      terminal: '1',
      baggage: { cabin: '1x 8kg', checked: '1x 23kg' },
      reliability: 95,
      seatsRemaining: 7,
      direction,
      origin: String(origin).toUpperCase(),
      destination: String(destination).toUpperCase(),
      distance
    };
  }
}
