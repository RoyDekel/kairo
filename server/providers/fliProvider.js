import {
  Airport,
  AIRLINE_NAMES,
  Client,
  FlightSearchFilters,
  FlightSegment,
  MaxStops,
  SearchFlights,
  SeatType,
  SortBy,
  TripType
} from '@punitarani/fli';
import { FlightProvider } from './flightProvider.js';
import {
  AIRPORTS,
  getDistance,
  calculatePassengerCost
} from './constants.js';

/**
 * Google Flights via `@punitarani/fli` and Google Flights HTML Web Scraper.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS PROVIDER EXISTS
 *
 * SerpApi bills per search, which is why `estimateFlights()` was hardwired to the
 * simulated provider and the whole discovery page quoted invented prices. This provider
 * costs nothing per call, so real fares can back the discovery page and — more
 * importantly — the fare_observations baseline that every "below the usual price" claim
 * depends on.
 *
 * -------------------------------------------------------------------------------------
 * THE RULE THIS FILE MUST NOT BREAK
 *
 * Everything returned from here is written to `fare_observations` by server.js under a
 * non-simulated provider name, which means FareHistory ACCEPTS it. There is no
 * downstream guard. A fabricated number invented here becomes indistinguishable from a
 * real quote for the lifetime of the table.
 *
 * Concretely:
 *
 *   1. `FlightResult.price` is nullable — Google does not always surface a price
 *      (premium-cabin round trips, notably). An offer with no price is DROPPED. It is
 *      never defaulted, never estimated, never substituted with a constant.
 *   2. `price` is the PER-OFFER fare, matching serpapiProvider.mapSerpApiToFlight.
 *      The per-passenger breakdown lives in `passengerCosts`. Putting the passenger
 *      total in `price` would make rows from this provider incomparable with rows from
 *      SerpApi, and the median in FareHistory would be measuring party size.
 *   3. Failures THROW. FlightSearchService only falls back to the simulated provider on
 *      a thrown error; returning `{outbound: [], return: []}` reads as a successful
 *      empty result, which server.js then writes to flightSearchCache and serves for
 *      the full TTL. An empty array must never be used to signal a failure.
 * -------------------------------------------------------------------------------------
 */

/** KAIRO's `travelClass` query param uses the same integers Google does. */
const SEAT_BY_TRAVEL_CLASS = {
  1: SeatType.ECONOMY,
  2: SeatType.PREMIUM_ECONOMY,
  3: SeatType.BUSINESS,
  4: SeatType.FIRST
};

/**
 * KAIRO's `stops` query param counts stops; Google's enum counts "at most N".
 * '0' is KAIRO's "no preference" sentinel, not "non-stop" — /api/flights defaults it to
 * '0' on every search, so reading it as NON_STOP would silently hide connecting flights
 * from every user who never touched the filter.
 */
const MAX_STOPS_BY_PARAM = {
  0: MaxStops.ANY,
  1: MaxStops.ONE_STOP_OR_FEWER,
  2: MaxStops.TWO_OR_FEWER_STOPS
};

/** Ceiling on offers mapped per leg. Google returns far more than the UI can show. */
const MAX_OFFERS_PER_LEG = 20;

/**
 * Consent cookies, sent on every request.
 */
const CONSENT_COOKIE = process.env.FLI_CONSENT_COOKIE
  || 'SOCS=CAESHAgBEhIaAB; CONSENT=YES+cb';

/**
 * The country Google is asked to price as (`gl=`).
 */
const SEARCH_COUNTRY = process.env.FLI_COUNTRY || 'US';

/**
 * A fetch that carries the consent cookies.
 */
function consentFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  const existing = headers.get('cookie');
  headers.set('cookie', existing ? `${existing}; ${CONSENT_COOKIE}` : CONSENT_COOKIE);
  return fetch(input, { ...init, headers });
}

function parseTimeArray(arr, fallback = [0, 0]) {
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  const hour = typeof arr[0] === 'number' ? arr[0] : 0;
  const min = typeof arr[1] === 'number' ? arr[1] : 0;
  return [hour, min];
}

export class FliProvider extends FlightProvider {
  constructor({ search = null, currency = null } = {}) {
    super();
    this.id = 'fli';
    this.name = 'Google Flights (fli)';
    // Injectable so tests exercise the mapping without reaching Google.
    this.search = search || new SearchFlights(new Client({ fetchImpl: consentFetch }));
    this.currency = (currency || process.env.FARE_CURRENCY || 'USD').toUpperCase();
  }

  async searchAsync(searchRequest) {
    const {
      origin,
      destination,
      departureDate,
      returnDate,
      passengers = { adults: 1, children: 0, infants: 0 },
      stops = '0',
      travelClass = '1'
    } = searchRequest;

    const originCode = String(origin || '').toUpperCase();
    const destinationCode = String(destination || '').toUpperCase();

    this.assertSupported(originCode, 'origin');
    this.assertSupported(destinationCode, 'destination');

    const [outboundOffers, returnOffers] = await Promise.all([
      this.fetchLeg(originCode, destinationCode, departureDate, passengers, stops, travelClass),
      returnDate
        ? this.fetchLeg(destinationCode, originCode, returnDate, passengers, stops, travelClass)
        : Promise.resolve([])
    ]);

    return {
      outbound: this.mapOffers(outboundOffers, 'outbound', originCode, destinationCode, passengers),
      return: this.mapOffers(returnOffers, 'return', destinationCode, originCode, passengers),
      currency: this.currency
    };
  }

  assertSupported(code, role) {
    if (!Airport[code]) {
      throw new Error(`[fli] Unsupported ${role} airport code: ${code || '(empty)'}`);
    }
  }

  /**
   * One directional leg.
   *
   * Tries RPC search via @punitarani/fli first; falls back seamlessly to HTML pre-rendered search
   * if Google returns RPC consent / bot-check null responses in cloud host environments.
   */
  async fetchLeg(from, to, travelDate, passengers, stops, travelClass) {
    let rpcError = null;
    try {
      const filters = new FlightSearchFilters({
        trip_type: TripType.ONE_WAY,
        passenger_info: {
          adults: Math.max(1, Number(passengers?.adults) || 1),
          children: Math.max(0, Number(passengers?.children) || 0),
          infants_in_seat: Math.max(0, Number(passengers?.infants) || 0),
          infants_on_lap: 0
        },
        flight_segments: [
          new FlightSegment({
            departure_airport: [[[Airport[from], 0]]],
            arrival_airport: [[[Airport[to], 0]]],
            travel_date: travelDate
          })
        ],
        seat_type: SEAT_BY_TRAVEL_CLASS[Number(travelClass)] || SeatType.ECONOMY,
        stops: MAX_STOPS_BY_PARAM[Number(stops)] ?? MaxStops.ANY,
        sort_by: SortBy.CHEAPEST
      });

      const results = await this.search.search(filters, {
        currency: this.currency,
        country: SEARCH_COUNTRY,
        language: 'en-US',
        topN: MAX_OFFERS_PER_LEG
      });

      if (results === null) {
        throw new Error(
          `[fli] No parseable response for ${from} -> ${to} on ${travelDate} — ` +
          `Google returned a non-data page (consent wall or bot check), not a network error`
        );
      }

      if (Array.isArray(results) && results.length > 0) {
        return results.flat();
      }
    } catch (err) {
      rpcError = err;
      console.warn(`[fli] RPC search failed for ${from}->${to} on ${travelDate}: ${err.message}. Attempting HTML Web Scraper fallback.`);
    }

    // Try HTML Web Scraper Fallback
    try {
      return await this.fetchLegHtml(from, to, travelDate);
    } catch (htmlErr) {
      if (rpcError) {
        throw rpcError;
      }
      throw htmlErr;
    }
  }

  /**
   * Recursively scans Google Flights `ds:1` payload tree to collect all valid flight offers
   * across both "Top flights" and "Other departing flights" sections.
   */
  collectAllOffers(node, rawOffers = []) {
    if (!Array.isArray(node)) return rawOffers;

    if (node.length >= 2 && Array.isArray(node[0]) && node[0].length >= 10) {
      const leg = node[0];
      const priceInfo = node[1];
      if (typeof leg[0] === 'string' && Array.isArray(leg[1]) && leg[1].length > 0) {
        if (Array.isArray(priceInfo) && priceInfo[0] && Array.isArray(priceInfo[0]) && typeof priceInfo[0][1] === 'number') {
          rawOffers.push(node);
          return rawOffers; // do not recurse deeper inside a matched offer
        }
      }
    }

    for (const child of node) {
      this.collectAllOffers(child, rawOffers);
    }

    return rawOffers;
  }

  /**
   * Scrapes Google Flights HTML for pre-rendered search results (ds:1 block).
   * Bypasses Google RPC bot checks and consent walls in cloud environments (Render, AWS, GCP).
   */
  async fetchLegHtml(from, to, travelDate) {
    const url = `https://www.google.com/travel/flights?q=Flights+from+${from}+to+${to}+on+${travelDate}&curr=${this.currency}&hl=en&gl=${SEARCH_COUNTRY}`;
    const resp = await consentFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!resp.ok) {
      throw new Error(`[fli] Google Flights HTML returned HTTP ${resp.status} for ${from}->${to}`);
    }

    const html = await resp.text();
    const matches = [...html.matchAll(/AF_initDataCallback\s*\(/g)];
    let parsedData = null;

    for (const m of matches) {
      const pos = m.index;
      const snippet = html.slice(pos, pos + 300);
      if (snippet.includes("key:'ds:1'") || snippet.includes('key: "ds:1"') || snippet.includes("'ds:1'")) {
        const dataIdx = html.indexOf('data:', pos);
        if (dataIdx === -1) continue;
        const startPos = dataIdx + 5;
        const endMarker = html.indexOf(', sideChannel:', startPos);
        if (endMarker === -1) continue;
        const rawJson = html.slice(startPos, endMarker).trim();
        try {
          parsedData = JSON.parse(rawJson);
          break;
        } catch (e) {
          // Ignore parse errors on partial matches
        }
      }
    }

    if (!parsedData) {
      throw new Error(`[fli] No parseable response for ${from} -> ${to} on ${travelDate}`);
    }

    const rawOffers = this.collectAllOffers(parsedData);
    const offers = [];

    for (const offer of rawOffers) {
      if (!Array.isArray(offer) || offer.length < 2) continue;
      const leg = offer[0];
      const priceInfo = offer[1];

      if (!Array.isArray(leg) || leg.length < 10) continue;

      let price = null;
      if (Array.isArray(priceInfo) && priceInfo[0] && Array.isArray(priceInfo[0]) && typeof priceInfo[0][1] === 'number') {
        price = priceInfo[0][1];
      }
      if (!price || price <= 0) continue;

      const airlineCode = typeof leg[0] === 'string' ? leg[0] : '';
      const airlineName = Array.isArray(leg[1]) && leg[1][0] ? leg[1][0] : airlineCode;

      const rawSegments = Array.isArray(leg[2]) ? leg[2] : [];
      // TRUE stops count: number of segments minus 1 (e.g. 2 segments = 1 stop, 1 segment = 0 / Direct)
      const stopsCount = Math.max(0, rawSegments.length - 1);
      const durationMins = typeof leg[9] === 'number' ? leg[9] : null;

      const [year, month, day] = travelDate.split('-').map(Number);
      const depT = parseTimeArray(leg[5]);
      const arrT = parseTimeArray(leg[8]);

      const mappedLegs = rawSegments.length > 0 ? rawSegments.map((seg) => {
        if (!Array.isArray(seg)) return null;
        const segFrom = seg[3] || from;
        const segTo = seg[6] || to;
        const segAirline = seg[0] || airlineCode;

        let segFlightNum = '';
        if (Array.isArray(seg[22]) && seg[22].length > 1) {
          segFlightNum = String(seg[22][1]);
        }
        let segAircraft = null;
        if (typeof seg[17] === 'string') {
          segAircraft = seg[17];
        }

        const segDepT = parseTimeArray(seg[8], depT);
        const segArrT = parseTimeArray(seg[10], arrT);

        const segDepDate = new Date(Date.UTC(year, month - 1, day, segDepT[0], segDepT[1]));
        const segArrDate = new Date(Date.UTC(year, month - 1, day, segArrT[0], segArrT[1]));
        if (segArrDate < segDepDate) {
          segArrDate.setUTCDate(segArrDate.getUTCDate() + 1);
        }

        return {
          airline: segAirline,
          flight_number: segFlightNum,
          aircraft: segAircraft,
          departure_airport: segFrom,
          arrival_airport: segTo,
          departure_datetime: segDepDate,
          arrival_datetime: segArrDate
        };
      }).filter(Boolean) : [
        {
          airline: airlineCode,
          flight_number: '',
          aircraft: null,
          departure_airport: from,
          arrival_airport: to,
          departure_datetime: new Date(Date.UTC(year, month - 1, day, depT[0], depT[1])),
          arrival_datetime: new Date(Date.UTC(year, month - 1, day, arrT[0], arrT[1]))
        }
      ];

      offers.push({
        price,
        currency: this.currency,
        duration: durationMins,
        stops: stopsCount,
        primary_airline: airlineCode,
        primary_airline_name: airlineName,
        legs: mappedLegs
      });
    }

    return offers;
  }

  mapOffers(offers, direction, from, to, passengers) {
    const distance = this.distanceBetween(from, to);
    return offers
      .map((offer) => this.mapToFlight(offer, direction, from, to, distance, passengers))
      .filter(Boolean)
      .slice(0, MAX_OFFERS_PER_LEG);
  }

  /**
   * Great-circle distance between two catalog airports.
   */
  distanceBetween(from, to) {
    const a = AIRPORTS[from];
    const b = AIRPORTS[to];
    if (!a?.coords || !b?.coords) return null;
    return getDistance(a.coords, b.coords);
  }

  mapToFlight(offer, direction, from, to, distance, passengers) {
    if (!offer) return null;

    const legs = Array.isArray(offer.legs) ? offer.legs : [];
    const first = legs[0];
    const last = legs[legs.length - 1];
    if (!first || !last) return null;

    const price = Number(offer.price);
    if (!Number.isFinite(price) || price <= 0) return null;

    const perOfferPrice = Math.round(price);
    const passengerCosts = calculatePassengerCost(perOfferPrice, passengers);

    const durationMins = Number.isFinite(offer.duration) ? offer.duration : null;
    const stopsCount = Number.isFinite(offer.stops) ? offer.stops : Math.max(0, legs.length - 1);

    const airlineCode = first.airline || offer.primary_airline || '';
    const airlineName =
      offer.primary_airline_name ||
      AIRLINE_NAMES?.[airlineCode] ||
      airlineCode ||
      'Unknown airline';

    const departureDateStr = this.isoDate(first.departure_datetime);

    return {
      id: `FLI-${from}-${to}-${airlineCode}${first.flight_number || ''}-${direction}-${departureDateStr}`,
      flightNumber: `${airlineCode} ${first.flight_number || ''}`.trim(),
      airlineCode,
      airlineName,
      airlineLogo: '',
      departureTime: this.hhmm(first.departure_datetime),
      arrivalTime: this.hhmm(last.arrival_datetime),
      duration: durationMins === null ? null : this.formatMinutes(durationMins),
      durationVal: durationMins === null ? null : durationMins / 60,
      price: perOfferPrice,
      passengerCosts,
      cabinClass: 'Economy',
      stops: stopsCount <= 0 ? 'Direct' : `${stopsCount} stop${stopsCount > 1 ? 's' : ''}`,
      planeType: first.aircraft || null,
      terminal: `${from} → ${to}`,
      baggage: null,
      reliability: null,
      seatsRemaining: null,
      direction,
      origin: from,
      destination: to,
      distance,
      currency: offer.currency || this.currency,
      bookingToken: offer.booking_token || null,
      co2EmissionsG: Number.isFinite(offer.co2_emissions_g) ? offer.co2_emissions_g : null
    };
  }

  formatMinutes(mins) {
    return `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;
  }

  hhmm(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  isoDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return 'unknown';
    return d.toISOString().slice(0, 10);
  }
}
