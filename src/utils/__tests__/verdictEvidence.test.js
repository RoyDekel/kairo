import { describe, test, expect } from 'vitest';
import { buildVerdictEvidence, summariseEvidence } from '../verdictEvidence';
import { getPriceConfidenceInsight } from '../priceConfidenceEngine';

const baseFlight = {
  id: 'LO-101-outbound-2026-08-11',
  price: 400,
  airlineCode: 'LO',
  origin: 'TLV',
  destination: 'BCN',
  seatsRemaining: 9
};

const baseInsight = {
  currentPrice: 400,
  low90Day: 300,
  high90Day: 500,
  recommendation: 'WAIT'
};

const ids = (evidence) => evidence.map((e) => e.id);
const byId = (evidence, id) => evidence.find((e) => e.id === id);

describe('buildVerdictEvidence', () => {
  test('returns nothing without a flight or insight', () => {
    expect(buildVerdictEvidence({})).toEqual([]);
    expect(buildVerdictEvidence({ flight: baseFlight })).toEqual([]);
    expect(buildVerdictEvidence({ insight: baseInsight })).toEqual([]);
  });

  test('every item names a concrete value rather than describing a method', () => {
    const evidence = buildVerdictEvidence({
      flight: { ...baseFlight, seatsRemaining: 2 },
      insight: { ...baseInsight, daysToDeparture: 9 },
      departureDate: '2026-08-11'
    });

    expect(evidence.length).toBeGreaterThan(0);
    for (const item of evidence) {
      expect(item.headline).toBeTruthy();
      expect(item.detail).toBeTruthy();
      expect(['buy', 'wait', 'neutral']).toContain(item.direction);
      // The old generic pillars described the model, not this route.
      expect(item.headline).not.toMatch(/forecasting models|algorithms|analytics/i);
    }
  });

  describe('live event pressure', () => {
    test('a sold-out event argues for booking now', () => {
      const evidence = buildVerdictEvidence({
        flight: baseFlight,
        insight: {
          ...baseInsight,
          topEvent: { title: 'El Clásico', venue: 'Camp Nou', eventImpactScore: 96, isSoldOut: true },
          isHighImpactEvent: true
        }
      });

      const item = byId(evidence, 'event-surge');
      expect(item.direction).toBe('buy');
      expect(item.detail).toContain('El Clásico');
      expect(item.detail).toContain('Camp Nou');
      expect(item.detail).toContain('96%');
    });

    test('a low-impact event argues for waiting', () => {
      const evidence = buildVerdictEvidence({
        flight: baseFlight,
        insight: {
          ...baseInsight,
          topEvent: { title: 'Small Theatre Play', venue: 'West End', eventImpactScore: 60, isSoldOut: false },
          isHighImpactEvent: false
        }
      });

      const item = byId(evidence, 'event-quiet');
      expect(item.direction).toBe('wait');
      expect(item.detail).toContain('Small Theatre Play');
    });

    test('no event signal when the backend supplied none', () => {
      const evidence = buildVerdictEvidence({ flight: baseFlight, insight: baseInsight });
      expect(ids(evidence)).not.toContain('event-surge');
      expect(ids(evidence)).not.toContain('event-quiet');
    });
  });

  describe('90-day price position', () => {
    test('a fare near the low argues for booking', () => {
      const evidence = buildVerdictEvidence({
        flight: { ...baseFlight, price: 310 },
        insight: { ...baseInsight, currentPrice: 310 }
      });

      const item = byId(evidence, 'price-low');
      expect(item.direction).toBe('buy');
      expect(item.detail).toContain('$300');
    });

    test('a fare high in the range argues for waiting and states the gap', () => {
      const evidence = buildVerdictEvidence({ flight: baseFlight, insight: baseInsight });

      const item = byId(evidence, 'price-high');
      expect(item.direction).toBe('wait');
      expect(item.headline).toContain('$100 above the 90-day low');
    });
  });

  describe('days to departure', () => {
    test('imminent departure argues for booking', () => {
      const evidence = buildVerdictEvidence({
        flight: baseFlight,
        insight: { ...baseInsight, daysToDeparture: 9 }
      });
      expect(byId(evidence, 'departure-imminent').direction).toBe('buy');
    });

    test('a far-off departure argues for waiting', () => {
      const evidence = buildVerdictEvidence({
        flight: baseFlight,
        insight: { ...baseInsight, daysToDeparture: 60 }
      });
      expect(byId(evidence, 'departure-early').direction).toBe('wait');
    });

    test('the mid window is neutral', () => {
      const evidence = buildVerdictEvidence({
        flight: baseFlight,
        insight: { ...baseInsight, daysToDeparture: 25 }
      });
      expect(byId(evidence, 'departure-window').direction).toBe('neutral');
    });
  });

  test('scarce seats argue for booking, plentiful seats say nothing', () => {
    const scarce = buildVerdictEvidence({ flight: { ...baseFlight, seatsRemaining: 2 }, insight: baseInsight });
    expect(byId(scarce, 'seats-scarce').headline).toBe('2 seats left at this fare');

    const plentiful = buildVerdictEvidence({ flight: { ...baseFlight, seatsRemaining: 9 }, insight: baseInsight });
    expect(ids(plentiful)).not.toContain('seats-scarce');
  });

  test('singular wording when one seat remains', () => {
    const evidence = buildVerdictEvidence({ flight: { ...baseFlight, seatsRemaining: 1 }, insight: baseInsight });
    expect(byId(evidence, 'seats-scarce').headline).toBe('1 seat left at this fare');
  });

  test('flags a weekend departure premium', () => {
    // 2026-08-15 is a Saturday.
    const weekend = buildVerdictEvidence({ flight: baseFlight, insight: baseInsight, departureDate: '2026-08-15' });
    expect(byId(weekend, 'weekend-premium').headline).toContain('Saturday');

    // 2026-08-11 is a Tuesday.
    const midweek = buildVerdictEvidence({ flight: baseFlight, insight: baseInsight, departureDate: '2026-08-11' });
    expect(ids(midweek)).not.toContain('weekend-premium');
  });

  /*
    A departure date is a calendar date, not an instant. `new Date('2026-08-15')` parses
    as UTC midnight, so west of Greenwich it reports Friday for a Saturday flight. This
    pins the local-date parsing that prevents the weekday from shifting per viewer.
  */
  test('names the weekday from the calendar date, not the UTC instant', () => {
    const cases = [
      ['2026-08-15', 'Saturday'],
      ['2026-08-16', 'Sunday'],
      ['2026-08-14', 'Friday']
    ];

    for (const [date, weekday] of cases) {
      const evidence = buildVerdictEvidence({ flight: baseFlight, insight: baseInsight, departureDate: date });
      expect(byId(evidence, 'weekend-premium').headline).toContain(weekday);
    }
  });

  test('ignores an unparseable departure date', () => {
    const evidence = buildVerdictEvidence({ flight: baseFlight, insight: baseInsight, departureDate: 'not-a-date' });
    expect(ids(evidence)).not.toContain('weekend-premium');
  });

  test('notes that low-cost carriers reprice more often', () => {
    const lowcost = buildVerdictEvidence({ flight: { ...baseFlight, airlineCode: 'W6' }, insight: baseInsight });
    expect(byId(lowcost, 'carrier-lowcost').direction).toBe('wait');

    const national = buildVerdictEvidence({ flight: { ...baseFlight, airlineCode: 'BA' }, insight: baseInsight });
    expect(ids(national)).not.toContain('carrier-lowcost');
  });

  test('surfaces counter-evidence rather than only confirming reasons', () => {
    // A fare near its low (buy) but far from departure (wait).
    const evidence = buildVerdictEvidence({
      flight: { ...baseFlight, price: 310, seatsRemaining: 2 },
      insight: { ...baseInsight, currentPrice: 310, daysToDeparture: 60 }
    });

    const { forBuy, forWait } = summariseEvidence(evidence);
    expect(forBuy).toBeGreaterThan(0);
    expect(forWait).toBeGreaterThan(0);
  });
});

describe('server insights reach the evidence engine', () => {
  /*
    Regression: getPriceConfidenceInsight used to drop the entire server payload whenever
    a basePriceOverride was passed — which both UI callers do — so topEvent and
    daysToDeparture never reached the screen and every verdict showed generic pillars.
  */
  test('event and departure data survive a local price override', () => {
    const flight = {
      ...baseFlight,
      insights: {
        topEvent: { title: 'Primavera Sound', venue: 'Parc del Fòrum', eventImpactScore: 92, isSoldOut: true },
        eventImpactScore: 92,
        isHighImpactEvent: true,
        daysToDeparture: 8,
        pricePercentile: 15,
        riskLevel: 'High (Event Demand Surge)'
      }
    };

    // Simulates the market engine ticking the price.
    const insight = getPriceConfidenceInsight(flight, 415);

    expect(insight.currentPrice).toBe(415);
    expect(insight.topEvent.title).toBe('Primavera Sound');
    expect(insight.daysToDeparture).toBe(8);

    const evidence = buildVerdictEvidence({ flight, insight });
    expect(byId(evidence, 'event-surge').detail).toContain('Primavera Sound');
    expect(byId(evidence, 'departure-imminent')).toBeDefined();
  });

  test('server analysis is used wholesale when there is no override', () => {
    const flight = { ...baseFlight, insights: { recommendation: 'BUY_NOW', currentPrice: 400 } };
    expect(getPriceConfidenceInsight(flight).recommendation).toBe('BUY_NOW');
  });
});
