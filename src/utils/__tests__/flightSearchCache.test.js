import { describe, test, expect, beforeEach } from 'vitest';
import { FlightSearchCache } from '../../../server/services/flightSearchCache.js';

/**
 * The durable tier of the flight search cache.
 *
 * The behaviour under test is the one that only shows up in production: /api/flights
 * used to call the active provider on every request, with nothing checked beforehand.
 * QuoteCache recorded a fare AFTER a search for the discovery page's benefit, but never
 * saved a billed SerpApi call. This cache exists to do that -- so the memory tier saves a
 * repeat search within one process, and the Supabase tier saves it across a Render
 * cold start (the free tier spins down after ~15 minutes idle and the in-memory Map goes
 * with it).
 */

/** Minimal stand-in for the postgrest chain, backed by a Map so tests can inspect it. */
function fakeSupabase({ failReads = false, failWrites = false } = {}) {
  const rows = new Map();
  const calls = { select: 0, upsert: 0 };

  return {
    rows,
    calls,
    from() {
      return {
        select() {
          calls.select += 1;
          return {
            eq(_col, key) {
              return {
                async maybeSingle() {
                  if (failReads) return { data: null, error: { message: 'read exploded' } };
                  return { data: rows.get(key) || null, error: null };
                }
              };
            }
          };
        },
        async upsert(row) {
          calls.upsert += 1;
          if (failWrites) return { error: { message: 'write exploded' } };
          rows.set(row.cache_key, row);
          return { error: null };
        }
      };
    }
  };
}

const keyParts = {
  origin: 'TLV',
  destination: 'FCO',
  departureDate: '2026-10-15',
  returnDate: '2026-10-20',
  passengers: { adults: 1, children: 0, infants: 0 },
  stops: '0',
  travelClass: '1'
};

const sampleResults = { outbound: [{ price: 210, airline: 'ITA' }], return: [{ price: 190, airline: 'ITA' }] };

describe('FlightSearchCache key', () => {
  test('is stable for the same route/dates/passengers/cabin', () => {
    expect(FlightSearchCache.buildKey(keyParts)).toBe(FlightSearchCache.buildKey({ ...keyParts }));
  });

  test('is case-insensitive on airport codes', () => {
    expect(FlightSearchCache.buildKey({ ...keyParts, origin: 'tlv', destination: 'fco' }))
      .toBe(FlightSearchCache.buildKey(keyParts));
  });

  test('differs by cabin class, unlike QuoteCache', () => {
    expect(FlightSearchCache.buildKey({ ...keyParts, travelClass: '3' }))
      .not.toBe(FlightSearchCache.buildKey(keyParts));
  });

  test('differs by passenger count', () => {
    const key = FlightSearchCache.buildKey({ ...keyParts, passengers: { adults: 2, children: 0, infants: 0 } });
    expect(key).not.toBe(FlightSearchCache.buildKey(keyParts));
  });
});

describe('FlightSearchCache memory tier', () => {
  let now;
  let cache;

  beforeEach(() => {
    now = 1_700_000_000_000;
    cache = new FlightSearchCache({ now: () => now });
  });

  test('a miss returns null', async () => {
    expect(await cache.get(keyParts)).toBeNull();
  });

  test('serves what was set, without touching Supabase (there is none)', async () => {
    await cache.set(keyParts, sampleResults);
    expect(await cache.get(keyParts)).toEqual(sampleResults);
  });

  test('expires after its TTL', async () => {
    await cache.set(keyParts, sampleResults);
    now += 31 * 60 * 1000; // just past the 30 minute default
    expect(await cache.get(keyParts)).toBeNull();
  });

  test('a different search (e.g. a different date) is a separate entry', async () => {
    await cache.set(keyParts, sampleResults);
    expect(await cache.get({ ...keyParts, departureDate: '2026-10-16' })).toBeNull();
  });
});

describe('FlightSearchCache durable tier', () => {
  let now;

  beforeEach(() => {
    now = 1_700_000_000_000;
  });

  test('without a Supabase client, the cache is memory-only', () => {
    const cache = new FlightSearchCache({ now: () => now });
    expect(cache.isPersistent).toBe(false);
  });

  test('a durable hit survives a fresh process (new memory tier, same Supabase rows)', async () => {
    const supabase = fakeSupabase();
    const writer = new FlightSearchCache({ now: () => now, supabase });
    await writer.set(keyParts, sampleResults);

    // Simulate a Render cold start: brand new process, same Supabase project.
    const reader = new FlightSearchCache({ now: () => now, supabase });
    expect(await reader.get(keyParts)).toEqual(sampleResults);
    expect(supabase.calls.select).toBe(1);
  });

  test('a durable row past its TTL is treated as a miss', async () => {
    const supabase = fakeSupabase();
    const writer = new FlightSearchCache({ now: () => now, supabase });
    await writer.set(keyParts, sampleResults);

    now += 31 * 60 * 1000;
    const reader = new FlightSearchCache({ now: () => now, supabase });
    expect(await reader.get(keyParts)).toBeNull();
  });

  test('a Supabase read failure degrades to a miss, not a thrown error', async () => {
    const supabase = fakeSupabase({ failReads: true });
    const cache = new FlightSearchCache({ now: () => now, supabase });
    await expect(cache.get(keyParts)).resolves.toBeNull();
  });

  test('a Supabase write failure never throws -- a lost write costs a future API call, not this search', async () => {
    const supabase = fakeSupabase({ failWrites: true });
    const cache = new FlightSearchCache({ now: () => now, supabase });
    await expect(cache.set(keyParts, sampleResults)).resolves.toEqual(sampleResults);
    // The memory tier still has it even though the durable write failed.
    expect(await cache.get(keyParts)).toEqual(sampleResults);
  });

  test('a promoted durable hit is served from memory on the next call, without a second read', async () => {
    const supabase = fakeSupabase();
    const writer = new FlightSearchCache({ now: () => now, supabase });
    await writer.set(keyParts, sampleResults);

    const reader = new FlightSearchCache({ now: () => now, supabase });
    await reader.get(keyParts); // promotes into reader's memory tier
    await reader.get(keyParts); // should be served from memory this time

    expect(supabase.calls.select).toBe(1);
  });
});

describe('FlightSearchCache.clear', () => {
  test('drops the memory tier but leaves durable rows for other instances', async () => {
    const supabase = fakeSupabase();
    const cache = new FlightSearchCache({ now: () => 1_700_000_000_000, supabase });
    await cache.set(keyParts, sampleResults);

    cache.clear();
    expect(cache.size).toBe(0);

    // Durable row survives the clear -- a fresh get() re-promotes it from Supabase.
    expect(await cache.get(keyParts)).toEqual(sampleResults);
  });
});
