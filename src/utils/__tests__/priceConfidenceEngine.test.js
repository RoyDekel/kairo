import { describe, test, expect } from 'vitest';
import { getPriceConfidenceInsight, getZeroClickDemoData } from '../priceConfidenceEngine';

describe('KAIRO Price Confidence Engine', () => {
  test('generates confidence insights for a flight', () => {
    const flight = { id: 'FL-100', price: 500 };
    const insight = getPriceConfidenceInsight(flight);

    expect(insight).toHaveProperty('currentPrice', 500);
    expect(insight).toHaveProperty('low90Day');
    expect(insight).toHaveProperty('confidenceScore');
    expect(insight.confidenceScore).toBeGreaterThanOrEqual(80);
    expect(insight.confidenceScore).toBeLessThanOrEqual(100);
    expect(['BUY_NOW', 'WAIT']).includes(insight.recommendation);
  });

  test('returns zero-click demo data for Tokyo route', () => {
    const demo = getZeroClickDemoData();

    expect(demo.routeStr).toContain('Tokyo');
    expect(demo.currentPrice).toBe(1086);
    expect(demo.low90Day).toBe(812);
    expect(demo.confidenceScore).toBe(87);
    expect(demo.recommendation).toBe('WAIT');
  });
});
