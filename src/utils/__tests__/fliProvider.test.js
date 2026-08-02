import { describe, test, expect, vi, beforeEach } from 'vitest';
import { FliProvider } from '../../../server/providers/fliProvider.js';
import { FlightSearchService } from '../../../server/services/flightSearchService.js';

describe('FliProvider', () => {
  let provider;

  beforeEach(() => {
    provider = new FliProvider();
  });

  test('initializes with correct provider ID and name', () => {
    expect(provider.id).toBe('fli');
    expect(provider.name).toBe('Google Flights (fli)');
  });

  test('maps leg data cleanly to KAIRO flight model contract', () => {
    const leg = {
      airline: 'Air France',
      flightNumber: 'AF-1120',
      departureTime: '10:00',
      arrivalTime: '14:30',
      durationMinutes: 270,
      stops: 0
    };

    const passengers = { adults: 1, children: 0, infants: 0 };
    const flight = provider.mapLegToFlight(leg, 350, 'outbound', 'TLV', 'CDG', 3280, passengers);

    expect(flight).toMatchObject({
      flightNumber: 'AF-1120',
      airlineName: 'Air France',
      departureTime: '10:00',
      arrivalTime: '14:30',
      duration: '4h 30m',
      durationVal: 270,
      price: 350,
      stops: 0,
      direction: 'outbound',
      origin: 'TLV',
      destination: 'CDG',
      distance: 3280
    });
  });

  test('returns empty arrays when bridge returns process error', async () => {
    vi.spyOn(provider, 'runBridge').mockResolvedValue({ error: 'Process execution timeout', flights: [] });

    const results = await provider.searchAsync({
      origin: 'TLV',
      destination: 'CDG',
      departureDate: '2026-09-15'
    });

    expect(results).toEqual({ outbound: [], return: [] });
  });

  test('integrates with FlightSearchService when FLI_ENABLED=true', () => {
    vi.stubEnv('FLI_ENABLED', 'true');
    vi.stubEnv('FLIGHT_PROVIDER', 'fli');

    const service = new FlightSearchService();
    expect(service.providerName).toBe('fli');

    vi.unstubAllEnvs();
  });
});
