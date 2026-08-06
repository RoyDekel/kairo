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

  test('recalculates metrics dynamically based on basePriceOverride and raw prices', () => {
    const flight = {
      id: 'FL-100',
      price: 500,
      insights: {
        low90Day: 400,
        high90Day: 600,
        avg90Day: 500,
        prices: [400, 420, 500, 550, 600],
        daysToDeparture: 45,
        forecastMedian: 500
      }
    };

    // Override price to 410 (should be BUY_NOW since it's cheap, percentile <= 25)
    const insightBuy = getPriceConfidenceInsight(flight, 410);
    expect(insightBuy.recommendation).toBe('BUY_NOW');
    expect(insightBuy.pricePercentile).toBe(20); // 1 out of 5 cheaper

    // Override price to 580 (should be WAIT)
    const insightWait = getPriceConfidenceInsight(flight, 580);
    expect(insightWait.recommendation).toBe('WAIT');
    expect(insightWait.pricePercentile).toBe(80); // 4 out of 5 cheaper
  });

  test('returns zero-click demo data marked with isDemo: true', () => {
    const demo = getZeroClickDemoData();
    expect(demo.isDemo).toBe(true);
    expect(demo.routeStr).toContain('Tokyo');
    expect(demo.currentPrice).toBe(814);
  });
});
