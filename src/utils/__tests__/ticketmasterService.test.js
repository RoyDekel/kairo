import { describe, test, expect, vi } from 'vitest';
import { TicketmasterService } from '../../../server/services/ticketmasterService.js';
import { computeEventDrivenInsights } from '../../../server/services/insightsEngine.js';

/**
 * Builds a service with an explicit credential state.
 *
 * The suite previously constructed TicketmasterService bare, which reads
 * process.env.TICKETMASTER_API_KEY via dotenv. That made the result depend on the machine:
 * with a key and network it hit the live API (499ms, 10 real events); without, it returned
 * simulated events (25ms). The test asserted only "some events came back", so it passed
 * either way — while being named after the offline path it often wasn't exercising.
 */
const serviceWithKey = (apiKey) => {
  const service = new TicketmasterService();
  service.apiKey = apiKey;
  return service;
};

describe('Ticketmaster Event Intelligence Service', () => {
  test('returns simulated events when no API key is configured', async () => {
    const service = serviceWithKey('');
    const events = await service.getEventsForDestination('BCN', '2026-08-10', '2026-08-20');

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].destination).toBe('BCN');
    expect(events[0].eventImpactScore).toBeGreaterThanOrEqual(70);
    // Never claims to be live data when it isn't.
    expect(events.every((e) => !e.isLiveApi)).toBe(true);
    // No network attempted without a credential.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('falls back to simulated events when the live API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const service = serviceWithKey('test-key');
    const events = await service.getEventsForDestination('BCN', '2026-08-10', '2026-08-20');

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => !e.isLiveApi)).toBe(true);
  });

  test('formats live API results and marks them as live', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'tm-live-1',
              name: 'Primavera Sound',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'Parc del Fòrum' }] },
              dates: { start: { localDate: '2026-08-12' }, status: { code: 'soldout' } },
              priceRanges: [{ min: 85, max: 240 }]
            },
            // Duplicate title must collapse to one entry.
            {
              id: 'tm-live-2',
              name: 'Primavera Sound',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'Parc del Fòrum' }] },
              dates: { start: { localDate: '2026-08-13' } },
              priceRanges: [{ min: 85, max: 240 }]
            }
          ]
        }
      })
    });

    const service = serviceWithKey('test-key');
    const events = await service.getEventsForDestination('BCN', '2026-08-10', '2026-08-20');

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Primavera Sound');
    expect(events[0].venue).toBe('Parc del Fòrum');
    expect(events[0].isLiveApi).toBe(true);
    expect(events[0].isSoldOut).toBe(true);
    expect(events[0].priceEstimate).toBe('$85 - $240');
  });

  test('computes Event-Driven Insights with high impact event surge', () => {
    const mockFlight = { id: 'FL-BCN-101', price: 520, destination: 'BCN' };
    const mockEvents = [
      {
        id: 'tm-bcn-1',
        destination: 'BCN',
        title: 'El Clásico Match',
        venue: 'Camp Nou',
        categoryLabel: 'Sports ⚽',
        eventImpactScore: 96,
        isSoldOut: true
      }
    ];

    const insights = computeEventDrivenInsights(mockFlight, { departureDate: '2026-08-15' }, mockEvents);

    expect(insights).toBeDefined();
    expect(insights.recommendation).toBe('BUY_NOW');
    expect(insights.isHighImpactEvent).toBe(true);
    expect(insights.eventImpactScore).toBe(96);
    expect(insights.summary).toContain('El Clásico Match');
  });

  test('recommends WAIT when no event conflict and price is above low 90-day benchmark', () => {
    const mockFlight = { id: 'FL-LHR-202', price: 650, destination: 'LHR' };
    const mockEvents = [
      {
        id: 'tm-lhr-1',
        destination: 'LHR',
        title: 'Small Theater Play',
        venue: 'West End Theater',
        categoryLabel: 'Culture 🎭',
        eventImpactScore: 60,
        isSoldOut: false
      }
    ];

    const insights = computeEventDrivenInsights(mockFlight, { departureDate: '2026-09-20' }, mockEvents);

    expect(insights).toBeDefined();
    expect(insights.recommendation).toBe('WAIT');
    expect(insights.isHighImpactEvent).toBe(false);
  });
});
