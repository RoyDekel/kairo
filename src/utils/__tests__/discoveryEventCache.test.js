import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readCachedEvents, writeCachedEvents, clearCachedEvents } from '../discoveryEventCache';
import { fetchEventsForDestinations, DiscoveryUnavailableError } from '../aiDestinationEngine';

/**
 * The browser-side half of the event cache.
 *
 * The server cache stops the second search from reaching Ticketmaster; this stops it from
 * reaching the server at all. On a backend that cold-starts behind a 12-second timeout,
 * that is the difference the user actually feels.
 */

const window_ = { start: '2026-09-11', end: '2026-09-16' };

const batchResponse = (eventsByDestination, statusByDestination = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    eventsByDestination,
    statusByDestination,
    coverage: 'ticketed-only',
    partial: false,
    unavailableDestinations: []
  })
});

const tmEvent = (title) => ({ id: title, title, venue: 'v', date: '2026-09-12', category: 'Music' });

describe('discoveryEventCache', () => {
  beforeEach(() => {
    clearCachedEvents();
    window.sessionStorage.clear();
  });

  test('reports which destinations are known and which must be fetched', () => {
    writeCachedEvents({ BCN: [tmEvent('a')] }, { BCN: 'ok' }, window_.start, window_.end);

    const { cached, misses } = readCachedEvents(['BCN', 'MAD'], window_.start, window_.end);

    expect(cached.BCN).toHaveLength(1);
    expect(misses).toEqual(['MAD']);
  });

  test('a different date window is a miss, not a wrong answer', () => {
    writeCachedEvents({ BCN: [tmEvent('a')] }, { BCN: 'ok' }, window_.start, window_.end);

    const { misses } = readCachedEvents(['BCN'], '2026-10-01', '2026-10-06');
    expect(misses).toEqual(['BCN']);
  });

  test('an entry past its TTL is a miss', () => {
    const t0 = Date.parse('2026-08-01T00:00:00Z');
    writeCachedEvents({ BCN: [tmEvent('a')] }, { BCN: 'ok' }, window_.start, window_.end, { now: t0 });

    const fresh = readCachedEvents(['BCN'], window_.start, window_.end, { now: t0 + 60_000 });
    expect(fresh.misses).toEqual([]);

    const stale = readCachedEvents(['BCN'], window_.start, window_.end, { now: t0 + 7 * 60 * 60 * 1000 });
    expect(stale.misses).toEqual(['BCN']);
  });

  /*
    "We couldn't check" must never be cached as "nothing is on" — that is the distinction
    the server's per-destination status codes were introduced to preserve, and caching an
    empty array for six hours would quietly undo it in the browser.
  */
  test('an unavailable destination is not cached', () => {
    writeCachedEvents({ BCN: [], MAD: [tmEvent('b')] }, { BCN: 'unavailable', MAD: 'ok' }, window_.start, window_.end);

    const { misses } = readCachedEvents(['BCN', 'MAD'], window_.start, window_.end);
    expect(misses).toEqual(['BCN']);
  });

  test('an empty result IS cached, because it is an answer', () => {
    writeCachedEvents({ BCN: [] }, { BCN: 'empty' }, window_.start, window_.end);

    const { cached, misses } = readCachedEvents(['BCN'], window_.start, window_.end);
    expect(misses).toEqual([]);
    expect(cached.BCN).toEqual([]);
  });

  test('a corrupt entry is a miss rather than a crash', () => {
    window.sessionStorage.setItem('kairo:events:v1|BCN|2026-09-11|2026-09-16', '{not json');

    const { misses } = readCachedEvents(['BCN'], window_.start, window_.end);
    expect(misses).toEqual(['BCN']);
  });

  test('survives a sessionStorage that refuses to store anything', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() =>
      writeCachedEvents({ BCN: [tmEvent('a')] }, { BCN: 'ok' }, window_.start, window_.end)
    ).not.toThrow();

    setItem.mockRestore();
  });
});

describe('fetchEventsForDestinations caching', () => {
  beforeEach(() => {
    clearCachedEvents();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('a repeated search makes no request at all', async () => {
    const fetchMock = vi.fn().mockResolvedValue(batchResponse({ BCN: [tmEvent('a')] }, { BCN: 'ok' }));
    globalThis.fetch = fetchMock;

    const first = await fetchEventsForDestinations(['BCN'], window_.start, window_.end, 'token');
    expect(first.eventsByDestination.BCN).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await fetchEventsForDestinations(['BCN'], window_.start, window_.end, 'token');
    expect(second.eventsByDestination.BCN).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /*
    Raising the budget widens the destination list. Per-destination keys mean the request
    covers only what is genuinely new; a whole-search key would refetch all of it.
  */
  test('a widened destination list asks only about the new destinations', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(batchResponse({ BCN: [tmEvent('a')] }, { BCN: 'ok' }))
      .mockResolvedValueOnce(batchResponse({ MAD: [tmEvent('b')] }, { MAD: 'ok' }));
    globalThis.fetch = fetchMock;

    await fetchEventsForDestinations(['BCN'], window_.start, window_.end, 'token');
    const merged = await fetchEventsForDestinations(['BCN', 'MAD'], window_.start, window_.end, 'token');

    expect(Object.keys(merged.eventsByDestination).sort()).toEqual(['BCN', 'MAD']);

    const secondUrl = fetchMock.mock.calls[1][0];
    expect(secondUrl).toContain('destinations=MAD');
    expect(secondUrl).not.toContain('BCN');
  });

  /*
    Holding half a page of cached results does not make a failed lookup succeed. Rendering
    the cached subset would present an incomplete answer as a complete one.
  */
  test('a backend failure still surfaces, even with cached destinations in hand', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(batchResponse({ BCN: [tmEvent('a')] }, { BCN: 'ok' }))
      .mockRejectedValueOnce(new Error('network down'));
    globalThis.fetch = fetchMock;

    await fetchEventsForDestinations(['BCN'], window_.start, window_.end, 'token');

    await expect(
      fetchEventsForDestinations(['BCN', 'MAD'], window_.start, window_.end, 'token')
    ).rejects.toBeInstanceOf(DiscoveryUnavailableError);
  });
});
