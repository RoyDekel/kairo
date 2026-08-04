import { describe, test, expect } from 'vitest';
import { ForecastService } from '../../../server/services/forecastService.js';

function fakeSupabase({ rows = [], fail = false } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                eq() {
                  return {
                    gte() {
                      return {
                        order() {
                          return {
                            async limit() {
                              if (fail) return { data: null, error: { message: 'read failed' } };
                              return { data: rows, error: null };
                            }
                          };
                        }
                      };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

describe('ForecastService', () => {
  test('returns null verdict and insufficient_history for < 5 observations', async () => {
    const rows = [
      { roundtrip_price: 300, observed_at: '2026-08-01T12:00:00Z' },
      { roundtrip_price: 320, observed_at: '2026-08-02T12:00:00Z' }
    ];
    const supabase = fakeSupabase({ rows });
    const service = new ForecastService({ supabase });

    const result = await service.forecastRoute('TLV', 'LCA', 310);
    expect(result.verdict).toBeNull();
    expect(result.reason).toBe('insufficient_history');
    expect(result.sampleSize).toBe(2);
  });

  test('returns basic statistics for 5 to 29 observations without forecast details', async () => {
    const rows = [
      { roundtrip_price: 200, observed_at: '2026-08-01T12:00:00Z' },
      { roundtrip_price: 210, observed_at: '2026-08-02T12:00:00Z' },
      { roundtrip_price: 220, observed_at: '2026-08-03T12:00:00Z' },
      { roundtrip_price: 230, observed_at: '2026-08-04T12:00:00Z' },
      { roundtrip_price: 250, observed_at: '2026-08-05T12:00:00Z' }
    ];
    const supabase = fakeSupabase({ rows });
    const service = new ForecastService({ supabase });

    const result = await service.forecastRoute('TLV', 'LCA', 205);
    expect(result.verdict).toBe('BUY_NOW'); // percentile 20 (<= 25)
    expect(result.reason).toBe('basic_statistics');
    expect(result.sampleSize).toBe(5);
    expect(result.low90Day).toBe(200);
    expect(result.high90Day).toBe(250);
    expect(result.avg90Day).toBe(220);
    expect(result.confidenceScore).toBeNull();
  });

  test('returns seasonal-naive forecast for >= 30 observations with prediction interval and dynamic confidence', async () => {
    // Generate 35 daily observations
    const rows = [];
    const baseDate = new Date('2026-07-01');
    for (let i = 0; i < 35; i++) {
      const date = new Date(baseDate.getTime() + i * 86_400_000);
      // Create price pattern with minor weekly seasonality (more expensive on day of week 0/6)
      const dayFactor = (date.getDay() === 0 || date.getDay() === 6) ? 50 : 0;
      rows.push({
        roundtrip_price: 300 + dayFactor + (i % 5) * 5,
        observed_at: date.toISOString()
      });
    }

    const supabase = fakeSupabase({ rows });
    const service = new ForecastService({ supabase });

    const result = await service.forecastRoute('TLV', 'LCA', 320);
    expect(result.verdict).toBeDefined();
    expect(result.reason).toBe('seasonal_naive_forecast');
    expect(result.sampleSize).toBe(35);
    expect(result.low90Day).toBe(300);
    expect(result.high90Day).toBe(370);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(75);
    expect(result.confidenceScore).toBeLessThanOrEqual(95);
    expect(result.predictionInterval.lower).toBeLessThan(result.predictionInterval.upper);
    expect(result.priceHistory.length).toBe(7);
  });
});
