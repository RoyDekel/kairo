import cron from 'node-cron';
import { FlightSearchService } from '../services/flightSearchService.js';
import { fareHistory as defaultFareHistory } from '../services/fareHistory.js';
import { cheapestFlight } from '../services/quoteCache.js';
import { evaluateAlerts } from './alertEvaluator.js';
import { AIRPORTS } from '../../shared/catalog.js';

const DEFAULT_HORIZONS = [14, 30, 60, 90];
const DEFAULT_NIGHTS = 7;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export class FareCollector {
  constructor({
    service = new FlightSearchService(),
    fareHistory = defaultFareHistory,
    airports = AIRPORTS,
    now = () => new Date()
  } = {}) {
    this.service = service;
    this.fareHistory = fareHistory;
    this.airports = airports;
    this.now = now;
    this.isRunning = false;
    this.cursorIndex = 0;

    /*
      Sweep outcomes, because until now they were invisible.

      sampleOne returned a bare `false` for "provider gave nothing" and for "provider
      threw", wrote no row, and incremented no counter. A sweep that recorded 22 of an
      intended 120 logged exactly the same as one that recorded 120.

      Measured on 6 Aug 2026, once COLLECTOR_DESTINATIONS had scoped the sweep to 30
      routes: three sweeps recorded 1.69, 2.80 and 2.80 observations per route against an
      intended 4.00 — a yield of 18%-58%. That is not a detail. The missing samples are
      what make the horizon mix wobble from day to day, and forecastService reads that
      wobble as price volatility.
    */
    this.lastSweep = null;
  }

  get homeAirports() {
    const raw = process.env.COLLECTOR_HOME_AIRPORTS || 'TLV';
    return raw.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
  }

  /**
   * Destinations to sample, and the reason this is not simply "the catalog".
   *
   * shared/catalog.js carries 3,269 airports. Crossed with one home and four horizons that
   * is 13,072 upstream searches per sweep — roughly 7.3 hours of pure sleep() before any
   * network time, against a reverse-engineered Google Flights endpoint that will start
   * refusing long before the sweep ends. It also spreads a fixed daily budget of requests
   * so thinly that no single route ever reaches MIN_OBS_FOR_FORECAST.
   *
   * A forecast needs depth on a few routes, not one observation each on thousands. Left
   * unset this falls back to VITE_FEATURED_HUBS, which is the list the UI already promotes.
   */
  get destinationAirports() {
    const raw = process.env.COLLECTOR_DESTINATIONS || process.env.VITE_FEATURED_HUBS || '';
    const configured = raw
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code && this.airports[code]);

    return configured.length > 0 ? configured : Object.keys(this.airports);
  }

  /**
   * Hard ceiling on tasks per sweep, so an interrupted sweep resumes instead of restarting.
   *
   * 0 means unlimited. Any positive value makes `cursorIndex` meaningful: the sweep stops
   * after N tasks and the next one picks up where this one stopped.
   */
  get maxTasksPerSweep() {
    return Math.max(0, Number(process.env.COLLECTOR_MAX_TASKS_PER_SWEEP || 0));
  }

  get horizons() {
    if (process.env.COLLECTOR_HORIZONS) {
      return process.env.COLLECTOR_HORIZONS.split(',').map(Number).filter(Boolean);
    }
    return DEFAULT_HORIZONS;
  }

  get delayMs() {
    return Number(process.env.COLLECTOR_DELAY_MS || 2000);
  }

  get nights() {
    return Number(process.env.COLLECTOR_NIGHTS || DEFAULT_NIGHTS);
  }

  async sampleOne(origin, destination, horizon) {
    const today = this.now();
    const depDate = addDays(today, horizon);
    const retDate = addDays(depDate, this.nights);

    const departureDate = formatDate(depDate);
    const returnDate = formatDate(retDate);

    try {
      const results = await this.service.searchFlights({
        origin,
        destination,
        departureDate,
        returnDate,
        passengers: { adults: 1, children: 0, infants: 0 },
        stops: '0',
        travelClass: '1'
      });

      const bestOutbound = cheapestFlight(results?.outbound || []);
      const bestReturn = cheapestFlight(results?.return || []);

      if (!bestOutbound || !bestReturn) {
        // Distinguished from a thrown error on purpose: "the provider answered, and the
        // answer was nothing" and "the provider refused us" call for opposite responses,
        // and lumping them together is how a rate-limit looks like an empty market.
        return { ok: false, reason: 'no_results' };
      }

      const roundtripPrice = Math.round(bestOutbound.price + bestReturn.price);
      const providerUsed = results.providerUsed || this.service.providerName;

      // Note: fareHistory.record will discard if providerUsed is 'simulated'
      const recorded = await this.fareHistory.record({
        origin,
        destination,
        departureDate,
        returnDate,
        roundtripPrice,
        provider: providerUsed,
        currency: results.currency || 'USD',
        collectedBy: 'collector'
      });

      if (recorded) {
        console.log(`[fareCollector] Sampled ${origin}-${destination} (+${horizon}d): $${roundtripPrice} (${providerUsed})`);
        return { ok: true, reason: 'recorded' };
      }

      // fareHistory.record rejects simulated providers and refuses to write without a
      // service key, and returns false either way. Both leave the table empty while the
      // sweep log looks healthy, so they get their own bucket.
      return { ok: false, reason: 'rejected_by_fare_history' };
    } catch (err) {
      console.warn(`[fareCollector] Failed sampling ${origin}-${destination} (+${horizon}d): ${err.message}`);
      return { ok: false, reason: 'provider_error' };
    }
  }

  async runSweep() {
    if (this.isRunning) {
      console.log('[fareCollector] Sweep already in progress, skipping schedule trigger.');
      return;
    }

    this.isRunning = true;
    const destinations = this.destinationAirports;
    const homes = this.homeAirports;
    const horizons = this.horizons;

    // Generate total task list
    const tasks = [];
    for (const origin of homes) {
      for (const destination of destinations) {
        if (destination === origin) continue;
        for (const horizon of horizons) {
          tasks.push({ origin, destination, horizon });
        }
      }
    }

    if (tasks.length === 0) {
      this.isRunning = false;
      return;
    }

    /*
      Take a bounded slice, not the whole list.

      The previous version always walked every task and then advanced the cursor by
      tasks.length — which is congruent to 0, so cursorIndex never moved and every sweep
      restarted at index 0. Harmless while a sweep always completed; not harmless on a host
      that restarts, because the collector would re-sample the same opening routes forever
      and the tail of the catalog would never be observed at all. The baseline would then be
      skewed by catalog order rather than by the market.
    */
    const budget = this.maxTasksPerSweep;
    const count = budget > 0 ? Math.min(budget, tasks.length) : tasks.length;

    console.log(`[fareCollector] Starting sweep of ${count}/${tasks.length} sampling tasks from cursor ${this.cursorIndex}...`);

    let processed = 0;
    const outcomes = { recorded: 0, no_results: 0, provider_error: 0, rejected_by_fare_history: 0 };
    const startedAt = this.now();

    try {
      for (let i = 0; i < count; i++) {
        const idx = (this.cursorIndex + i) % tasks.length;
        const { origin, destination, horizon } = tasks[idx];

        const result = await this.sampleOne(origin, destination, horizon);
        outcomes[result.reason] = (outcomes[result.reason] || 0) + 1;
        processed++;
        await sleep(this.delayMs);
      }
    } finally {
      // Advance by what was ACTUALLY done, so an interrupted sweep resumes rather than repeats.
      this.cursorIndex = (this.cursorIndex + processed) % tasks.length;

      const yieldPct = processed > 0 ? Math.round((outcomes.recorded / processed) * 100) : 0;
      this.lastSweep = {
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(this.now()).toISOString(),
        attempted: processed,
        ...outcomes,
        yieldPct
      };

      /*
        One line that answers "is the collector actually collecting?".

        Warn rather than log below half, because a sweep quietly discarding most of its
        samples still looks like a working collector in every other signal: the cron fires,
        rows appear, no exception is thrown. The yield is the only thing that says the
        baseline is being built out of whatever survived.
      */
      const summary =
        `[fareCollector] Sweep done: ${outcomes.recorded}/${processed} recorded (${yieldPct}% yield) — ` +
        `no_results=${outcomes.no_results} provider_error=${outcomes.provider_error} ` +
        `rejected=${outcomes.rejected_by_fare_history}`;
      if (yieldPct < 50) console.warn(`${summary}  <-- LOW YIELD`);
      else console.log(summary);
    }

    /*
      An opportunistic extra check against the fares this sweep just collected. NOT the
      mechanism alerts rely on: the loop above runs for hours, so this line is reached
      rarely. startAlertEvaluator() owns the schedule that actually matters.
    */
    try {
      await evaluateAlerts();
    } catch (err) {
      console.warn(`[fareCollector] Alert evaluation failed: ${err.message}`);
    }

    this.isRunning = false;
    console.log('[fareCollector] Sweep completed.');
  }
}

export function startFareCollector(collector = new FareCollector()) {
  if (process.env.COLLECTOR_ENABLED !== 'true') {
    return null;
  }

  const cronSchedule = process.env.COLLECTOR_CRON || '0 */6 * * *';
  console.log(`[fareCollector] Scheduled with cron pattern: "${cronSchedule}"`);

  // Run initial sweep asynchronously after boot delay
  setTimeout(() => {
    collector.runSweep().catch((err) => {
      console.error(`[fareCollector] Initial sweep error: ${err.message}`);
    });
  }, Number(process.env.COLLECTOR_BOOT_DELAY_MS || 5000));

  return cron.schedule(cronSchedule, () => {
    collector.runSweep().catch((err) => {
      console.error(`[fareCollector] Scheduled sweep error: ${err.message}`);
    });
  });
}
