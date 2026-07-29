import { describe, test, expect, vi, afterEach } from 'vitest';
import { searchAIDestinations, DiscoveryUnavailableError } from '../aiDestinationEngine';

const origFetch = global.fetch;

afterEach(() => {
  global.fetch = origFetch;
  vi.restoreAllMocks();
});

/** Builds a mock /api/events/batch response for every requested destination code. */
const mockBatchResponse = (eventsPerDestination) => {
  global.fetch = vi.fn().mockImplementation(async (url) => {
    const requested = new URL(url, 'http://localhost').searchParams.get('destinations') || '';
    const eventsByDestination = {};
    for (const code of requested.split(',').filter(Boolean)) {
      eventsByDestination[code] = eventsPerDestination;
    }
    return { ok: true, status: 200, json: async () => ({ eventsByDestination }) };
  });
};

describe('AI Destination Intelligence Engine', () => {
  test('returns empty array when the backend reports 0 events for the date range', async () => {
    mockBatchResponse([]);

    const results = await searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 1500,
      interests: ['music', 'sports']
    });

    expect(results).toEqual([]);
  });

  test('strictly enforces 1 unique result per event title and omits descriptions/times', async () => {
    mockBatchResponse([
      {
        id: 'tm-1',
        title: 'Van Gogh & Vincent',
        category: 'Arts',
        venue: 'Bracka 13',
        date: '2026-08-12',
        priceEstimate: '$45 - $180'
      },
      // Same event title, different showing -> deduplicated down to 1 unique event
      {
        id: 'tm-2',
        title: 'Van Gogh & Vincent',
        category: 'Arts',
        venue: 'Bracka 13',
        date: '2026-08-12',
        priceEstimate: '$45 - $180'
      },
      {
        id: 'tm-3',
        title: 'Muzeum Banksy',
        category: 'Arts',
        venue: 'Muzeum Banksy',
        date: '2026-08-13',
        priceEstimate: '$45 - $180'
      }
    ]);

    const results = await searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 1500,
      interests: ['culture', 'festivals']
    });

    expect(results.length).toBeGreaterThan(0);
    const events = results[0].matchedEvents;

    expect(events.length).toBe(2);
    expect(events[0].title).toBe('Van Gogh & Vincent');
    expect(events[1].title).toBe('Muzeum Banksy');

    // Verify timeFrame and description are omitted
    expect(events[0].timeFrame).toBeUndefined();
    expect(events[0].description).toBeUndefined();
    expect(events[0].venue).toBe('Bracka 13');
  });

  test('issues exactly ONE batched backend request regardless of destination count', async () => {
    mockBatchResponse([
      { id: 'tm-1', title: 'A Concert', category: 'Music', venue: 'Arena', date: '2026-08-12', priceEstimate: '$50 - $100' }
    ]);

    await searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 5000,
      interests: ['music']
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toContain('/api/events/batch');
  });

  test('never sends a Ticketmaster API key from the client', async () => {
    mockBatchResponse([]);

    await searchAIDestinations({ origin: 'TLV', maxBudget: 5000, interests: [] });

    const [requestedUrl, requestInit] = global.fetch.mock.calls[0];
    expect(requestedUrl).not.toMatch(/apikey/i);
    expect(requestedUrl).not.toContain('ticketmaster.com');
    expect(JSON.stringify(requestInit?.headers || {})).not.toMatch(/apikey/i);
  });

  test('throws DiscoveryUnavailableError when the backend is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(
      searchAIDestinations({ origin: 'TLV', maxBudget: 5000, interests: ['music'] })
    ).rejects.toBeInstanceOf(DiscoveryUnavailableError);
  });

  test('throws DiscoveryUnavailableError on a non-OK backend response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });

    await expect(
      searchAIDestinations({ origin: 'TLV', maxBudget: 5000, interests: ['music'] })
    ).rejects.toBeInstanceOf(DiscoveryUnavailableError);
  });
});
