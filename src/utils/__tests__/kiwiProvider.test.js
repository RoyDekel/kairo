import { describe, test, expect, vi, afterEach } from 'vitest';
import { KiwiProvider } from '../../../server/providers/kiwiProvider.js';

/**
 * Every Kiwi flight used to carry a hardcoded "1 carry-on (8kg) + 1 checked bag (23kg)
 * included." — false for every low-cost carrier, whose base fares include neither. The
 * mapper must send null (rendered "Not reported" by FlightDetails), as fliProvider does.
 *
 * Tequila's `baglimit` is not a substitute: it is the carrier's size/weight ceiling, not
 * what the fare includes, so it must not be turned back into an "included" claim.
 */

const providerWithKey = (apiKey = 'test-key') => {
  const provider = new KiwiProvider();
  provider.apiKey = apiKey;
  return provider;
};

// Relative to today, as in fliProvider.test.js: a hardcoded search date becomes a past
// travel date once it passes, and the offer below is kept on the same day as the request.
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];
const departureDate = daysFromNow(60);

const request = {
  origin: 'TLV',
  destination: 'BUD',
  departureDate,
  returnDate: '',
  passengers: { adults: 1, children: 0, infants: 0 },
  stops: '0'
};

const kiwiOffer = (airline, extra = {}) => ({
  id: `${airline}-offer`,
  flyFrom: 'TLV',
  flyTo: 'BUD',
  local_departure: `${departureDate}T06:10:00.000Z`,
  local_arrival: `${departureDate}T09:00:00.000Z`,
  duration: { departure: 10200 },
  price: 79,
  route: [{ airline, flight_no: 2327 }],
  ...extra
});

const respondWith = (offers) => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: offers })
  });
};

describe('KiwiProvider baggage mapping', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test.each(['W6', 'FR', 'LY'])('reports no baggage allowance for %s rather than inventing one', async (airline) => {
    respondWith([kiwiOffer(airline)]);

    const [flight] = (await providerWithKey().searchAsync(request)).outbound;

    expect(flight.airlineCode).toBe(airline);
    expect(flight.baggage).toBeNull();
  });

  test('does not present the carrier baglimit as an included allowance', async () => {
    // Shape of a real Tequila low-cost offer: the carrier publishes hold-bag limits, and
    // bags_price shows the first hold bag costs extra — it is not in the fare.
    respondWith([kiwiOffer('FR', {
      baglimit: { hand_weight: 10, hold_weight: 20, personal_item_weight: 3 },
      bags_price: { 1: 32.5 }
    })]);

    const [flight] = (await providerWithKey().searchAsync(request)).outbound;

    expect(flight.baggage).toBeNull();
  });
});
