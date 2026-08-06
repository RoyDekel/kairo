import { TtlCache } from '../services/ttlCache.js';
import { AIRPORTS } from '../../shared/catalog.js';

const CACHE_TTL_MS = 15000; // 15 seconds
const openSkyCache = new TtlCache({ ttlMs: CACHE_TTL_MS });

const IATA_TO_ICAO = {
  'LY': 'ELY', // El Al
  '6H': 'ISR', // Israir
  'IZ': 'AIZ', // Arkia
  'CY': 'CYP', // Cyprus Airways
  'W6': 'WZZ', // Wizz Air
  'U8': 'TUS', // Tus Air
  'A3': 'AEE', // Aegean
  'FR': 'RYR', // Ryanair
  'LO': 'LOT', // LOT Polish Airlines
  'BA': 'BAW', // British Airways
  'AF': 'AFR', // Air France
  'DL': 'DAL', // Delta Air Lines
  'EK': 'UAE', // Emirates
  'JL': 'JAL', // Japan Airlines
  'IB': 'IBE', // Iberia
  'LH': 'DLH', // Lufthansa
  'KL': 'KLM', // KLM
  'TP': 'TAP', // TAP Air Portugal
  'AZ': 'ITY'  // ITA Airways
};

export class OpenSkyProvider {
  constructor({ now = () => Date.now(), cache = openSkyCache } = {}) {
    this.now = now;
    this.cache = cache;
  }

  /**
   * Normalizes the flight number IATA designator into ICAO callsign.
   */
  getFlightCallsign(flightNumber) {
    if (!flightNumber) return '';
    const normalized = String(flightNumber).replace(/\s+/g, '').toUpperCase();
    
    // Extract designator
    const iataCode = normalized.slice(0, 2);
    const digits = normalized.slice(2);
    const icaoCode = IATA_TO_ICAO[iataCode] || iataCode;
    return `${icaoCode}${digits}`;
  }

  /**
   * Fetches the live state vectors within a bounding box, filters by callsign,
   * and returns normalized telemetry data.
   */
  async getLiveTelemetry(flightNumber, originCode, destinationCode) {
    const origin = AIRPORTS[originCode?.toUpperCase()];
    const dest = AIRPORTS[destinationCode?.toUpperCase()];

    if (!origin || !dest) {
      console.warn(`[openSky] Missing coords for origin: ${originCode} or dest: ${destinationCode}`);
      return null;
    }

    const lat1 = origin.coords[0];
    const lon1 = origin.coords[1];
    const lat2 = dest.coords[0];
    const lon2 = dest.coords[1];

    // Bounding box with 2.5 degrees padding
    const lamin = Math.max(-90, Math.min(lat1, lat2) - 2.5);
    const lamax = Math.min(90, Math.max(lat1, lat2) + 2.5);
    const lomin = Math.max(-180, Math.min(lon1, lon2) - 2.5);
    const lomax = Math.min(180, Math.max(lon1, lon2) + 2.5);

    const cacheKey = `${lamin.toFixed(1)}|${lomin.toFixed(1)}|${lamax.toFixed(1)}|${lomax.toFixed(1)}`;
    let states = this.cache.get(cacheKey);

    if (!states) {
      const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          }
        });
        if (!resp.ok) {
          console.warn(`[openSky] HTTP error: ${resp.status} fetching bbox: ${cacheKey}`);
          return null;
        }
        const json = await resp.json();
        states = json?.states || [];
        this.cache.set(cacheKey, states);
      } catch (err) {
        console.warn(`[openSky] Fetch failed for bbox: ${cacheKey}: ${err.message}`);
        return null;
      }
    }

    if (!states || states.length === 0) return null;

    const targetCallsign = this.getFlightCallsign(flightNumber);

    // Search state vectors for matching callsign
    const matchedState = states.find(state => {
      const callsign = String(state[1] || '').trim().toUpperCase();
      return callsign === targetCallsign || callsign === flightNumber.replace(/\s+/g, '').toUpperCase();
    });

    if (!matchedState) return null;

    const lat = Number(matchedState[6]);
    const lon = Number(matchedState[5]);
    const altMeters = Number(matchedState[7] || 0);
    const speedMs = Number(matchedState[9] || 0);
    const heading = Number(matchedState[10] || 0);

    return {
      latitude: lat,
      longitude: lon,
      altitude: Math.round(altMeters * 3.28084),
      speed: Math.round(speedMs * 3.6),
      heading: Math.round(heading),
      status: matchedState[8] ? 'On Ground' : 'Airborne',
      source: 'live'
    };
  }
}

export const openSkyProvider = new OpenSkyProvider();
