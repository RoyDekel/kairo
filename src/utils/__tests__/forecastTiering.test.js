import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ForecastService,
  buildDailyIndex,
  horizonDaysOf,
  horizonBucketOf,
  MIN_DAYS_FOR_FORECAST,
  MIN_OBS_FOR_FORECAST
} from '../../../server/services/forecastService.js';

/** Minimal stand-in for the PostgREST builder chain forecastRoute uses. */
function stubSupabase(rows) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: async () => ({ data: rows, error: null })
  };
  return { from: () => builder };
}

/** `days` observations, `perDay` rows each, all at the same horizon. */
function rowsOver(days, perDay, price = 500, horizon = 30) {
  const out = [];
  for (let d = 0; d < days; d++) {
    const observed = new Date(Date.UTC(2026, 6, 1 + d));
    const departure = new Date(observed.getTime() + horizon * 86_400_000);
    for (let i = 0; i < perDay; i++) {
      out.push({
        roundtrip_price: price,
        observed_at: observed.toISOString(),
        departure_date: departure.toISOString().slice(0, 10),
        provider: 'fli'
      });
    }
  }
  return out;
}

describe('horizon helpers', () => {
  it('measures days to departure from the observation date', () => {
    expect(horizonDaysOf('2026-08-01T09:30:00Z', '2026-08-15')).toBe(14);
  });

  it('returns null rather than NaN on missing or unparseable input', () => {
    expect(horizonDaysOf(null, '2026-08-15')).toBeNull();
    expect(horizonDaysOf('2026-08-01T00:00:00Z', null)).toBeNull();
    expect(horizonDaysOf('nonsense', 'nonsense')).toBeNull();
  });

  // Production held user searches at 7, 37, 41, 45 and 161 days out. Buckets let a 41-day
  // search inform the 40-day level instead of being incomparable to everything.
  it('snaps arbitrary horizons onto a decade grid', () => {
    expect(horizonBucketOf(41)).toBe(40);
    expect(horizonBucketOf(45)).toBe(50);
    expect(horizonBucketOf(14)).toBe(10);
    expect(horizonBucketOf(161)).toBe(160);
    expect(horizonBucketOf(-3)).toBeNull();
    expect(horizonBucketOf(null)).toBeNull();
  });
});

describe('buildDailyIndex — the horizon-mix correction', () => {
  it('counts one entry per distinct observation day', () => {
    const { timeline, distinctDays } = buildDailyIndex(rowsOver(5, 4));
    expect(distinctDays).toBe(5);
    expect(timeline).toHaveLength(5);
  });

  it('returns the price level unchanged when the mix is stable', () => {
    const { timeline } = buildDailyIndex(rowsOver(3, 4, 500));
    expect(timeline.every((pt) => pt.price === 500)).toBe(true);
  });

  /*
    THE REGRESSION THIS FILE EXISTS FOR.

    Day 1 sees all four horizons; day 2 loses the two cheap short-haul horizons to a
    provider failure. No fare moved. A plain median over each day's rows reports a jump
    from 450 to 750 — a 67% "increase" that is purely the collector's yield.
  */
  it('does not report a price move when only the surviving horizons change', () => {
    const rows = [
      { roundtrip_price: 300, observed_at: '2026-07-01T00:00:00Z', departure_date: '2026-07-15' },
      { roundtrip_price: 400, observed_at: '2026-07-01T00:00:00Z', departure_date: '2026-07-31' },
      { roundtrip_price: 700, observed_at: '2026-07-01T00:00:00Z', departure_date: '2026-08-30' },
      { roundtrip_price: 800, observed_at: '2026-07-01T00:00:00Z', departure_date: '2026-09-29' },
      // Next day: the 14d and 30d samples failed.
      { roundtrip_price: 700, observed_at: '2026-07-02T00:00:00Z', departure_date: '2026-08-31' },
      { roundtrip_price: 800, observed_at: '2026-07-02T00:00:00Z', departure_date: '2026-09-30' }
    ];

    const naiveDay1 = (400 + 700) / 2; // 550, median of all four
    const naiveDay2 = (700 + 800) / 2; // 750, median of the two survivors
    expect(naiveDay2 / naiveDay1).toBeGreaterThan(1.3); // the phantom move

    const { timeline } = buildDailyIndex(rows);
    const move = Math.abs(timeline[1].price - timeline[0].price) / timeline[0].price;
    expect(move).toBeLessThan(0.05);
  });

  it('still reports a move when prices genuinely change at a fixed mix', () => {
    const flat = buildDailyIndex(rowsOver(1, 4, 500)).timeline[0].price;
    const rows = [...rowsOver(1, 4, 500), ...rowsOver(1, 4, 1000).map((r) => ({
      ...r,
      observed_at: '2026-07-02T00:00:00Z'
    }))];
    const { timeline } = buildDailyIndex(rows);
    expect(timeline).toHaveLength(2);
    expect(timeline[1].price).toBeGreaterThan(flat);
  });

  it('drops rows with no usable price instead of poisoning the median', () => {
    const rows = [
      ...rowsOver(1, 2, 500),
      { roundtrip_price: 0, observed_at: '2026-07-01T00:00:00Z', departure_date: '2026-07-31' },
      { roundtrip_price: null, observed_at: '2026-07-01T00:00:00Z', departure_date: '2026-07-31' }
    ];
    expect(buildDailyIndex(rows).timeline[0].price).toBe(500);
  });

  it('handles an empty input', () => {
    expect(buildDailyIndex([])).toEqual({ timeline: [], distinctDays: 0 });
  });
});

describe('forecastRoute tiering', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.HF_ENDPOINT_URL;
    delete process.env.FORECAST_PROVIDER;
    delete process.env.FLIGHT_PROVIDER;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const svc = (rows) => new ForecastService({
    supabase: stubSupabase(rows),
    now: () => Date.parse('2026-07-20T00:00:00Z')
  });

  it('reports tier 1 below the observation floor', async () => {
    const res = await svc(rowsOver(2, 2)).forecastRoute('TLV', 'CDG', 500);
    expect(res.reason).toBe('insufficient_history');
    expect(res.confidenceScore).toBeUndefined();
  });

  /*
    THE PRODUCTION BUG, PINNED.

    78 observations over 5 days cleared MIN_OBS_FOR_FORECAST (30) more than twice over.
    The old code entered tier 3 on that row count, found M(5) < S(7), skipped the seasonal
    branch, and produced a confidence from a hardcoded stdDev of 25 — a number that varied
    only with price level. It must now decline to score.
  */
  it('refuses to score when rows are plentiful but days are few', async () => {
    const rows = rowsOver(5, 16); // 80 rows, 5 days
    expect(rows.length).toBeGreaterThan(MIN_OBS_FOR_FORECAST);

    const res = await svc(rows).forecastRoute('TLV', 'CDG', 500);

    expect(res.reason).toBe('basic_statistics');
    expect(res.confidenceScore).toBeNull();
    expect(res.insufficientDays).toBe(true);
    expect(res.distinctDays).toBe(5);
    expect(res.predictionInterval).toBeUndefined();
  });

  it('never returns the old price-level-derived confidence values', async () => {
    // 95 - (25/avg)*100 produced 87 at $300, 91 at $600, 93 at $1000 — regardless of
    // volatility. Any of those appearing on a 5-day sample means the constant is back.
    for (const price of [300, 600, 1000]) {
      const res = await svc(rowsOver(5, 16, price)).forecastRoute('TLV', 'CDG', price);
      expect(res.confidenceScore).toBeNull();
    }
  });

  it('declines to score at exactly the day threshold, where residuals are too few', async () => {
    // 7 days gives zero residuals at a 7-day lag; a variance needs at least two.
    const res = await svc(rowsOver(MIN_DAYS_FOR_FORECAST, 6)).forecastRoute('TLV', 'CDG', 500);
    expect(res.confidenceScore).toBeNull();
    expect(res.insufficientDays).toBe(true);
  });

  it('forecasts once there are enough days AND enough residuals', async () => {
    const res = await svc(rowsOver(12, 4)).forecastRoute('TLV', 'CDG', 500);

    expect(res.reason).toBe('seasonal_naive_forecast');
    expect(res.confidenceScore).toBeGreaterThanOrEqual(75);
    expect(res.confidenceScore).toBeLessThanOrEqual(95);
    expect(res.distinctDays).toBe(12);
    expect(res.predictionInterval.lower).toBeLessThan(res.predictionInterval.upper);
  });

  it('reports distinctDays next to sampleSize so the two cannot be confused', async () => {
    const res = await svc(rowsOver(12, 10)).forecastRoute('TLV', 'CDG', 500);
    expect(res.sampleSize).toBe(120);
    expect(res.distinctDays).toBe(12);
  });

  it('is unaffected by an unset provider lock', async () => {
    const res = await svc(rowsOver(12, 4)).forecastRoute('TLV', 'CDG', 500);
    expect(res.reason).toBe('seasonal_naive_forecast');
  });

  it('does not lock to the simulated provider, which writes no history anyway', async () => {
    process.env.FLIGHT_PROVIDER = 'simulated';
    const res = await svc(rowsOver(12, 4)).forecastRoute('TLV', 'CDG', 500);
    expect(res.reason).toBe('seasonal_naive_forecast');
  });

  it('reports no_database rather than guessing when Supabase is absent', async () => {
    const res = await new ForecastService({ supabase: null }).forecastRoute('TLV', 'CDG', 500);
    expect(res).toEqual({ verdict: null, reason: 'no_database', sampleSize: 0 });
  });
});

describe('FareCollector sweep accounting', () => {
  it('records per-outcome counts and a yield percentage', async () => {
    const { FareCollector } = await import('../../../server/jobs/fareCollector.js');

    let call = 0;
    const service = {
      providerName: 'fli',
      // 1 good, 1 empty, 1 thrown -> 33% yield over three tasks.
      searchFlights: async () => {
        call++;
        if (call === 1) return { outbound: [{ price: 200 }], return: [{ price: 200 }], providerUsed: 'fli', currency: 'USD' };
        if (call === 2) return { outbound: [], return: [] };
        throw new Error('429 Too Many Requests');
      }
    };

    const collector = new FareCollector({
      service,
      fareHistory: { record: async () => true },
      airports: { TLV: {}, CDG: {} },
      now: () => new Date('2026-08-06T00:00:00Z')
    });

    process.env.COLLECTOR_DESTINATIONS = 'CDG';
    process.env.COLLECTOR_HORIZONS = '14,30,60';
    process.env.COLLECTOR_DELAY_MS = '0';

    await collector.runSweep();

    expect(collector.lastSweep.attempted).toBe(3);
    expect(collector.lastSweep.recorded).toBe(1);
    expect(collector.lastSweep.no_results).toBe(1);
    expect(collector.lastSweep.provider_error).toBe(1);
    expect(collector.lastSweep.yieldPct).toBe(33);

    delete process.env.COLLECTOR_DESTINATIONS;
    delete process.env.COLLECTOR_HORIZONS;
    delete process.env.COLLECTOR_DELAY_MS;
  });

  it('counts a write refused by fareHistory separately from a provider failure', async () => {
    const { FareCollector } = await import('../../../server/jobs/fareCollector.js');

    const collector = new FareCollector({
      service: {
        providerName: 'simulated',
        searchFlights: async () => ({ outbound: [{ price: 100 }], return: [{ price: 100 }], providerUsed: 'simulated', currency: 'USD' })
      },
      // What fareHistory.record does for a simulated provider, or with no service key.
      fareHistory: { record: async () => false },
      airports: { TLV: {}, CDG: {} },
      now: () => new Date('2026-08-06T00:00:00Z')
    });

    const result = await collector.sampleOne('TLV', 'CDG', 14);
    expect(result).toEqual({ ok: false, reason: 'rejected_by_fare_history' });
  });
});
