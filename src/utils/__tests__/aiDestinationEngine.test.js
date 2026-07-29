import { describe, test, expect, vi } from 'vitest';
import { searchAIDestinations, fetchTicketmasterEventsForDestination } from '../aiDestinationEngine';

describe('AI Destination Intelligence Engine', () => {
  test('returns empty array when Ticketmaster API returns 0 events for date range', async () => {
    // Mock global fetch to return 0 embedded events
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ _embedded: { events: [] } })
    });

    const results = await searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 1500,
      interests: ['music', 'sports']
    });

    // Per strict user directive: 0 fake events means 0 destinations returned (Empty State)
    expect(results).toEqual([]);

    global.fetch = origFetch;
  });

  test('correctly formats and ranks destinations when Ticketmaster returns real events', async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'tm-real-1',
              name: 'Live Festival',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'Arena' }] },
              dates: { start: { localDate: '2026-08-12' } },
              priceRanges: [{ min: 50, max: 150 }]
            }
          ]
        }
      })
    });

    const results = await searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 1500,
      interests: ['music']
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('matchScore');
    expect(results[0]).toHaveProperty('aiInsight');
    expect(results[0].matchedEvents[0].title).toBe('Live Festival');

    global.fetch = origFetch;
  });
});
