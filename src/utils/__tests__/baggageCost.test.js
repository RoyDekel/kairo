import { describe, it, expect } from 'vitest';
import {
  estimateBagFee,
  fareWithBag,
  totalWithBags,
  bagPayingPassengers,
  describeBagEstimate,
  compareFareWithBag,
  cheapestFlightIdsWithBag,
  DEFAULT_BAG_OPTION
} from '../baggageCost.js';
import { AIRLINE_BAGGAGE, LONG_HAUL_KM } from '../../../shared/airlineBaggage.js';

const flight = (overrides = {}) => ({
  airlineCode: 'W6',
  price: 100,
  passengerCosts: { total: 100 },
  distance: 2000,
  currency: 'USD',
  ...overrides
});

const midpoint = ([min, max]) => Math.round((min + max) / 2);

describe('estimateBagFee', () => {
  it('adds nothing for the personal-item default', () => {
    expect(DEFAULT_BAG_OPTION).toBe('personal');
    expect(estimateBagFee(flight(), 'personal')).toEqual({ status: 'none', fee: 0, range: null });
  });

  it('charges a low-cost carrier the midpoint of its carry-on and checked-bag ranges', () => {
    const carryOn = estimateBagFee(flight({ airlineCode: 'W6' }), 'carryon');
    expect(carryOn.status).toBe('extra');
    expect(carryOn.fee).toBe(midpoint(AIRLINE_BAGGAGE.W6.carryOn.fee));

    const checked = estimateBagFee(flight({ airlineCode: 'FR' }), 'checked');
    expect(checked.status).toBe('extra');
    expect(checked.fee).toBe(midpoint(AIRLINE_BAGGAGE.FR.checked.fee));
  });

  it('includes the carry-on on a full-service carrier', () => {
    expect(estimateBagFee(flight({ airlineCode: 'LY' }), 'carryon'))
      .toEqual({ status: 'included', fee: 0, range: null });
  });

  it('flags a Light-fare checked bag as fare-dependent, not as certainly extra', () => {
    const est = estimateBagFee(flight({ airlineCode: 'LH' }), 'checked');
    expect(est.status).toBe('fare-dependent');
    expect(est.fee).toBeGreaterThan(0);
  });

  it('uses the long-haul band at and over LONG_HAUL_KM', () => {
    const short = estimateBagFee(flight({ airlineCode: 'DL', distance: LONG_HAUL_KM - 1 }), 'checked');
    const long = estimateBagFee(flight({ airlineCode: 'DL', distance: LONG_HAUL_KM }), 'checked');
    expect(short.range).toEqual(AIRLINE_BAGGAGE.DL.checked.fee);
    expect(long.range).toEqual(AIRLINE_BAGGAGE.DL.checked.longHaulFee);
  });

  it('falls back to the short-haul band when the distance is unknown', () => {
    // fli sends distance: null for airports outside the catalog.
    const est = estimateBagFee(flight({ airlineCode: 'DL', distance: null }), 'checked');
    expect(est.range).toEqual(AIRLINE_BAGGAGE.DL.checked.fee);
  });

  it('reports a checked bag as included where every economy fare carries one', () => {
    expect(estimateBagFee(flight({ airlineCode: 'EK', distance: 9000 }), 'checked').status).toBe('included');
  });

  it('returns unknown, adding nothing, for a carrier with no policy on file', () => {
    expect(estimateBagFee(flight({ airlineCode: 'ZZ' }), 'checked'))
      .toEqual({ status: 'unknown', fee: 0, range: null });
  });

  it('is case-insensitive on the airline code', () => {
    expect(estimateBagFee(flight({ airlineCode: 'w6' }), 'carryon').status).toBe('extra');
  });

  it('refuses to add a USD fee to a fare in another currency', () => {
    expect(estimateBagFee(flight({ currency: 'EUR' }), 'checked').status).toBe('unknown');
  });

  it('treats a flight with no currency field as USD, like the rest of the UI', () => {
    expect(estimateBagFee(flight({ currency: undefined }), 'checked').status).toBe('extra');
  });

  it('ignores an unrecognised bag option', () => {
    expect(estimateBagFee(flight(), 'trunk')).toEqual({ status: 'none', fee: 0, range: null });
  });

  it('charges a flat published price exactly (Israir)', () => {
    expect(estimateBagFee(flight({ airlineCode: '6H' }), 'carryon')).toEqual({ status: 'extra', fee: 30, range: [30, 30] });
    expect(estimateBagFee(flight({ airlineCode: '6H' }), 'checked').fee).toBe(65);
  });

  it('prices Arkia on Europe-length routes', () => {
    expect(estimateBagFee(flight({ airlineCode: 'IZ', distance: 2280 }), 'carryon').fee).toBe(25);
    expect(estimateBagFee(flight({ airlineCode: 'IZ', distance: 2280 }), 'checked').fee).toBe(50);
  });

  it('reports unknown on long-haul where the published price only covers shorter routes', () => {
    // Arkia's fee page covers Europe; TLV->BKK is ~7000 km.
    expect(estimateBagFee(flight({ airlineCode: 'IZ', distance: 7000 }), 'checked'))
      .toEqual({ status: 'unknown', fee: 0, range: null });
  });

  it('prices Pegasus from its traveller-reported band', () => {
    const est = estimateBagFee(flight({ airlineCode: 'PC' }), 'checked');
    expect(est.status).toBe('extra');
    expect(est.fee).toBe(midpoint(AIRLINE_BAGGAGE.PC.checked.fee));
  });
});

describe('bagPayingPassengers', () => {
  it('counts adults and children but not lap infants', () => {
    expect(bagPayingPassengers({ adults: 2, children: 1, infants: 1 })).toBe(3);
  });

  it('defaults to one adult', () => {
    expect(bagPayingPassengers(undefined)).toBe(1);
  });
});

describe('fareWithBag / totalWithBags', () => {
  it('adds the per-passenger fee to the per-adult fare', () => {
    const f = flight({ airlineCode: 'W6' });
    expect(fareWithBag(f, 'checked')).toBe(100 + midpoint(AIRLINE_BAGGAGE.W6.checked.fee));
    expect(fareWithBag(f, 'personal')).toBe(100);
  });

  it('adds one fee per paying passenger to the party total', () => {
    const f = flight({ airlineCode: 'W6', passengerCosts: { total: 250 } });
    const fee = midpoint(AIRLINE_BAGGAGE.W6.checked.fee);
    expect(totalWithBags(f, 'checked', { adults: 2, children: 1, infants: 1 })).toBe(250 + fee * 3);
  });

  it('makes an included-bag carrier cheaper to fly than a low-cost base fare that is lower', () => {
    const lowCost = flight({ airlineCode: 'W6', price: 90 });
    const fullService = flight({ airlineCode: 'LY', price: 110 });
    expect(fareWithBag(lowCost, 'personal')).toBeLessThan(fareWithBag(fullService, 'personal'));
    expect(fareWithBag(lowCost, 'carryon')).toBeGreaterThan(fareWithBag(fullService, 'carryon'));
  });
});

describe('ranking with a bag', () => {
  // Wizz 89 + checked fee; the unlisted carrier is dearer on fare but its bag adds 0.
  const wizz = flight({ id: 'w', airlineCode: 'W6', price: 89 });
  const unlisted = flight({ id: 'z', airlineCode: 'ZZ', price: 120 });
  const elal = flight({ id: 'l', airlineCode: 'LY', price: 134 });

  it('ranks an unknown bag cost after every known one, instead of treating it as free', () => {
    const order = [unlisted, elal, wizz].sort((a, b) => compareFareWithBag(a, b, 'checked'));
    expect(order.map((f) => f.id)).toEqual(['w', 'l', 'z']);
  });

  it('is the plain fare order with the personal-item default', () => {
    const order = [elal, unlisted, wizz].sort((a, b) => compareFareWithBag(a, b, 'personal'));
    expect(order.map((f) => f.id)).toEqual(['w', 'z', 'l']);
  });

  it('never gives the Cheapest Deal tag to an unknown bag cost while a known one exists', () => {
    expect([...cheapestFlightIdsWithBag([wizz, unlisted, elal], 'checked')]).toEqual(['w']);
  });

  it('falls back to fare when no flight has a known bag cost', () => {
    const other = flight({ id: 'q', airlineCode: 'QQ', price: 100 });
    expect([...cheapestFlightIdsWithBag([unlisted, other], 'checked')]).toEqual(['q']);
  });

  it('tags every flight tied at the cheapest price', () => {
    const twin = flight({ id: 'w2', airlineCode: 'W6', price: 89 });
    expect(cheapestFlightIdsWithBag([wizz, twin, elal], 'carryon')).toEqual(new Set(['w', 'w2']));
  });

  it('returns an empty set for no flights', () => {
    expect(cheapestFlightIdsWithBag([], 'checked').size).toBe(0);
  });
});

describe('describeBagEstimate', () => {
  it('says nothing for the personal-item default', () => {
    expect(describeBagEstimate(estimateBagFee(flight(), 'personal'), 'personal')).toBeNull();
  });

  it('labels every added fee as an estimate', () => {
    const est = estimateBagFee(flight({ airlineCode: 'W6' }), 'checked');
    expect(describeBagEstimate(est, 'checked').text).toBe(`+~$${est.fee} checked bag (est.)`);
  });

  it('shows a flat published price as one figure, not a range', () => {
    const est = estimateBagFee(flight({ airlineCode: '6H' }), 'carryon');
    const { detail } = describeBagEstimate(est, 'carryon');
    expect(detail).toContain('$30 one way');
    expect(detail).not.toContain('$30–$30');
  });

  it('explains a fare-dependent bag in the detail', () => {
    const est = estimateBagFee(flight({ airlineCode: 'LH' }), 'checked');
    expect(describeBagEstimate(est, 'checked').detail).toMatch(/Light \/ Basic/);
  });

  it('names an included bag and an unknown one plainly', () => {
    expect(describeBagEstimate(estimateBagFee(flight({ airlineCode: 'LY' }), 'carryon'), 'carryon').text)
      .toBe('Carry-on included');
    expect(describeBagEstimate(estimateBagFee(flight({ airlineCode: 'ZZ' }), 'checked'), 'checked').text)
      .toBe('Checked bag fee unknown');
  });
});

describe('AIRLINE_BAGGAGE table', () => {
  it('gives every non-included bag a well-formed fee range', () => {
    for (const [code, policy] of Object.entries(AIRLINE_BAGGAGE)) {
      for (const bag of ['carryOn', 'checked']) {
        const p = policy[bag];
        expect(p, `${code}.${bag}`).toBeDefined();
        if (p.included === true) continue;
        for (const range of [p.fee, p.longHaulFee].filter(Boolean)) {
          expect(range, `${code}.${bag}`).toHaveLength(2);
          expect(range[0], `${code}.${bag}`).toBeGreaterThan(0);
          expect(range[1], `${code}.${bag}`).toBeGreaterThanOrEqual(range[0]);
        }
        expect(p.fee, `${code}.${bag} needs a short-haul fee`).toBeDefined();
      }
    }
  });
});
