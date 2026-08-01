import { describe, test, expect } from 'vitest';
import { 
  getDistance, 
  calculatePassengerCost, 
  generateFlightsForRoute, 
  getFlightTelemetry, 
  getSkyscannerUrl,
  AIRPORTS
} from '../flightSimulator';

describe('flightSimulator logic and math calculations', () => {
  describe('getDistance (Haversine formula)', () => {
    test('calculates correct distance between TLV and KRK hubs', () => {
      const tlv = AIRPORTS.TLV.coords;
      const krk = AIRPORTS.KRK.coords;
      
      const dist = getDistance(tlv, krk);
      
      // Geodesic distance is approximately 2420 - 2460 km
      expect(dist).toBeGreaterThan(2300);
      expect(dist).toBeLessThan(2600);
    });

    test('calculates distance as 0 for identical coordinates', () => {
      const coords = [40.7128, -74.0060]; // JFK area
      expect(getDistance(coords, coords)).toBe(0);
    });
  });

  describe('calculatePassengerCost (Fare structures)', () => {
    test('scales price correctly for 1 adult only', () => {
      const basePrice = 200;
      const costs = calculatePassengerCost(basePrice, { adults: 1, children: 0, infants: 0 });
      
      expect(costs.adults).toBe(200);
      expect(costs.children).toBe(0);
      expect(costs.infants).toBe(0);
      expect(costs.total).toBe(200);
    });

    test('applies child (25%) and infant (90%) discounts correctly', () => {
      const basePrice = 100;
      const costs = calculatePassengerCost(basePrice, { adults: 2, children: 1, infants: 1 });
      
      // Adults: 2 * 100 = 200
      // Children: 1 * 75 = 75 (25% off)
      // Infants: 1 * 10 = 10 (90% off)
      expect(costs.adults).toBe(200);
      expect(costs.children).toBe(75);
      expect(costs.infants).toBe(10);
      expect(costs.total).toBe(285);
    });
  });

  describe('generateFlightsForRoute', () => {
    test('generates exactly 4 flights with valid route info', () => {
      const flights = generateFlightsForRoute('TLV', 'KRK', '2026-08-11', 'outbound', { adults: 1 });
      
      expect(flights).toHaveLength(4);
      flights.forEach(flight => {
        expect(flight.origin).toBe('TLV');
        expect(flight.destination).toBe('KRK');
        expect(flight.direction).toBe('outbound');
        expect(flight.stops).toBe('Direct');
        expect(flight.price).toBeGreaterThan(0);
        expect(flight.passengerCosts.total).toBe(flight.price);
      });
    });

    test('prices flights higher on weekends than weekdays', () => {
      // 2026-08-11 is a Tuesday (Weekday)
      // 2026-08-14 is a Friday (Weekend)
      const weekdayFlights = generateFlightsForRoute('TLV', 'KRK', '2026-08-11', 'outbound', { adults: 1 });
      const weekendFlights = generateFlightsForRoute('TLV', 'KRK', '2026-08-14', 'outbound', { adults: 1 });

      const weekdayBasePrice = weekdayFlights[0].price;
      const weekendBasePrice = weekendFlights[0].price;

      // Weekend factor is 1.2x
      expect(weekendBasePrice).toBeGreaterThan(weekdayBasePrice);
      expect(weekendBasePrice / weekdayBasePrice).toBeCloseTo(1.2, 1);
    });
  });

  describe('getFlightTelemetry (Timeline interpolation)', () => {
    test('returns scheduled status at progress 0', () => {
      const tel = getFlightTelemetry(0, AIRPORTS.TLV.coords, AIRPORTS.KRK.coords);
      
      expect(tel.status).toBe('Scheduled');
      expect(tel.altitude).toBe(0);
      expect(tel.speed).toBe(0);
      expect(tel.progress).toBe(0);
    });

    test('returns boarding status at early active progress (e.g. 0.02)', () => {
      const tel = getFlightTelemetry(0.02, AIRPORTS.TLV.coords, AIRPORTS.KRK.coords);
      
      expect(tel.status).toBe('Boarding');
      expect(tel.altitude).toBe(0);
      expect(tel.speed).toBe(0);
    });

    test('returns takeoff status at early progress (e.g. 0.07)', () => {
      const tel = getFlightTelemetry(0.07, AIRPORTS.TLV.coords, AIRPORTS.KRK.coords);
      
      expect(tel.status).toBe('Takeoff');
      expect(tel.altitude).toBeGreaterThan(0);
      expect(tel.speed).toBeGreaterThan(250);
    });

    test('returns in-flight cruising status at midpoint progress (e.g. 0.5)', () => {
      const tel = getFlightTelemetry(0.5, AIRPORTS.TLV.coords, AIRPORTS.KRK.coords);
      
      expect(tel.status).toBe('In Flight');
      expect(tel.altitude).toBeCloseTo(36000, -3); // ~36000 ft
      expect(tel.speed).toBeGreaterThan(800);
      expect(tel.distanceRemaining).toBeLessThan(tel.distanceCovered + 200);
    });

    test('returns landing status at progress 1.0', () => {
      const tel = getFlightTelemetry(1.0, AIRPORTS.TLV.coords, AIRPORTS.KRK.coords);
      
      expect(tel.status).toBe('Landed');
      expect(tel.altitude).toBe(120);
      expect(tel.speed).toBe(0);
      expect(tel.distanceRemaining).toBe(0);
      expect(tel.timeRemaining).toBe(0);
    });
  });

  describe('getSkyscannerUrl', () => {
    test('formats valid external deep link URL correctly', () => {
      const url = getSkyscannerUrl('TLV', 'KRK', '2026-08-11');
      expect(url).toBe('https://www.skyscanner.com/transport/flights/tlv/krk/260811/');
    });

    test('falls back to homepage on invalid dates', () => {
      expect(getSkyscannerUrl('TLV', 'KRK', '')).toBe('https://www.skyscanner.com');
      expect(getSkyscannerUrl('TLV', 'KRK', 'invalid-date')).toBe('https://www.skyscanner.com');
    });
  });
});
