/**
 * @vitest-environment node
 *
 * Server-side suite. `@punitarani/fli` talks to Google over Node's HTTP stack; running it
 * inside jsdom means every request is routed through jsdom's XHR shim, which does not
 * terminate here and hangs the run. The provider never executes in a browser anyway.
 */
import { describe, test, expect, vi } from 'vitest';
import { FliProvider } from '../../../server/providers/fliProvider.js';
import { FlightSearchService } from '../../../server/services/flightSearchService.js';
import { AIRPORTS, getDistance } from '../../../shared/catalog.js';

/**
 * Contract tests for the free Google Flights provider.
 *
 * Each of these locks in a property a previous implementation broke, and every one of
 * those breaks was invisible in normal use: the app kept rendering, the suite kept
 * passing, and the damage landed in `fare_observations` — where a fabricated row is
 * indistinguishable from a real one and therefore cannot be cleaned up afterwards.
 *
 * The provider is the last point at which a number can be invented before FareHistory
 * accepts it as a real quote. That boundary is what these tests defend.
 */

/** A FlightLeg in the shape `@punitarani/fli` returns. */
const leg = (over = {}) => ({
  airline: 'LY',
  flight_number: '381',
  departure_airport: 'TLV',
  arrival_airport: 'BCN',
  departure_datetime: new Date('2026-10-15T06:20:00'),
  arrival_datetime: new Date('2026-10-15T09:50:00'),
  duration: 270,
  aircraft: 'Boeing 787-9',
  ...over
});

/** A FlightResult in the shape `@punitarani/fli` returns. */
const offer = (over = {}) => ({
  legs: [leg()],
  price: 412,
  currency: 'USD',
  duration: 270,
  stops: 0,
  primary_airline: 'LY',
  primary_airline_name: 'EL AL Israel Airlines',
  booking_token: 'tok_1',
  ...over
});

/** Provider wired to a stubbed search client, so no test reaches Google. */
const providerReturning = (results) =>
  new FliProvider({
    search: { search: vi.fn().mockResolvedValue(results) },
    currency: 'USD'
  });

const request = {
  origin: 'TLV',
  destination: 'BCN',
  departureDate: '2026-10-15',
  returnDate: '',
  passengers: { adults: 1, children: 0, infants: 0 },
  stops: '0',
  travelClass: '1'
};

describe('FliProvider — fares must never be invented', () => {
  /*
    An earlier implementation used `totalPrice > 0 ? totalPrice : 200`, so any itinerary
    Google did not price became a $200 fare. server.js wrote it to fare_observations under
    provider 'fli' — not 'simulated', so FareHistory accepted it. Every "cheaper than 80%
    of the fares we have seen" claim would then have been measured partly against a
    constant nobody was ever quoted.
  */
  test('drops offers with no price instead of substituting one', async () => {
    const provider = providerReturning([
      offer({ price: null }),
      offer({ price: 412, booking_token: 'tok_2' })
    ]);

    const { outbound } = await provider.searchAsync(request);

    expect(outbound).toHaveLength(1);
    expect(outbound[0].price).toBe(412);
  });

  test('returns nothing rather than a priced flight when no offer has a price', async () => {
    const provider = providerReturning([offer({ price: null }), offer({ price: 0 })]);

    const { outbound } = await provider.searchAsync(request);

    expect(outbound).toEqual([]);
  });

  /*
    `price` must remain the PER-OFFER fare, as serpapiProvider emits it. An earlier version
    assigned `passengerCosts.total`, so a 2-adult search recorded twice what a 1-adult
    search recorded for the identical flight. Mixed into one table, the median stops
    describing the market and starts describing party size.
  */
  test('price is the per-offer fare, not the passenger total', async () => {
    const provider = providerReturning([offer({ price: 412 })]);

    const { outbound } = await provider.searchAsync({
      ...request,
      passengers: { adults: 2, children: 1, infants: 0 }
    });

    expect(outbound[0].price).toBe(412);
    // The party breakdown lives here, and only here.
    expect(outbound[0].passengerCosts.total).toBe(412 * 2 + Math.round(412 * 0.75));
  });
});

describe('FliProvider — failure must be distinguishable from emptiness', () => {
  /*
    FlightSearchService falls back to the simulated provider only when the active provider
    THROWS. An earlier implementation caught everything and returned {outbound: [], return:
    []}, which reads as a successful empty result: the fallback never fired, the user was
    told there were no flights, and server.js wrote that emptiness to flightSearchCache
    (`results.warning` is undefined) and served it for the full TTL.

    The test that shipped with that implementation asserted the empty return as correct,
    which is why the suite stayed green.
  */
  test('throws on an airport the provider cannot search', async () => {
    const provider = providerReturning([offer()]);

    await expect(
      provider.searchAsync({ ...request, destination: 'ZZZ' })
    ).rejects.toThrow(/Unsupported destination airport code: ZZZ/);
  });

  test('throws when the upstream search returns no parseable response', async () => {
    const provider = providerReturning(null);

    await expect(provider.searchAsync(request)).rejects.toThrow(/No parseable response/);
  });

  test('propagates an upstream error rather than swallowing it', async () => {
    const provider = new FliProvider({
      search: { search: vi.fn().mockRejectedValue(new Error('Could not reach Google Flights')) },
      currency: 'USD'
    });

    await expect(provider.searchAsync(request)).rejects.toThrow(/Could not reach Google Flights/);
  });

  test('a thrown provider error is propagated loudly without fallback', async () => {
    const service = new FlightSearchService();
    service.activeProviderName = 'fli';
    service.activeProvider = {
      searchAsync: vi.fn().mockRejectedValue(new Error('[fli] upstream down'))
    };

    await expect(service.searchFlights(request)).rejects.toThrow('[fli] upstream down');
  });
});

describe('FliProvider — distance', () => {
  /*
    getDistance destructures [lat, lon] pairs. Handing it IATA strings makes lat 'T' and
    lon 'L', every arithmetic result NaN, and every JSON field null — silently, on every
    flight, with no error raised anywhere.
  */
  test('computes a real great-circle distance from catalog coordinates', async () => {
    const provider = providerReturning([offer()]);

    const { outbound } = await provider.searchAsync(request);

    const expected = getDistance(AIRPORTS.TLV.coords, AIRPORTS.BCN.coords);
    expect(outbound[0].distance).toBe(expected);
    expect(Number.isFinite(outbound[0].distance)).toBe(true);
    expect(expected).toBeGreaterThan(2000);
  });
});

describe('FliProvider — field contract with serpapiProvider', () => {
  /*
    Both providers feed the same components. A field that changes type between them is a
    rendering bug that only surfaces once the provider is switched in production: an object
    where a string was expected throws inside React, a number where a formatted string was
    expected renders as a bare digit.
  */
  test('emits the field shapes the rest of the app already expects', async () => {
    const provider = providerReturning([offer({ stops: 0 })]);

    const [flight] = (await provider.searchAsync(request)).outbound;

    expect(typeof flight.id).toBe('string');
    expect(typeof flight.price).toBe('number');
    expect(typeof flight.stops).toBe('string');
    expect(flight.stops).toBe('Direct');
    expect(flight.duration).toBe('4h 30m');
    expect(flight.durationVal).toBeCloseTo(4.5);
    expect(flight.cabinClass).toBe('Economy');
    expect(flight.direction).toBe('outbound');
    expect(flight.origin).toBe('TLV');
    expect(flight.destination).toBe('BCN');
    // Facts Google does not report are null, never a plausible-looking default.
    expect(flight.baggage).toBeNull();
    expect(flight.reliability).toBeNull();
    expect(flight.seatsRemaining).toBeNull();
  });

  test('renders connecting itineraries in the same string form as SerpApi', async () => {
    const provider = providerReturning([offer({ stops: 1 })]);

    const [flight] = (await provider.searchAsync(request)).outbound;

    expect(flight.stops).toBe('1 stop');
  });

  /*
    An id built from Date.now() changes on every call, so React remounts every card on each
    render and a cached result can never be matched back to a live one.
  */
  test('produces a stable id across repeated identical searches', async () => {
    const first = (await providerReturning([offer()]).searchAsync(request)).outbound[0];
    const second = (await providerReturning([offer()]).searchAsync(request)).outbound[0];

    expect(first.id).toBe(second.id);
    expect(first.id).not.toMatch(/\d{13}/); // no epoch timestamp
  });
});

describe('FliProvider — search parameters actually reach Google', () => {
  /*
    travelClass and stops were both accepted by the endpoint and then ignored, so the cabin
    selector silently did nothing: a Business search returned Economy fares and labelled
    them Business.
  */
  test('maps travelClass to the matching seat type', async () => {
    const search = vi.fn().mockResolvedValue([offer()]);
    const provider = new FliProvider({ search: { search }, currency: 'USD' });

    await provider.searchAsync({ ...request, travelClass: '3' });

    expect(search.mock.calls[0][0].seat_type).toBe(3); // BUSINESS
  });

  /*
    KAIRO sends stops='0' on every default search, meaning "no preference". Reading it as
    Google's NON_STOP (=1) would hide every connecting flight from users who never opened
    the filter.
  */
  test("treats the default stops='0' as no preference, not non-stop", async () => {
    const search = vi.fn().mockResolvedValue([offer()]);
    const provider = new FliProvider({ search: { search }, currency: 'USD' });

    await provider.searchAsync(request);

    expect(search.mock.calls[0][0].stops).toBe(0); // MaxStops.ANY
  });

  /*
    The "Direct flights only" checkbox sends stops='1'. An earlier mapping shifted that to
    ONE_STOP_OR_FEWER, so the box could be ticked and one-stop itineraries still came
    back — a filter that visibly did nothing.

    KAIRO's scale is Google's, inherited via SerpApi, so each value must land on its
    same-numbered enum member. Asserting the whole table rather than one case, because
    the failure mode here is an off-by-one that only shows up at one end.
  */
  test.each([
    ['0', 0, 'any number of stops'],
    ['1', 1, 'non-stop only — the Direct flights checkbox'],
    ['2', 2, 'one stop or fewer'],
    ['3', 3, 'two stops or fewer']
  ])('maps stops=%s to MaxStops %i (%s)', async (param, expected) => {
    const search = vi.fn().mockResolvedValue([offer()]);
    const provider = new FliProvider({ search: { search }, currency: 'USD' });

    await provider.searchAsync({ ...request, stops: param });

    expect(search.mock.calls[0][0].stops).toBe(expected);
  });
});

describe('FliProvider — the stop limit is enforced on results, not just requested', () => {
  /*
    Sending the filter is not enough, and this is the bug the user actually reported.

    Two independent reasons the constraint gets lost upstream:
      - Google ignores it on the RPC path. TLV->BKK returns an identical mix of 1-stop and
        2-stop itineraries whether ANY or NON_STOP is encoded, and the payloads provably
        differ, so the request is not the problem.
      - fetchLegHtml, the scraper fallback, is never given `stops` at all.

    Either way "Direct flights only" returned connecting flights. These tests assert on the
    RESULT, so they hold no matter which path served it or whether Google changes its mind.
  */
  const mixed = [
    offer({ stops: 0, booking_token: 'a' }),
    offer({ stops: 1, booking_token: 'b' }),
    offer({ stops: 2, booking_token: 'c' })
  ];

  test('stops=1 returns only non-stop itineraries', async () => {
    const provider = providerReturning(mixed);

    const { outbound } = await provider.searchAsync({ ...request, stops: '1' });

    expect(outbound).toHaveLength(1);
    expect(outbound.map((f) => f.stops)).toEqual(['Direct']);
  });

  test('stops=2 allows one stop but not two', async () => {
    const provider = providerReturning(mixed);

    const { outbound } = await provider.searchAsync({ ...request, stops: '2' });

    expect(outbound.map((f) => f.stops)).toEqual(['Direct', '1 stop']);
  });

  test('stops=0 filters nothing', async () => {
    const provider = providerReturning(mixed);

    const { outbound } = await provider.searchAsync({ ...request, stops: '0' });

    expect(outbound).toHaveLength(3);
  });

  test('the return leg is filtered too, not just the outbound', async () => {
    const provider = providerReturning(mixed);

    const results = await provider.searchAsync({
      ...request, stops: '1', returnDate: '2026-10-22'
    });

    expect(results.return.map((f) => f.stops)).toEqual(['Direct']);
  });

  /*
    The filter must test the same number the card shows. Deriving one from the raw payload
    and the other from the mapped flight is how you end up with a "Direct only" result
    labelled "1 stop".
  */
  test('the filtered count and the displayed label come from the same value', async () => {
    const provider = providerReturning(mixed);

    const { outbound } = await provider.searchAsync({ ...request, stops: '0' });

    for (const flight of outbound) {
      const expected = flight.stopsCount === 0
        ? 'Direct'
        : `${flight.stopsCount} stop${flight.stopsCount > 1 ? 's' : ''}`;
      expect(flight.stops).toBe(expected);
    }
  });

  test('passes the real passenger counts upstream', async () => {
    const search = vi.fn().mockResolvedValue([offer()]);
    const provider = new FliProvider({ search: { search }, currency: 'USD' });

    await provider.searchAsync({
      ...request,
      passengers: { adults: 2, children: 1, infants: 1 }
    });

    expect(search.mock.calls[0][0].passenger_info).toMatchObject({
      adults: 2,
      children: 1,
      infants_in_seat: 1
    });
  });

  test('pins the configured currency on every request and reports it back', async () => {
    const search = vi.fn().mockResolvedValue([offer({ currency: 'EUR' })]);
    const provider = new FliProvider({ search: { search }, currency: 'EUR' });

    const results = await provider.searchAsync(request);

    expect(search.mock.calls[0][1].currency).toBe('EUR');
    expect(results.currency).toBe('EUR');
  });
});

describe('FliProvider — round trips', () => {
  /*
    Each direction is searched one-way. Google's round-trip response prices the PAIR, and
    server.js adds outbound.price + return.price to form the roundtrip total — so mapping a
    pair price onto both legs would record roughly double the real fare.
  */
  test('searches each direction separately and prices each leg on its own', async () => {
    const search = vi.fn().mockResolvedValue([offer({ price: 300 })]);
    const provider = new FliProvider({ search: { search }, currency: 'USD' });

    const results = await provider.searchAsync({ ...request, returnDate: '2026-10-22' });

    expect(search).toHaveBeenCalledTimes(2);
    expect(results.outbound[0].price).toBe(300);
    expect(results.return[0].price).toBe(300);
    expect(results.return[0].direction).toBe('return');
    expect(results.return[0].origin).toBe('BCN');
    expect(results.return[0].destination).toBe('TLV');
  });

  test('omits the return search entirely for a one-way request', async () => {
    const search = vi.fn().mockResolvedValue([offer()]);
    const provider = new FliProvider({ search: { search }, currency: 'USD' });

    const results = await provider.searchAsync(request);

    expect(search).toHaveBeenCalledTimes(1);
    expect(results.return).toEqual([]);
  });
});

describe('FlightSearchService — provider selection and the estimate flag', () => {
  test('selects fli when FLI_ENABLED=true', () => {
    vi.stubEnv('FLI_ENABLED', 'true');
    vi.stubEnv('FLIGHT_PROVIDER', '');

    expect(new FlightSearchService().providerName).toBe('fli');

    vi.unstubAllEnvs();
  });

  /*
    Enabling the provider must NOT enable the ~31-way discovery fan-out. These were folded
    into one condition with `||`, which removed the ability to run the provider on
    /api/flights while leaving the fan-out off — exactly the rollback you want available
    when the fan-out is the part that misbehaves.
  */
  test('enabling the provider does not by itself enable real-provider estimates', async () => {
    vi.stubEnv('FLI_ENABLED', 'true');
    vi.stubEnv('ESTIMATES_USE_REAL_PROVIDER', 'false');

    const service = new FlightSearchService();
    const real = vi.fn();
    service.activeProviderName = 'fli';
    service.activeProvider = { searchAsync: real };

    const results = await service.estimateFlights(request);

    expect(real).not.toHaveBeenCalled();
    expect(results.providerUsed).toBe('simulated');

    vi.unstubAllEnvs();
  });

  test('uses the real provider for estimates only when its own flag is set', async () => {
    vi.stubEnv('ESTIMATES_USE_REAL_PROVIDER', 'true');

    const service = new FlightSearchService();
    service.activeProviderName = 'fli';
    service.activeProvider = {
      searchAsync: vi.fn().mockResolvedValue({ outbound: [{ price: 1 }], return: [] })
    };

    const results = await service.estimateFlights(request);

    expect(results.providerUsed).toBe('fli');

    vi.unstubAllEnvs();
  });
});
