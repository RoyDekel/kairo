import { describe, test, expect, vi } from 'vitest';
import { searchAIDestinations, formatLocalTimeFrame } from '../aiDestinationEngine';

describe('AI Destination Intelligence Engine', () => {
  test('formats local time frames correctly', () => {
    expect(formatLocalTimeFrame('10:00:00')).toBe('10:00 AM');
    expect(formatLocalTimeFrame('14:30:00')).toBe('2:30 PM');
    expect(formatLocalTimeFrame('18:15:00')).toBe('6:15 PM');
    expect(formatLocalTimeFrame('00:00:00')).toBe('12:00 AM');
    expect(formatLocalTimeFrame(null)).toBeNull();
  });

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

  test('preserves distinct local time slots for the same event while deduplicating exact duplicates', async () => {
    const origFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          events: [
            // Slot 1: 10:00 AM
            {
              id: 'tm-1',
              name: 'Van Gogh & Vincent',
              classifications: [{ segment: { name: 'Arts' } }],
              _embedded: { venues: [{ name: 'Bracka 13' }] },
              dates: { start: { localDate: '2026-08-12', localTime: '10:00:00' } },
              priceRanges: [{ min: 45, max: 180 }]
            },
            // Exact duplicate of Slot 1 (same time 10:00 AM) -> Should be deduplicated
            {
              id: 'tm-1-dup',
              name: 'Van Gogh & Vincent',
              classifications: [{ segment: { name: 'Arts' } }],
              _embedded: { venues: [{ name: 'Bracka 13' }] },
              dates: { start: { localDate: '2026-08-12', localTime: '10:00:00' } },
              priceRanges: [{ min: 45, max: 180 }]
            },
            // Slot 2: 2:30 PM (Separate time slot) -> Should be preserved
            {
              id: 'tm-2',
              name: 'Van Gogh & Vincent',
              classifications: [{ segment: { name: 'Arts' } }],
              _embedded: { venues: [{ name: 'Bracka 13' }] },
              dates: { start: { localDate: '2026-08-12', localTime: '14:30:00' } },
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
      interests: ['festivals', 'culture']
    });

    expect(results.length).toBeGreaterThan(0);
    const events = results[0].matchedEvents;
    // Exactly 2 distinct time slots preserved (10:00 AM and 2:30 PM), duplicate dropped
    expect(events.length).toBe(2);
    expect(events[0].timeFrame).toBe('10:00 AM');
    expect(events[1].timeFrame).toBe('2:30 PM');

    global.fetch = origFetch;
  });
});
