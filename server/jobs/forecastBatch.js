import cron from 'node-cron';
import { forecastService as defaultForecastService } from '../services/forecastService.js';
import { forecastCache as defaultForecastCache } from '../services/forecastCache.js';
import { FareHistory } from '../services/fareHistory.js';
import { AIRPORTS } from '../../shared/catalog.js';

/**
 * Nightly precompute of BUY/WAIT verdicts for the featured-hub routes.
 *
 * Mirrors fareCollector.js beat for beat: a node-cron job living inside the web process,
 * env-gated, with a resume cursor and a single summary log line. It reuses
 * forecastService.forecastRoute UNCHANGED — the whole design keeps the diff off the engine's
 * math. All table access goes through ForecastCache (hard rule 6).
 *
 * WHY OFF THE REQUEST PATH: forecastRoute runs a ~1,000-row read, a daily-index rebuild, and
 * (once HF_ENDPOINT_URL is set) a 4s call to a Chronos endpoint — today all inside the user's
 * /api/flights request. On Render's free tier that endpoint cold-starts slower than 4s, so a
 * live call aborts into seasonal-naive on nearly every request. Computing nightly makes the
 * endpoint usable at all, and removes per-request forecast latency immediately even without it.
 *
 * RENDER FREE-TIER CAVEAT: a nightly cron only fires while the process is AWAKE. Render spins
 * the web service down after ~15 min idle and the timer dies with it — the same constraint
 * documented for COLLECTOR_CRON. This job is only reliable with KEEPALIVE_ENABLED=true AND an
 * external pinger on /api/health. The boot-delay run is the partial mitigation: every wake
 * repopulates the cache.
 */

// forecastRoute reasons that signal a transient/infra failure. Caching one would pin a
// "broken" state for a whole staleness window, so these are logged and skipped, never written.
const TRANSIENT_REASONS = new Set(['error', 'database_error', 'no_database']);

export class ForecastBatch {
  constructor({
    forecastService = defaultForecastService,
    forecastCache = defaultForecastCache,
    airports = AIRPORTS,
    now = () => new Date()
  } = {}) {
    this.forecastService = forecastService;
    this.forecastCache = forecastCache;
    this.airports = airports;
    this.now = now;
    this.isRunning = false;
    this.cursorIndex = 0;
    this.lastRun = null;
  }

  get homeAirports() {
    const raw = process.env.FORECAST_BATCH_HOME_AIRPORTS || process.env.COLLECTOR_HOME_AIRPORTS || 'TLV';
    return raw.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  }

  /**
   * The route universe. Same list the collector observes, so every batched route actually has
   * observations to forecast from: our own P1 var → the collector's list → VITE_FEATURED_HUBS
   * → (last resort) the whole catalog, matching fareCollector.destinationAirports exactly.
   */
  get destinationAirports() {
    const raw =
      process.env.FORECAST_BATCH_DESTINATIONS ||
      process.env.COLLECTOR_DESTINATIONS ||
      process.env.VITE_FEATURED_HUBS ||
      '';
    const configured = raw
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code && this.airports[code]);

    return configured.length > 0 ? configured : Object.keys(this.airports);
  }

  /** 0 (default) walks the whole list; any positive value makes the resume cursor meaningful. */
  get maxTasks() {
    return Math.max(0, Number(process.env.FORECAST_BATCH_MAX_TASKS || 0));
  }

  get currency() {
    return (process.env.FARE_CURRENCY || 'USD').toUpperCase();
  }

  /**
   * Forecasts one route and upserts the result, unless there is nothing honest to cache.
   *
   * @returns {Promise<{ok: boolean, reason?: string, route: string, verdict?: string|null}>}
   */
  async forecastOne(origin, destination) {
    const route = FareHistory.routeKey(origin, destination);
    const currency = this.currency;

    // No live quote is issued: the latest real observation is the zero-cost stand-in for
    // currentPrice (forecastBatch §3.2). A route with no history can only tier to
    // insufficient_history — there is nothing to serve, so skip and let the read path's live
    // fallback say so.
    const latest = await this.forecastCache.latestObservedPrice(route, currency);
    if (!latest) {
      console.log(`[forecastBatch] Skipped ${route}: no observation on record.`);
      return { ok: false, reason: 'no_observation', route };
    }

    const forecast = await this.forecastService.forecastRoute(origin, destination, latest.price, currency);

    if (TRANSIENT_REASONS.has(forecast.reason)) {
      console.warn(`[forecastBatch] Skipped ${route}: transient forecast reason "${forecast.reason}".`);
      return { ok: false, reason: 'transient', route };
    }

    // Store the lock actually in effect, or the observation's own provider when the lock is
    // off, so the row records which source the verdict was built from (observability only —
    // provider is not part of the key).
    const providerLock = (process.env.FORECAST_PROVIDER || process.env.FLIGHT_PROVIDER || '').trim();
    const provider =
      providerLock && providerLock !== 'simulated' && providerLock !== 'all'
        ? providerLock
        : latest.provider || null;

    await this.forecastCache.put(route, currency, forecast, {
      computedCurrentPrice: latest.price,
      provider
    });

    return { ok: true, route, verdict: forecast.verdict ?? null };
  }

  async run() {
    if (this.isRunning) {
      console.log('[forecastBatch] Run already in progress, skipping schedule trigger.');
      return;
    }

    this.isRunning = true;
    const homes = this.homeAirports;
    const destinations = this.destinationAirports;

    // A forecast is per route, not per departure date, so there is no horizon fan-out.
    const tasks = [];
    for (const origin of homes) {
      for (const destination of destinations) {
        if (destination === origin) continue;
        tasks.push({ origin, destination });
      }
    }

    if (tasks.length === 0) {
      this.isRunning = false;
      return;
    }

    // Bounded slice + resume cursor, exactly like the collector, so an interrupted run on a
    // restarting host resumes rather than restarts.
    const budget = this.maxTasks;
    const count = budget > 0 ? Math.min(budget, tasks.length) : tasks.length;

    console.log(`[forecastBatch] Starting run of ${count}/${tasks.length} routes from cursor ${this.cursorIndex}...`);

    let processed = 0;
    const outcomes = { buy: 0, wait: 0, nullVerdict: 0, no_observation: 0, transient: 0 };
    const startedAt = this.now();

    try {
      for (let i = 0; i < count; i++) {
        const idx = (this.cursorIndex + i) % tasks.length;
        const { origin, destination } = tasks[idx];

        let result;
        try {
          result = await this.forecastOne(origin, destination);
        } catch (err) {
          // A single route blowing up must not abort the sweep. Treat it as transient.
          console.warn(`[forecastBatch] Failed forecasting ${origin}-${destination}: ${err.message}`);
          result = { ok: false, reason: 'transient' };
        }

        if (result.ok) {
          if (result.verdict === 'BUY_NOW') outcomes.buy++;
          else if (result.verdict === 'WAIT') outcomes.wait++;
          else outcomes.nullVerdict++;
        } else {
          outcomes[result.reason] = (outcomes[result.reason] || 0) + 1;
        }
        processed++;
      }
    } finally {
      // Advance by what was actually done, so an interrupted run resumes rather than repeats.
      this.cursorIndex = (this.cursorIndex + processed) % tasks.length;

      const written = outcomes.buy + outcomes.wait + outcomes.nullVerdict;
      this.lastRun = {
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(this.now()).toISOString(),
        processed,
        written,
        ...outcomes
      };

      console.log(
        `[forecastBatch] Run done: ${written} written ` +
        `(${outcomes.buy} BUY, ${outcomes.wait} WAIT, ${outcomes.nullVerdict} null), ` +
        `${outcomes.no_observation} skipped (no observation), ` +
        `${outcomes.transient} skipped (transient) of ${processed} routes`
      );
    }

    this.isRunning = false;
  }
}

export function startForecastBatch(batch = new ForecastBatch()) {
  if (process.env.FORECAST_BATCH_ENABLED !== 'true') {
    return null;
  }

  const cronSchedule = process.env.FORECAST_BATCH_CRON || '0 2 * * *';
  console.log(`[forecastBatch] Scheduled with cron pattern: "${cronSchedule}"`);

  // Boot-delay run so a fresh deploy repopulates the cache without waiting for 02:00 — and,
  // on Render's free tier, so every wake repopulates it at all.
  setTimeout(() => {
    batch.run().catch((err) => {
      console.error(`[forecastBatch] Initial run error: ${err.message}`);
    });
  }, Number(process.env.FORECAST_BATCH_BOOT_DELAY_MS || 15000));

  return cron.schedule(cronSchedule, () => {
    batch.run().catch((err) => {
      console.error(`[forecastBatch] Scheduled run error: ${err.message}`);
    });
  });
}
