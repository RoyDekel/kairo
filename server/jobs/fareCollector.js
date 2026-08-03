import cron from 'node-cron';
import { FlightSearchService } from '../services/flightSearchService.js';
import { fareHistory as defaultFareHistory } from '../services/fareHistory.js';
import { cheapestFlight } from '../services/quoteCache.js';
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
  }

  get homeAirports() {
    const raw = process.env.COLLECTOR_HOME_AIRPORTS || 'TLV';
    return raw.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean);
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
        return false;
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
      }
      return recorded;
    } catch (err) {
      console.warn(`[fareCollector] Failed sampling ${origin}-${destination} (+${horizon}d): ${err.message}`);
      return false;
    }
  }

  async runSweep() {
    if (this.isRunning) {
      console.log('[fareCollector] Sweep already in progress, skipping schedule trigger.');
      return;
    }

    this.isRunning = true;
    const destinations = Object.keys(this.airports);
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

    console.log(`[fareCollector] Starting sweep of ${tasks.length} sampling tasks from cursor ${this.cursorIndex}...`);

    for (let i = 0; i < tasks.length; i++) {
      const idx = (this.cursorIndex + i) % tasks.length;
      const { origin, destination, horizon } = tasks[idx];

      await this.sampleOne(origin, destination, horizon);
      await sleep(this.delayMs);
    }

    // Advance cursor so next sweep continues seamlessly
    this.cursorIndex = (this.cursorIndex + tasks.length) % tasks.length;
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
