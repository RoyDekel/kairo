/**
 * @vitest-environment node
 */
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForecastBatch, startForecastBatch } from '../../../server/jobs/forecastBatch.js';

/** Fake ForecastCache: records puts, keys them like the real (route, currency) upsert. */
function fakeCache({ observations = {} } = {}) {
  return {
    puts: [],
    store: new Map(),
    async latestObservedPrice(route) {
      return observations[route] ?? null;
    },
    async put(route, currency, forecast, meta) {
      this.puts.push({ route, currency, forecast, meta });
      this.store.set(`${route}|${currency}`, { route, currency, forecast, ...meta });
      return true;
    }
  };
}

/** Fake ForecastService: records calls and returns a per-route forecast object. */
function fakeService(resolver) {
  return {
    calls: [],
    async forecastRoute(origin, destination, price, currency) {
      this.calls.push({ origin, destination, price, currency });
      const key = `${origin}-${destination}`;
      const fallback = { verdict: 'WAIT', reason: 'seasonal_naive_forecast', sampleSize: 100, distinctDays: 10, confidenceScore: 85 };
      return typeof resolver === 'function' ? resolver(key, price) : (resolver?.[key] ?? fallback);
    }
  };
}

const AIRPORTS = { TLV: {}, CDG: {}, JFK: {}, LHR: {} };
const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.FORECAST_BATCH_HOME_AIRPORTS;
  delete process.env.FORECAST_BATCH_DESTINATIONS;
  delete process.env.COLLECTOR_HOME_AIRPORTS;
  delete process.env.COLLECTOR_DESTINATIONS;
  delete process.env.VITE_FEATURED_HUBS;
  delete process.env.FORECAST_BATCH_MAX_TASKS;
  delete process.env.FORECAST_PROVIDER;
  delete process.env.FLIGHT_PROVIDER;
  delete process.env.FARE_CURRENCY;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('startForecastBatch — scheduling gate (AC 2, 3)', () => {
  test('returns null and schedules nothing when FORECAST_BATCH_ENABLED is unset', () => {
    delete process.env.FORECAST_BATCH_ENABLED;
    expect(startForecastBatch({ run: vi.fn() })).toBeNull();
  });

  test('returns null when FORECAST_BATCH_ENABLED != "true"', () => {
    vi.stubEnv('FORECAST_BATCH_ENABLED', 'yes');
    expect(startForecastBatch({ run: vi.fn() })).toBeNull();
    vi.unstubAllEnvs();
  });

  test('schedules a cron and fires an initial run after the boot delay when enabled', () => {
    vi.useFakeTimers();
    vi.stubEnv('FORECAST_BATCH_ENABLED', 'true');
    vi.stubEnv('FORECAST_BATCH_BOOT_DELAY_MS', '15000');

    const batch = { run: vi.fn().mockResolvedValue(undefined) };
    const task = startForecastBatch(batch);

    expect(task).not.toBeNull();
    expect(batch.run).not.toHaveBeenCalled(); // not yet — waits for the boot delay

    vi.advanceTimersByTime(15000);
    expect(batch.run).toHaveBeenCalledTimes(1);

    task.stop();
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
});

describe('ForecastBatch.run — route iteration & current-price selection (AC 4, 5)', () => {
  test('iterates home × destination and skips origin === destination', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG,TLV,JFK';

    const service = fakeService();
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 500, provider: 'fli' }, 'TLV-JFK': { price: 900, provider: 'fli' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();

    const routesForecast = service.calls.map((c) => `${c.origin}-${c.destination}`);
    expect(routesForecast).toEqual(['TLV-CDG', 'TLV-JFK']); // TLV-TLV skipped
  });

  test('passes the latest observed price as currentPrice and records it as computed_current_price', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG';

    const service = fakeService();
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 512, provider: 'fli' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();

    expect(service.calls[0].price).toBe(512);
    expect(cache.puts).toHaveLength(1);
    const put = cache.puts[0];
    expect(put.route).toBe('TLV-CDG');
    expect(put.meta.computedCurrentPrice).toBe(512);
    // The whole forecast object is handed to put verbatim (payload deep-equals the return).
    expect(put.forecast).toEqual({ verdict: 'WAIT', reason: 'seasonal_naive_forecast', sampleSize: 100, distinctDays: 10, confidenceScore: 85 });
  });

  test('respects the provider lock when recording the row provider', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG';
    process.env.FORECAST_PROVIDER = 'fli';

    const service = fakeService();
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 500, provider: 'serpapi' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();
    // With the lock set, the lock wins over the observation's own provider.
    expect(cache.puts[0].meta.provider).toBe('fli');
  });

  test('falls back to the observation provider when no lock is set', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG';

    const service = fakeService();
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 500, provider: 'serpapi' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();
    expect(cache.puts[0].meta.provider).toBe('serpapi');
  });
});

describe('ForecastBatch.run — write / skip rules (AC 6, 7)', () => {
  test('skips a route with no observation, writes nothing, and continues to the next (AC 6)', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG,JFK';

    const service = fakeService();
    // Only JFK has an observation; CDG has none.
    const cache = fakeCache({ observations: { 'TLV-JFK': { price: 900, provider: 'fli' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();

    expect(service.calls.map((c) => c.destination)).toEqual(['JFK']); // CDG never forecast
    expect(cache.puts.map((p) => p.route)).toEqual(['TLV-JFK']);
    expect(batch.lastRun.no_observation).toBe(1);
  });

  test('writes null-tier verdicts (insufficient_history / basic_statistics are cached)', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG';

    const service = fakeService({ 'TLV-CDG': { verdict: null, reason: 'basic_statistics', sampleSize: 8, distinctDays: 3 } });
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 400, provider: 'fli' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();
    expect(cache.puts).toHaveLength(1);
    expect(cache.puts[0].forecast.reason).toBe('basic_statistics');
    expect(batch.lastRun.nullVerdict).toBe(1);
  });

  test('does NOT write on transient reasons (error / database_error / no_database) (AC 7)', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG,JFK,LHR';

    const service = fakeService({
      'TLV-CDG': { verdict: null, reason: 'error', sampleSize: 0 },
      'TLV-JFK': { verdict: null, reason: 'database_error', sampleSize: 0 },
      'TLV-LHR': { verdict: null, reason: 'no_database', sampleSize: 0 }
    });
    const cache = fakeCache({
      observations: {
        'TLV-CDG': { price: 500, provider: 'fli' },
        'TLV-JFK': { price: 900, provider: 'fli' },
        'TLV-LHR': { price: 300, provider: 'fli' }
      }
    });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();
    expect(cache.puts).toHaveLength(0);
    expect(batch.lastRun.transient).toBe(3);
  });
});

describe('ForecastBatch.run — upsert idempotency (AC 8)', () => {
  test('two consecutive runs leave exactly one row per (route, currency)', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG,JFK';

    const service = fakeService();
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 500, provider: 'fli' }, 'TLV-JFK': { price: 900, provider: 'fli' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    await batch.run();
    await batch.run();

    expect(cache.puts).toHaveLength(4); // 2 routes x 2 runs of upsert calls
    expect(cache.store.size).toBe(2); // but only one row per (route, currency)
    expect([...cache.store.keys()].sort()).toEqual(['TLV-CDG|USD', 'TLV-JFK|USD']);
  });
});

describe('ForecastBatch.run — summary logging (AC 13)', () => {
  test('logs one summary line: routes processed, verdicts by BUY/WAIT/null, and skips', async () => {
    process.env.FORECAST_BATCH_HOME_AIRPORTS = 'TLV';
    process.env.FORECAST_BATCH_DESTINATIONS = 'CDG,JFK,LHR';

    const service = fakeService({
      'TLV-CDG': { verdict: 'BUY_NOW', reason: 'seasonal_naive_forecast', sampleSize: 100, distinctDays: 12, confidenceScore: 90 },
      'TLV-JFK': { verdict: 'WAIT', reason: 'seasonal_naive_forecast', sampleSize: 100, distinctDays: 12, confidenceScore: 82 }
      // TLV-LHR has no observation -> skipped
    });
    const cache = fakeCache({ observations: { 'TLV-CDG': { price: 500, provider: 'fli' }, 'TLV-JFK': { price: 900, provider: 'fli' } } });
    const batch = new ForecastBatch({ forecastService: service, forecastCache: cache, airports: AIRPORTS });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await batch.run();

    const summary = logSpy.mock.calls.map((c) => c[0]).find((line) => typeof line === 'string' && line.includes('Run done'));
    expect(summary).toContain('2 written (1 BUY, 1 WAIT, 0 null)');
    expect(summary).toContain('1 skipped (no observation)');
    expect(summary).toContain('of 3 routes');
  });
});
