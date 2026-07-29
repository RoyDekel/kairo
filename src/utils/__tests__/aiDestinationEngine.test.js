import { describe, test, expect, vi } from 'vitest';
import { searchAIDestinations } from '../aiDestinationEngine';

describe('AI Destination Intelligence Engine', () => {
  test('returns empty array when Ticketmaster API returns 0 events for date range', async () => {
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

    expect(results).toEqual([]);

    global.fetch = origFetch;
  });

  test('strictly enforces 1 unique result per event title and omits descriptions/times', async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'tm-1',
              name: 'Van Gogh & Vincent',
              classifications: [{ segment: { name: 'Arts' } }],
              _embedded: { venues: [{ name: 'Bracka 13' }] },
              dates: { start: { localDate: '2026-08-12', localTime: '10:00:00' } },
              priceRanges: [{ min: 45, max: 180 }]
            },
            // Same event title with different time -> Should be deduplicated to 1 UNIQUE EVENT
            {
              id: 'tm-2',
              name: 'Van Gogh & Vincent',
              classifications: [{ segment: { name: 'Arts' } }],
              _embedded: { venues: [{ name: 'Bracka 13' }] },
              dates: { start: { localDate: '2026-08-12', localTime: '14:30:00' } },
              priceRanges: [{ min: 45, max: 180 }]
            },
            // Different event title -> Kept
            {
              id: 'tm-3',
              name: 'Muzeum Banksy',
              classifications: [{ segment: { name: 'Arts' } }],
              _embedded: { venues: [{ name: 'Muzeum Banksy' }] },
              dates: { start: { localDate: '2026-08-13' } },
              priceRanges: [{ min: 45, max: 180 }]
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
      interests: ['culture', 'festivals']
    });

    expect(results.length).toBeGreaterThan(0);
    const events = results[0].matchedEvents;

    // Only 2 unique events returned ("Van Gogh & Vincent" and "Muzeum Banksy")
    expect(events.length).toBe(2);
    expect(events[0].title).toBe('Van Gogh & Vincent');
    expect(events[1].title).toBe('Muzeum Banksy');

    // Verify timeFrame and description are omitted
    expect(events[0].timeFrame).toBeUndefined();
    expect(events[0].description).toBeUndefined();
    expect(events[0].venue).toBe('Bracka 13');

    global.fetch = origFetch;
  });
});
