import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { SerpApiProvider } from '../../../server/providers/serpapiProvider.js';

/**
 * The backend fetch to SerpApi used to have no timeout at all: a slow (or hung) Google
 * Flights scrape would hold the request open indefinitely, long after the frontend had
 * already given up and shown its own local simulation. This locks in the fix — an
 * AbortController-based ceiling — so a real search always resolves or fails within a
 * bounded time, and FlightSearchService's existing catch-and-fallback runs on a
 * predictable schedule instead of never.
 */

const providerWithKey = (apiKey = 'test-key') => {
  const provider = new SerpApiProvider();
  provider.apiKey = apiKey;
  return provider;
};

const request = {
  origin: 'TLV',
  destination: 'FCO',
  departureDate: '2026-10-15',
  returnDate: '',
  passengers: { adults: 1, children: 0, infants: 0 },
  stops: '0',
  travelClass: 'ALL'
};

describe('SerpApiProvider request timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('aborts and throws a clear error when SerpApi never responds', async () => {
    // A fetch that mimics real AbortController semantics: it only settles when its
    // signal fires, exactly like the browser/Node fetch implementation this replaces.
    globalThis.fetch = vi.fn((_url, { signal } = {}) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    const provider = providerWithKey();
    const pending = provider.searchAsync(request);

    // Attach the rejection assertion BEFORE advancing timers, so the rejection always has
    // a handler already attached when it fires. Awaiting the timer advance first and
    // asserting after would let the promise reject with nothing listening yet, which
    // Node reports as an unhandled rejection even though the test goes on to catch it.
    const assertion = expect(pending).rejects.toThrow(/timed out after 45000ms/);

    // Let the microtask queue settle so fetch() has actually been called before advancing.
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(45000);

    await assertion;
  });

  test('passes an AbortController signal to fetch so it CAN be cancelled', async () => {
    let receivedSignal;
    globalThis.fetch = vi.fn((_url, opts) => {
      receivedSignal = opts?.signal;
      return new Promise(() => {}); // never resolves; we only care that a signal was passed
    });

    providerWithKey().searchAsync(request);
    await Promise.resolve();

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  test('does not fire the timeout if SerpApi responds well within it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [], other_flights: [] })
    });

    const result = await providerWithKey().searchAsync(request);

    expect(result).toEqual({ outbound: [], return: [] });
  });
});

/**
 * Every SerpApi flight used to carry a hardcoded "1 carry-on (8kg) + 1 checked bag (23kg)
 * included." — false for every low-cost carrier, whose base fares include neither. Google
 * Flights' response has no structured allowance, so the mapper must send null (rendered
 * "Not reported" by FlightDetails), exactly as fliProvider already does.
 */
describe('SerpApiProvider baggage mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const serpOffer = (flightNumber, airline) => ({
    flights: [{
      airline,
      flight_number: flightNumber,
      departure_airport: { id: 'TLV', time: '2026-10-15 06:10' },
      arrival_airport: { id: 'FCO', time: '2026-10-15 09:15' },
      airplane: 'Airbus A321neo',
      travel_class: 'Economy'
    }],
    total_duration: 245,
    price: 89
  });

  test.each([
    ['W6 2327', 'Wizz Air'],
    ['FR 7431', 'Ryanair'],
    ['LY 381', 'El Al']
  ])('reports no baggage allowance for %s (%s) rather than inventing one', async (flightNumber, airline) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ best_flights: [serpOffer(flightNumber, airline)], other_flights: [] })
    });

    const [flight] = (await providerWithKey().searchAsync(request)).outbound;

    expect(flight.airlineCode).toBe(flightNumber.split(' ')[0]);
    expect(flight.baggage).toBeNull();
  });
});

describe('SerpApiProvider error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('throws when no API key is configured', async () => {
    await expect(providerWithKey('').searchAsync(request)).rejects.toThrow(/key is missing/i);
  });

  test('surfaces a non-timeout fetch failure unchanged', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network unreachable'));

    await expect(providerWithKey().searchAsync(request)).rejects.toThrow('network unreachable');
  });

  test('throws a descriptive error on a non-OK HTTP status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'Rate limit exceeded'
    });

    await expect(providerWithKey().searchAsync(request)).rejects.toThrow(/429/);
  });
});
