/**
 * @vitest-environment node
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { FareCollector, startFareCollector } from '../../../server/jobs/fareCollector.js';

describe('FareCollector — scheduled sampling of fares', () => {
  let mockService;
  let mockFareHistory;
  let collector;

  beforeEach(() => {
    mockService = {
      providerName: 'fli',
      searchFlights: vi.fn().mockResolvedValue({
        providerUsed: 'fli',
        currency: 'USD',
        outbound: [{ price: 200 }],
        return: [{ price: 250 }]
      })
    };

    mockFareHistory = {
      record: vi.fn().mockResolvedValue(true)
    };

    collector = new FareCollector({
      service: mockService,
      fareHistory: mockFareHistory,
      airports: { TLV: { code: 'TLV' }, BCN: { code: 'BCN' }, CDG: { code: 'CDG' } },
      now: () => new Date('2026-08-10T00:00:00Z')
    });
  });

  test('initializes with default home airports, horizons, and delay', () => {
    expect(collector.homeAirports).toEqual(['TLV']);
    expect(collector.horizons).toEqual([14, 30, 60, 90]);
    expect(collector.delayMs).toBe(2000);
  });

  test('sampleOne queries service and records cheapest roundtrip fare truthful to provider', async () => {
    const success = await collector.sampleOne('TLV', 'BCN', 14);

    expect(success).toBe(true);
    expect(mockService.searchFlights).toHaveBeenCalledWith({
      origin: 'TLV',
      destination: 'BCN',
      departureDate: '2026-08-24',
      returnDate: '2026-08-31',
      passengers: { adults: 1, children: 0, infants: 0 },
      stops: '0',
      travelClass: '1'
    });

    expect(mockFareHistory.record).toHaveBeenCalledWith({
      origin: 'TLV',
      destination: 'BCN',
      departureDate: '2026-08-24',
      returnDate: '2026-08-31',
      roundtripPrice: 450,
      provider: 'fli',
      currency: 'USD',
      collectedBy: 'collector'
    });
  });

  test('sampleOne does not record when outbound or return flights are missing', async () => {
    mockService.searchFlights.mockResolvedValueOnce({
      providerUsed: 'fli',
      currency: 'USD',
      outbound: [],
      return: [{ price: 250 }]
    });

    const success = await collector.sampleOne('TLV', 'BCN', 14);

    expect(success).toBe(false);
    expect(mockFareHistory.record).not.toHaveBeenCalled();
  });

  test('sampleOne passes providerUsed from results (truthful provider reporting)', async () => {
    mockService.searchFlights.mockResolvedValueOnce({
      providerUsed: 'simulated',
      currency: 'USD',
      outbound: [{ price: 100 }],
      return: [{ price: 150 }]
    });

    await collector.sampleOne('TLV', 'BCN', 30);

    expect(mockFareHistory.record).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'simulated'
      })
    );
  });

  test('startFareCollector returns null when COLLECTOR_ENABLED is not true', () => {
    vi.stubEnv('COLLECTOR_ENABLED', 'false');

    const cronJob = startFareCollector(collector);
    expect(cronJob).toBeNull();

    vi.unstubAllEnvs();
  });

  test('startFareCollector schedules cron job when COLLECTOR_ENABLED=true', () => {
    vi.stubEnv('COLLECTOR_ENABLED', 'true');

    const cronJob = startFareCollector(collector);
    expect(cronJob).not.toBeNull();
    cronJob.stop();

    vi.unstubAllEnvs();
  });
});
