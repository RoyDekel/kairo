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
   * Breadth-first pricing for discovery.
   *
   * Uses a real provider when ESTIMATES_USE_REAL_PROVIDER=true or FLI_ENABLED=true,
   * falling back safely to simulated results.
   */
  async estimateFlights(searchRequest) {
    const useRealProvider =
      process.env.ESTIMATES_USE_REAL_PROVIDER === 'true' ||
      (this.activeProviderName !== 'simulated' && process.env.FLI_ENABLED === 'true');

    if (useRealProvider) {
      try {
        const results = await this.activeProvider.searchAsync(searchRequest);
        if (results && ((results.outbound && results.outbound.length > 0) || (results.return && results.return.length > 0))) {
          return { ...results, providerUsed: this.activeProviderName };
        }
      } catch (err) {
        console.warn(`[FlightSearchService] Real provider estimate failed for ${searchRequest.origin}->${searchRequest.destination}: ${err.message}`);
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
