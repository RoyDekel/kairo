/**
 * @vitest-environment node
 */
import { describe, test, expect } from 'vitest';
import { computeEventDrivenInsights } from '../../../server/services/insightsEngine.js';

/*
  THIS FILE IS THE TRUST GUARDRAIL (KAI-004).

  forecastCache.get() used to refuse any cached row whose computed_current_price differed
  from the live fare by more than 8% — "the trust guardrail", decisions.md 2026-08-09 —
  because a verdict computed against a stale price could show a BUY/WAIT that no longer
  matched the fare on screen. That gate rejected ~92% of production reads and has been
  removed, on the strength of one invariant:

      computeEventDrivenInsights DERIVES recommendation, pricePercentile and expectedSavings
      FROM THE LIVE comparisonPrice, never from the forecast object's own stale fields,
      whenever forecast.prices is present.

  Nothing enforced that invariant before this file. If a future change to insightsEngine.js
  starts trusting the cached recommendation/percentile/savings instead of recomputing them,
  these tests fail — and the confidently-wrong-verdict risk the 2026-08-09 gate existed to
  prevent quietly reopens. Do not delete or weaken them without restoring a price gate in
  forecastCache.get().
*/

/**
 * A cached tier-3 payload whose OWN computed fields are deliberately wrong for the live
 * price each test passes in — 90-day stats and prices are real, the three price-sensitive
 * fields are the stale values a cache row would legitimately carry.
 */
function cachedForecast(overrides = {}) {
  return {
    verdict: 'WAIT',
    reason: 'huggingface_chronos_forecast',
    prices: [400, 500, 600, 700, 800],
    forecastMedian: 600,
    low90Day: 380,
    high90Day: 820,
    avg90Day: 600,
    // Cacheable: properties of the model's quantile spread and the 90-day window.
    confidenceScore: 88,
    sampleSize: 120,
    priceHistory: [
      { label: '90d ago', price: 780 },
      { label: '30d ago', price: 610 },
      { label: 'Today', price: 505 }
    ],
    // STALE by construction: computed against a cached price no test below uses.
    recommendation: 'WAIT',
    pricePercentile: 92,
    expectedSavings: 250,
    ...overrides
  };
}

// No departureDate => daysToDeparture defaults to 45, which keeps the >40 branch stable
// regardless of when the suite runs. No events => eventImpactScore 70, not high-impact,
// so neither the <=14-days nor the event-surge override can force BUY_NOW on its own.
const flight = { price: 480, destination: 'CDG' };
const noEvents = [];

describe('computeEventDrivenInsights — price-sensitive fields follow the LIVE price (KAI-004)', () => {
  test('a cheap live price yields BUY_NOW even though the cached forecast says WAIT', () => {
    const forecast = cachedForecast();

    const res = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 300 });

    // percentileOf(300, [400..800]) === 0: nothing on record was cheaper.
    expect(res.pricePercentile).toBe(0);
    expect(res.pricePercentile).not.toBe(forecast.pricePercentile);

    // 0 <= 25 AND 300 <= forecastMedian 600 -> BUY_NOW, against the cached 'WAIT'.
    expect(res.recommendation).toBe('BUY_NOW');
    expect(res.recommendation).not.toBe(forecast.recommendation);

    // max(15, 300 - min(600, 380)) -> the floor, not the cached 250.
    expect(res.expectedSavings).toBe(15);
    expect(res.expectedSavings).not.toBe(forecast.expectedSavings);
  });

  test('an expensive live price yields WAIT even though the cached forecast says BUY_NOW', () => {
    const forecast = cachedForecast({ recommendation: 'BUY_NOW', pricePercentile: 3, expectedSavings: 15 });

    const res = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 900 });

    // percentileOf(900, [400..800]) === 100: everything on record was cheaper.
    expect(res.pricePercentile).toBe(100);
    expect(res.pricePercentile).not.toBe(forecast.pricePercentile);

    // 100 > 25 AND 900 > forecastMedian 600 -> WAIT, against the cached 'BUY_NOW'.
    expect(res.recommendation).toBe('WAIT');
    expect(res.recommendation).not.toBe(forecast.recommendation);

    // max(15, 900 - min(600, 380)) === 520, derived from the live price.
    expect(res.expectedSavings).toBe(520);
    expect(res.expectedSavings).not.toBe(forecast.expectedSavings);
  });

  test('the same cached row produces OPPOSITE verdicts for two different live prices', () => {
    // The clearest statement of the invariant: one cache row, two flights on one search,
    // two correct answers. This is exactly what server.js does per flight card.
    const forecast = cachedForecast();

    const cheap = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 350 });
    const pricey = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 950 });

    expect(cheap.recommendation).toBe('BUY_NOW');
    expect(pricey.recommendation).toBe('WAIT');
    expect(cheap.pricePercentile).toBeLessThan(pricey.pricePercentile);
    expect(cheap.expectedSavings).toBeLessThan(pricey.expectedSavings);
  });
});

describe('computeEventDrivenInsights — cacheable fields pass through unchanged (KAI-004)', () => {
  test('confidenceScore, sampleSize and priceHistory come from the forecast verbatim', () => {
    const forecast = cachedForecast();

    const res = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 300 });

    expect(res.confidenceScore).toBe(88);
    expect(res.sampleSize).toBe(120);
    expect(res.priceHistory).toEqual(forecast.priceHistory);
  });

  test('those three are INVARIANT to the live price — they are not price-derived', () => {
    /*
      The other half of the KAI-004 argument: these fields are properties of the 90-day
      window and the model's own uncertainty band, not of the price the cache was computed
      against (confidenceScore is `95 - cv * 30` over the forecast interval — currentPrice
      is not an input). That is why serving them from a row computed at a different price is
      correct, and why no drift gate is needed to protect them. If someone ever makes one of
      them price-dependent, this test fails and the safety argument needs revisiting.
    */
    const forecast = cachedForecast();

    const cheap = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 150 });
    const pricey = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 1500 });

    expect(cheap.confidenceScore).toBe(pricey.confidenceScore);
    expect(cheap.sampleSize).toBe(pricey.sampleSize);
    expect(cheap.priceHistory).toEqual(pricey.priceHistory);

    // The 90-day window statistics are likewise served straight from the cached row.
    expect(cheap.low90Day).toBe(forecast.low90Day);
    expect(cheap.high90Day).toBe(forecast.high90Day);
    expect(cheap.avg90Day).toBe(forecast.avg90Day);
  });
});

describe('computeEventDrivenInsights — the event impact score cannot move the verdict (KAI-006)', () => {
  /*
    eventImpactScore is not a measurement.

    ticketmasterProvider.format computes it as `isSoldOut ? 96 : 75 + (idx % 20)` — a
    hardcoded constant or the event's ORDINAL POSITION in the response array. Nothing in it
    observes demand, price movement or sell-through rate. insightsEngine used to force
    `recommendation = 'BUY_NOW'` whenever that number reached 90, so a single sold-out
    listing anywhere in the destination city — a comedy night in a 200-seat club — outranked
    the Chronos-2 forecast and produced a confidently wrong BUY.

    The BUY/WAIT verdict now comes from the forecast engine and the price, and from nothing
    else. The event survives as CONTEXT: topEvent, isHighImpactEvent and the rationale
    pillars are still returned for verdictEvidence to render, and a sold-out event is still
    named in the summary — but as a fact, never as a fare prediction.

    These tests are the guardrail. If someone reintroduces an event term into the
    recommendation chain, they fail.
  */
  const soldOut = {
    id: 'tm-1',
    title: 'Stadium Show',
    venue: 'Accor Arena',
    categoryLabel: 'Music 🎵',
    eventImpactScore: 96,
    isSoldOut: true
  };

  test('a 96-impact sold-out event does NOT flip a WAIT forecast to BUY_NOW', () => {
    const forecast = cachedForecast();

    // comparisonPrice 900 is above forecastMedian 600 and at the 100th percentile: the
    // model says WAIT, unambiguously.
    const res = computeEventDrivenInsights(flight, {}, [soldOut], { forecast, comparisonPrice: 900 });

    expect(res.recommendation).toBe('WAIT');
    expect(res.actionHeadline).toMatch(/^WAIT /);
  });

  test('a 96-impact sold-out event does NOT flip WAIT to BUY_NOW without a forecast either', () => {
    // No forecast: the simulated path. 45 days out at the 43rd percentile is a WAIT.
    const res = computeEventDrivenInsights(flight, {}, [soldOut]);

    expect(res.recommendation).toBe('WAIT');

    // The simulated path computed confidence as `85 + (isHighImpactEvent ? 8 : 0) - ...`,
    // so the invented score also inflated the star rating. It no longer contributes.
    const quiet = computeEventDrivenInsights(flight, {}, [{ ...soldOut, eventImpactScore: 60 }]);
    expect(res.confidenceScore).toBe(quiet.confidenceScore);
    expect(res.confidenceStars).toBe(quiet.confidenceStars);
  });

  test('the verdict and every price-derived field are INVARIANT to the impact score', () => {
    // The property, stated directly: hold everything real constant, vary only the invented
    // number. Nothing a user acts on may change.
    const forecast = cachedForecast();
    const high = computeEventDrivenInsights(flight, {}, [soldOut], { forecast, comparisonPrice: 900 });
    const low = computeEventDrivenInsights(
      flight, {}, [{ ...soldOut, eventImpactScore: 60 }], { forecast, comparisonPrice: 900 }
    );

    expect(high.recommendation).toBe(low.recommendation);
    expect(high.actionHeadline).toBe(low.actionHeadline);
    expect(high.summary).toBe(low.summary);
    expect(high.riskLevel).toBe(low.riskLevel);
    expect(high.expectedSavings).toBe(low.expectedSavings);
    expect(high.pricePercentile).toBe(low.pricePercentile);
    expect(high.confidenceScore).toBe(low.confidenceScore);
  });

  test('the event is still surfaced as context on a WAIT', () => {
    const forecast = cachedForecast();
    const res = computeEventDrivenInsights(flight, {}, [soldOut], { forecast, comparisonPrice: 900 });

    // verdictEvidence.js reads these to render the event-surge evidence item.
    expect(res.topEvent).toBe(soldOut);
    expect(res.eventImpactScore).toBe(96);
    expect(res.isHighImpactEvent).toBe(true);
    expect(res.rationalePillars[0]).toContain('Stadium Show');

    // Sold-out is a real API field, so the summary may state it...
    expect(res.summary).toContain('Stadium Show');
    // ...but the old summary asserted the opposite of the truth on this exact path.
    expect(res.summary).not.toContain('No major Sold-Out event conflict');
  });

  test('no fare effect is ever attributed to an event', () => {
    const forecast = cachedForecast();
    const buy = computeEventDrivenInsights(flight, {}, [soldOut], { forecast, comparisonPrice: 300 });

    expect(buy.recommendation).toBe('BUY_NOW');
    // `expectedSavings * 1.2` presented as an event-caused price rise: an estimate with no
    // estimator behind it. The BUY is explained by the percentile that produced it.
    expect(buy.summary).not.toContain('due to event ticket pressure');
    expect(buy.summary).not.toContain('Fares are predicted to rise');
    expect(buy.actionHeadline).toBe('BUY NOW (BEST FARE)');
    expect(buy.summary).toContain('lowest 0%');
  });

  test('an event score of 96 cannot outrank the days-to-departure heuristic either way', () => {
    // Guards the one surviving non-price override. <= 14 days still forces BUY_NOW, on its
    // own justification, with or without an event — bundling its removal here would make a
    // regression untraceable (P3 spec §5.1).
    const soon = { departureDate: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0] };
    const withEvent = computeEventDrivenInsights(flight, soon, [soldOut]);
    const without = computeEventDrivenInsights(flight, soon, noEvents);

    expect(withEvent.recommendation).toBe('BUY_NOW');
    expect(without.recommendation).toBe('BUY_NOW');
    expect(withEvent.riskLevel).toBe(without.riskLevel);
  });
});

describe('computeEventDrivenInsights — insufficient history short-circuits first', () => {
  test('verdict === null returns the empty-state shape before any recompute runs', () => {
    // `prices` and a stale recommendation are present ON PURPOSE: if the early return ever
    // stops short-circuiting, the recompute below it would overwrite these nulls and this
    // test catches it.
    const forecast = {
      verdict: null,
      reason: 'insufficient_history',
      sampleSize: 2,
      prices: [400, 500, 600],
      forecastMedian: 500,
      recommendation: 'BUY_NOW',
      pricePercentile: 10
    };

    const res = computeEventDrivenInsights(flight, {}, noEvents, { forecast, comparisonPrice: 300 });

    expect(res.recommendation).toBeNull();
    expect(res.verdict).toBeNull();
    expect(res.reason).toBe('insufficient_history');
    expect(res.actionHeadline).toBe('NO RECOMMENDATION');
    expect(res.confidenceScore).toBeNull();
    expect(res.confidenceStars).toBeNull();
    expect(res.priceHistory).toBeNull();
    expect(res.sampleSize).toBe(2);
    expect(res.summary).toContain('only observed this route 2 times');

    // The early-return object simply has no price-derived fields on it.
    expect(res.pricePercentile).toBeUndefined();
    expect(res.expectedSavings).toBeUndefined();
  });
});
