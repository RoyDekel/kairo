import { describe, test, expect } from 'vitest';
import { getPriceConfidenceInsight, getZeroClickDemoData } from '../priceConfidenceEngine';

describe('priceConfidenceEngine', () => {
  test('returns null state when no flight insights are provided', () => {
    const flight = { id: 'FL-100', price: 500 };
    const insight = getPriceConfidenceInsight(flight);

    expect(insight.verdict).toBeNull();
    expect(insight.recommendation).toBeNull();
    expect(insight.priceHistory).toBeNull();
    expect(insight.reason).toBe('insufficient_history');
  });

  test('acts as a pure presenter and preserves insights when provided', () => {
    const flight = {
      id: 'FL-100',
      price: 500,
      insights: {
        currentPrice: 500,
        low90Day: 400,
        high90Day: 600,
        avg90Day: 500,
        pricePercentile: 50,
        recommendation: 'WAIT',
        actionHeadline: 'WAIT 5 MORE DAYS',
        confidenceScore: 88,
        confidenceStars: '★★★★☆',
        expectedSavings: 100,
        summary: 'Wait recommendation',
        priceHistory: [{ label: '14d ago', price: 400 }]
      }
    };

    const insight = getPriceConfidenceInsight(flight);

    expect(insight.currentPrice).toBe(500);
    expect(insight.low90Day).toBe(400);
    expect(insight.pricePercentile).toBe(50);
    expect(insight.recommendation).toBe('WAIT');
    expect(insight.confidenceScore).toBe(88);
    expect(insight.priceHistory).toEqual([{ label: '14d ago', price: 400 }]);
  });

  /*
    The verdict and the sentence explaining it are one answer, not two.

    `insights.recommendation`, `pricePercentile`, `expectedSavings`, `actionHeadline` and
    `summary` are produced together by one rule in server/services/insightsEngine.js. The
    client is not able to re-run that rule — the fare sample and the forecast median behind
    it are not in the payload — so it must not re-decide any part of the set on its own. It
    used to re-decide `recommendation` alone, from a crude "within 12% of the 90-day low"
    comparison, and leave the four narrative fields describing the server's verdict.
  */
  const serverInsights = (overrides = {}) => ({
    // Shaped as computeEventDrivenInsights returns it. Note: no `prices` key — the server
    // has never sent one.
    currentPrice: 500,
    low90Day: 460,
    high90Day: 700,
    avg90Day: 560,
    pricePercentile: 62,
    daysToDeparture: 47,
    recommendation: 'WAIT',
    actionHeadline: 'WAIT 7 MORE DAYS',
    confidenceScore: 88,
    confidenceStars: '★★★★☆',
    expectedSavings: 40,
    summary: 'Fare ($500) is 62% above the 90-day low ($460). Fares expected to drop by ~$40 within 7 days.',
    priceHistory: [{ label: '07-02', price: 460, isLowest: true }],
    verdict: 'WAIT',
    reason: 'seasonal_naive_forecast',
    ...overrides
  });

  test('a price override never re-decides the verdict the server narrated', () => {
    const flight = { id: 'FL-100', price: 500, insights: serverInsights() };

    // BuyVerdict passes activeFlight.price on every render. The crude client rule scored
    // this fare at (500 - 460) / 460 = 9% above the low, so it used to flip the badge to
    // BUY_NOW while every word under it still argued for waiting.
    const insight = getPriceConfidenceInsight(flight, 500);

    expect(insight.recommendation).toBe('WAIT');
    expect(insight.actionHeadline).toBe('WAIT 7 MORE DAYS');
    expect(insight.summary).toContain('expected to drop');
    expect(insight.pricePercentile).toBe(62);
    expect(insight.expectedSavings).toBe(40);
  });

  test('the verdict and its narrative stay consistent after the market engine ticks', () => {
    // App.jsx moves activeFlight.price by ±$5 every 8s without refetching insights.
    const flight = { id: 'FL-100', price: 495, insights: serverInsights() };
    const insight = getPriceConfidenceInsight(flight, 495);

    // The fare the user is looking at is the overridden one...
    expect(insight.currentPrice).toBe(495);
    // ...but no part of the server's answer is rewritten to suit it.
    expect(insight.recommendation).toBe('WAIT');
    expect(insight.actionHeadline).toBe('WAIT 7 MORE DAYS');
    expect(insight.summary).toBe(serverInsights().summary);
  });

  test('a BUY_NOW payload is not flipped to WAIT either', () => {
    const flight = {
      id: 'FL-100',
      price: 620,
      insights: serverInsights({
        currentPrice: 620,
        pricePercentile: 18,
        recommendation: 'BUY_NOW',
        actionHeadline: 'BUY NOW (BEST FARE)',
        expectedSavings: 160,
        summary: 'Current fare ($620) is in the lowest 18% of 90-day historical prices ($460 low). Airline pricing algorithms indicate an imminent price increase.',
        verdict: 'BUY_NOW'
      })
    };

    // (620 - 460) / 460 = 35%, which the deleted client rule read as WAIT.
    const insight = getPriceConfidenceInsight(flight, 620);

    expect(insight.recommendation).toBe('BUY_NOW');
    expect(insight.actionHeadline).toBe('BUY NOW (BEST FARE)');
    expect(insight.summary).toContain('lowest 18%');
  });

  test('the server payload survives an override intact', () => {
    const flight = {
      id: 'FL-100',
      price: 500,
      insights: serverInsights({
        topEvent: { title: 'Primavera Sound', venue: 'Parc del Fòrum', eventImpactScore: 92 },
        isHighImpactEvent: true,
        eventCoverage: 'full'
      })
    };

    const insight = getPriceConfidenceInsight(flight, 505);

    expect(insight.topEvent.title).toBe('Primavera Sound');
    expect(insight.daysToDeparture).toBe(47);
    expect(insight.confidenceScore).toBe(88);
    expect(insight.priceHistory).toEqual([{ label: '07-02', price: 460, isLowest: true }]);
  });

  test('an insufficient-history payload keeps its null verdict under an override', () => {
    const flight = {
      id: 'FL-100',
      price: 500,
      insights: {
        currentPrice: 500,
        recommendation: null,
        verdict: null,
        reason: 'insufficient_history',
        sampleSize: 3,
        actionHeadline: 'NO RECOMMENDATION'
      }
    };

    const insight = getPriceConfidenceInsight(flight, 512);

    expect(insight.recommendation).toBeNull();
    expect(insight.verdict).toBeNull();
    expect(insight.sampleSize).toBe(3);
  });

  test('returns zero-click demo data marked with isDemo: true', () => {
    const demo = getZeroClickDemoData();
    expect(demo.isDemo).toBe(true);
    expect(demo.routeStr).toContain('Tokyo');
    expect(demo.currentPrice).toBe(814);
  });
});
