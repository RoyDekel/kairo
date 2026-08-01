import { describe, test, expect, vi } from 'vitest';
import { FareHistory, percentileOf, medianOf, MIN_OBSERVATIONS } from '../../../server/services/fareHistory.js';

/**
 * The record of fares actually observed.
 *
 * This table exists because "23% below the historical average" was measured against
 * `price * 1.35` — a baseline derived from the number it was judging, which made the
 * saving a constant 26% for every route and every date. These tests pin the two properties
 * that stop it happening again: only real quotes are recorded, and a sample too small to
 * mean anything reports nothing rather than a number.
 */

function fakeSupabase({ rows = [], failReads = false, failWrites = false } = {}) {
  const inserted = [];
  const calls = { select: 0, insert: 0 };

  return {
    inserted,
    calls,
    from() {
      return {
        async insert(row) {
          calls.insert += 1;
          if (failWrites) return { error: { message: 'write exploded' } };
          inserted.push(row);
          return { error: null };
        },
        select() {
          calls.select += 1;
          const chain = {
            in(_col, keys) {
              chain._keys = keys;
              return chain;
            },
            gte() {
              return chain;
            },
            async limit() {
              if (failReads) return { data: null, error: { message: 'read exploded' } };
              return { data: rows.filter((r) => chain._keys.includes(r.route)), error: null };
            }
          };
          return chain;
        }
      };
    }
  };
}

const quote = (overrides = {}) => ({
  origin: 'TLV',
  destination: 'BCN',
  departureDate: '2026-09-11',
  returnDate: '2026-09-18',
  roundtripPrice: 480,
  provider: 'serpapi',
  ...overrides
});

describe('percentileOf', () => {
  test('a fare cheaper than everything on record scores 0', () => {
    expect(percentileOf(200, [300, 400, 500])).toBe(0);
  });

  test('a fare dearer than everything on record scores 100', () => {
    expect(percentileOf(900, [300, 400, 500])).toBe(100);
  });

  test('the middle of the distribution lands in the middle', () => {
    expect(percentileOf(400, [200, 300, 500, 600])).toBe(50);
  });

  test('an empty history has no percentile, rather than a default one', () => {
    expect(percentileOf(400, [])).toBeNull();
  });
});

describe('medianOf', () => {
  /*
    Median rather than mean: one $2,400 business-class quote should not redefine "usual"
    for a route that normally sells at $400.
  */
  test('a single outlier does not move the typical price much', () => {
    expect(medianOf([380, 400, 420, 2400])).toBe(410);
  });

  test('an empty list has no median', () => {
    expect(medianOf([])).toBeNull();
  });
});

describe('FareHistory.record', () => {
  test('stores a real provider quote', async () => {
    const supabase = fakeSupabase();
    const history = new FareHistory({ supabase });

    await expect(history.record(quote())).resolves.toBe(true);
    expect(supabase.inserted[0]).toMatchObject({ route: 'TLV-BCN', roundtrip_price: 480, provider: 'serpapi' });
  });

  /*
    The central rule. A baseline seeded with the simulator's own output would measure the
    simulator, and every "below usual" claim built on it would be circular in exactly the
    way the old 1.35 multiplier was.
  */
  test('refuses a simulated fare', async () => {
    const supabase = fakeSupabase();
    const history = new FareHistory({ supabase });

    await expect(history.record(quote({ provider: 'simulated' }))).resolves.toBe(false);
    expect(supabase.calls.insert).toBe(0);
  });

  test('refuses a nonsense price', async () => {
    const supabase = fakeSupabase();
    const history = new FareHistory({ supabase });

    await expect(history.record(quote({ roundtripPrice: 0 }))).resolves.toBe(false);
  });

  test('a write failure is survivable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const history = new FareHistory({ supabase: fakeSupabase({ failWrites: true }) });

    await expect(history.record(quote())).resolves.toBe(false);
  });

  test('without Supabase it is simply disabled', async () => {
    const history = new FareHistory({ supabase: null });

    expect(history.isEnabled).toBe(false);
    await expect(history.record(quote())).resolves.toBe(false);
  });
});

describe('FareHistory.statsForRoutes', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ({ route: 'TLV-BCN', roundtrip_price: 400 + i * 20 })),
    { route: 'TLV-MAD', roundtrip_price: 300 }
  ];

  test('reads every route in one query', async () => {
    const supabase = fakeSupabase({ rows });
    const history = new FareHistory({ supabase });

    const stats = await history.statsForRoutes(['TLV-BCN', 'TLV-MAD', 'TLV-ROM']);

    expect(supabase.calls.select).toBe(1);
    expect(stats['TLV-BCN'].sampleSize).toBe(6);
    expect(stats['TLV-ROM']).toBeUndefined();
  });

  test('summarises a route with enough observations', async () => {
    const history = new FareHistory({ supabase: fakeSupabase({ rows }) });
    const stats = await history.statsForRoutes(['TLV-BCN']);

    const summary = history.summarise(410, stats['TLV-BCN']);

    expect(summary.historicalSampleSize).toBe(6);
    expect(summary.historicalPercentile).toBe(17); // one of six observations was cheaper
    expect(summary.typicalPrice).toBe(450);
  });

  /*
    Below the threshold the honest answer is "we don't know yet", and the UI is built to
    render that. Returning a number here is how a percentile computed from two data points
    ends up printed next to a fare as though it meant something.
  */
  test('reports nulls rather than a percentile from a thin sample', async () => {
    const thin = Array.from({ length: MIN_OBSERVATIONS - 1 }, () => ({ route: 'TLV-MAD', roundtrip_price: 300 }));
    const history = new FareHistory({ supabase: fakeSupabase({ rows: thin }) });

    const stats = await history.statsForRoutes(['TLV-MAD']);
    const summary = history.summarise(280, stats['TLV-MAD']);

    expect(summary.historicalPercentile).toBeNull();
    expect(summary.typicalPrice).toBeNull();
    expect(summary.historicalSampleSize).toBe(MIN_OBSERVATIONS - 1);
  });

  test('a read failure degrades to no history rather than throwing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const history = new FareHistory({ supabase: fakeSupabase({ failReads: true }) });

    await expect(history.statsForRoutes(['TLV-BCN'])).resolves.toEqual({});
  });
});
