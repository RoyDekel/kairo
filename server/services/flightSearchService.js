import { SimulatedProvider } from '../providers/simulatedProvider.js';
import { KiwiProvider } from '../providers/kiwiProvider.js';
import { TravelPayoutsProvider } from '../providers/travelpayoutsProvider.js';
import { SerpApiProvider } from '../providers/serpapiProvider.js';
import { FliProvider } from '../providers/fliProvider.js';

export class FlightSearchService {
  constructor() {
    this.providers = {
      simulated: new SimulatedProvider(),
      kiwi: new KiwiProvider(),
      travelpayouts: new TravelPayoutsProvider(),
      serpapi: new SerpApiProvider(),
      fli: new FliProvider()
    };

    this.activeProviderName = this.determineActiveProvider();
    this.activeProvider = this.providers[this.activeProviderName] || this.providers.simulated;

    console.log(`===============================================`);
    console.log(` FlightSearchService Initialized`);
    console.log(` Active Strategy Provider: [${this.activeProviderName.toUpperCase()}]`);
    console.log(`===============================================`);
  }

  determineActiveProvider() {
    const configProvider = process.env.FLIGHT_PROVIDER;

    // 1. Explicitly configured provider choice
    if (configProvider && this.providers[configProvider.toLowerCase()]) {
      return configProvider.toLowerCase();
    }

    // 2. Free open-source fli engine when enabled
    if (process.env.FLI_ENABLED === 'true') {
      return 'fli';
    }

    // 3. Autodetect based on available API Keys
    if (process.env.SERPAPI_KEY && process.env.SERPAPI_KEY.trim() !== '') {
      return 'serpapi';
    }

    if (process.env.KIWI_API_KEY && process.env.KIWI_API_KEY.trim() !== '') {
      return 'kiwi';
    }

    if (process.env.TRAVELPAYOUTS_TOKEN && process.env.TRAVELPAYOUTS_TOKEN.trim() !== '') {
      return 'travelpayouts';
    }

    // 4. Fallback
    return 'simulated';
  }

  /** Name of the provider currently serving real searches (e.g. 'fli', 'serpapi', 'simulated'). */
  get providerName() {
    return this.activeProviderName;
  }

  /**
   * Breadth-first pricing for the discovery page.
   *
   * Historically this always used the simulated provider, because the paid providers bill
   * per search and "When to Go" prices ~31 destinations at once. A free provider removes
   * the cost, not the load: one discovery search still becomes ~31 upstream searches.
   *
   * ESTIMATES_USE_REAL_PROVIDER is therefore its OWN flag, deliberately independent of
   * whichever provider is active. Deriving it from FLI_ENABLED would mean switching the
   * provider on also switches the fan-out on, and there would be no way to keep one
   * without the other when the fan-out turns out to be the thing that breaks.
   *
   * `providerUsed` is returned so the caller can label `source` honestly instead of
   * assuming. Callers MUST NOT report an estimate as a live quote.
   */
  async estimateFlights(searchRequest) {
    const useRealProvider =
      process.env.ESTIMATES_USE_REAL_PROVIDER === 'true' &&
      this.activeProviderName !== 'simulated';

    if (useRealProvider) {
      try {
        const results = await this.activeProvider.searchAsync(searchRequest);
        if (results?.outbound?.length || results?.return?.length) {
          return { ...results, providerUsed: this.activeProviderName };
        }
        // An empty result from a working provider is a real answer ("nothing found"),
        // but the discovery page needs a number for the card. Fall through to the
        // simulated estimate, which the caller will label as an estimate.
      } catch (err) {
        console.warn(
          `[FlightSearchService] Real provider estimate failed for ` +
          `${searchRequest.origin}->${searchRequest.destination}: ${err.message}`
        );
      }
    }

    const simResults = await this.providers.simulated.searchAsync(searchRequest);
    return { ...simResults, providerUsed: 'simulated' };
  }

  async searchFlights(searchRequest) {
    try {
      console.log(`[FlightSearchService] Delegating search to provider: ${this.activeProviderName.toUpperCase()}`);
      return await this.activeProvider.searchAsync(searchRequest);
    } catch (error) {
      console.error(`[FlightSearchService] Strategy [${this.activeProviderName.toUpperCase()}] failed:`, error.message || error);

      // Error boundary: fallback to local simulation
      if (this.activeProviderName !== 'simulated') {
        console.warn(`[FlightSearchService] Falling back to SIMULATED strategy provider to guarantee service availability.`);
        try {
          const results = await this.providers.simulated.searchAsync(searchRequest);
          return {
            ...results,
            warning: `${this.activeProviderName.toUpperCase()} provider error. Displaying simulated backup flights.`
          };
        } catch (simError) {
          console.error(`[FlightSearchService] Fallback provider also failed:`, simError);
          throw simError;
        }
      }

      throw error;
    }
  }
}
