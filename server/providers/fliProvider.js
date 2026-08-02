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
 * Google Flights via `@punitarani/fli` — the free provider.
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
 *
 * Google answers a cookieless request from an unfamiliar IP with the consent interstitial
 * instead of the RPC payload. The response is a normal HTTP 200 containing no WRB chunk,
 * so the library's parser returns null and this provider reports "No parseable response"
 * — which reads like a network fault and is nothing of the kind. That is the exact
 * failure seen from Render while the same code worked from a laptop, where Chrome had
 * long since accepted the consent and the cookie was already in the jar.
 *
 * SOCS is what Google itself sets once consent is recorded; CONSENT is the older form,
 * still honoured. Sending both costs nothing and covers either wall.
 */
const CONSENT_COOKIE = process.env.FLI_CONSENT_COOKIE
  || 'SOCS=CAESHAgBEhIaAB; CONSENT=YES+cb';

/**
 * The country Google is asked to price as (`gl=`).
 *
 * Also part of the consent story: EU-resolved requests hit a stricter wall than US ones.
 * Pinning this keeps the market consistent between runs as a side benefit — a fare
 * baseline assembled from a drifting `gl` measures geography as much as time.
 */
const SEARCH_COUNTRY = process.env.FLI_COUNTRY || 'US';

/**
 * A fetch that carries the consent cookies.
 *
 * `ClientOptions` exposes no header hook, but it does accept a `fetchImpl` test seam.
 * Using it here is a slight abuse of intent and by far the smallest change that works —
 * the alternative is forking the client or patching the package.
 */
function consentFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  const existing = headers.get('cookie');
  headers.set('cookie', existing ? `${existing}; ${CONSENT_COOKIE}` : CONSENT_COOKIE);
  return fetch(input, { ...init, headers });
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

    /*
      Fail loudly on an airport this provider cannot search.

      Returning [] here would be reported to the user as "no flights on this route" and
      cached as such, when the truth is that KAIRO never asked. The catalog and Google's
      enum are two different lists; where they disagree the search must fall through to
      another provider, and only a throw does that.
    */
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
   * Each leg is searched ONE_WAY on purpose. Google's round-trip response returns paired
   * itineraries whose price belongs to the pair, not to either leg — mapping that into
   * KAIRO's independent `outbound[]` / `return[]` lists (which server.js re-adds to form
   * a roundtrip total) would double-count the fare. Two one-way searches produce two
   * prices that are each individually true, which is what the rest of the app assumes.
   */
  async fetchLeg(from, to, travelDate, passengers, stops, travelClass) {
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

    // `null` means the response carried no WRB payload — Google answered with something
    // other than data. In practice that is the consent interstitial (see CONSENT_COOKIE)
    // or a bot check, NOT an empty result set, which arrives as an empty array. Naming
    // both possibilities here because the bare message reads like a network fault and
    // sent the last investigation looking at IP blocks for an hour.
    if (results === null) {
      throw new Error(
        `[fli] No parseable response for ${from} -> ${to} on ${travelDate} — ` +
        `Google returned a non-data page (consent wall or bot check), not a network error`
      );
    }

    // A ONE_WAY search yields FlightResult objects; the array form only appears for
    // multi-leg trips. Flatten defensively so a shape change upstream cannot silently
    // produce `undefined` legs.
    return results.flat();
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
   *
   * getDistance takes [lat, lon] PAIRS, not IATA codes. Passing codes destructures the
   * string ('TLV' -> lat 'T', lon 'L'), which makes every downstream figure NaN and
   * serialises to null over JSON. Unknown airports return null rather than a made-up
   * number, because distance drives the map arc and nothing good comes of guessing it.
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

    /*
      Drop the offer rather than price it.

      `FlightResult.price` is documented nullable: Google omits it for some itineraries.
      Substituting any value here — a constant, an average, a multiple of anything —
      manufactures a fare that FareHistory will accept as real. Fewer honest offers beat
      more offers of unknown provenance.
    */
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
      // Stable across calls: an id containing Date.now() churns React keys on every
      // render and can never be matched against a cached result.
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
      // String form, matching serpapiProvider and the simulated provider. The UI compares
      // against 'Direct' and renders this value straight into the card.
      stops: stopsCount <= 0 ? 'Direct' : `${stopsCount} stop${stopsCount > 1 ? 's' : ''}`,
      planeType: first.aircraft || null,
      terminal: `${from} → ${to}`,
      // Google does not report a baggage allowance on the shopping response. Null says so;
      // a hardcoded "1 carry-on + 1 checked bag" would assert an allowance that low-cost
      // carriers do not include and charge for.
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
