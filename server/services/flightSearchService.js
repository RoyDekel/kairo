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

    const { name, reason } = this.determineActiveProvider();
    this.activeProviderName = name;
    this.selectionReason = reason;
    this.activeProvider = this.providers[name] || this.providers.simulated;

    console.log(`===============================================`);
    console.log(` FlightSearchService Initialized`);
    console.log(` Active Strategy Provider: [${this.activeProviderName.toUpperCase()}]`);
    console.log(` Reason: ${reason}`);
    if (this.activeProviderName === 'simulated') {
      console.warn(' WARNING: every fare served will be INVENTED. No observation will be');
      console.warn(' recorded, because FareHistory rejects simulated quotes. The app will');
      console.warn(' look completely normal while doing this.');
    }
    console.log(`===============================================`);
  }

  /**
   * Picks the provider AND says why.
   *
   * The reason string exists because the failure this hides is expensive: a
   * FLIGHT_PROVIDER left over in the deploy environment silently outranks FLI_ENABLED, so
   * the free provider is installed, configured, tested and never called — and the only
   * visible symptom is that everything looks fine. Printing the deciding rule turns a
   * multi-hour investigation into one line of the deploy log.
   *
   * @returns {{name: string, reason: string}}
   */
  determineActiveProvider() {
    const configProvider = process.env.FLIGHT_PROVIDER;

    // 1. Explicitly configured provider choice — outranks everything below.
    if (configProvider && this.providers[configProvider.toLowerCase()]) {
      const name = configProvider.toLowerCase();
      let reason = `FLIGHT_PROVIDER=${configProvider} set explicitly`;
      if (name !== 'fli' && process.env.FLI_ENABLED === 'true') {
        reason += ' — NOTE: this overrides FLI_ENABLED=true, so the free provider is idle.'
                + ' Unset FLIGHT_PROVIDER to let autodetect choose fli.';
      }
      return { name, reason };
    }

    if (configProvider) {
      console.warn(
        `[FlightSearchService] FLIGHT_PROVIDER='${configProvider}' is not a known provider ` +
        `(${Object.keys(this.providers).join(', ')}). Ignoring it and autodetecting.`
      );
    }

    // 2. The free provider, when switched on. Tried before the paid ones on purpose.
    if (process.env.FLI_ENABLED === 'true') {
      return { name: 'fli', reason: 'FLI_ENABLED=true (free provider, no API key needed)' };
    }

    if (process.env.FLI_ENABLED) {
      console.warn(
        `[FlightSearchService] FLI_ENABLED='${process.env.FLI_ENABLED}' is not the string ` +
        `'true', so the free provider stays off. This comparison is exact: 1, yes and TRUE ` +
        `do not count.`
      );
    }

    // 3. Autodetect from whichever paid credential is present.
    if (process.env.SERPAPI_KEY && process.env.SERPAPI_KEY.trim() !== '') {
      return { name: 'serpapi', reason: 'SERPAPI_KEY present and FLI_ENABLED is not "true" (this provider bills per search)' };
    }

    if (process.env.KIWI_API_KEY && process.env.KIWI_API_KEY.trim() !== '') {
      return { name: 'kiwi', reason: 'KIWI_API_KEY present' };
    }

    if (process.env.TRAVELPAYOUTS_TOKEN && process.env.TRAVELPAYOUTS_TOKEN.trim() !== '') {
      return { name: 'travelpayouts', reason: 'TRAVELPAYOUTS_TOKEN present' };
    }

    // 4. Nothing configured.
    return { name: 'simulated', reason: 'no provider configured — set FLI_ENABLED=true for free real fares' };
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
