import { describe, test, expect } from 'vitest';
import { TicketmasterService } from '../../../server/services/ticketmasterService.js';
import { computeEventDrivenInsights } from '../../../server/services/insightsEngine.js';

describe('Ticketmaster Event Intelligence Service', () => {
  test('returns fallback events for destination when offline or no API key', async () => {
    const service = new TicketmasterService();
    const events = await service.getEventsForDestination('BCN', '2026-08-10', '2026-08-20');

    expect(events).toBeDefined();
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].destination).toBe('BCN');
    expect(events[0].eventImpactScore).toBeGreaterThanOrEqual(70);
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
