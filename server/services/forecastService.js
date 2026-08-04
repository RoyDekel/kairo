import { getServerSupabase } from './supabaseServer.js';
import { FareHistory, percentileOf, medianOf } from './fareHistory.js';

export const MIN_OBS_FOR_FORECAST = 30;
export const MIN_OBS_FOR_STATS = 5;

export class ForecastService {
  constructor({ supabase = null, table = 'fare_observations', now = () => Date.now() } = {}) {
    this.supabase = supabase;
    this.table = table;
    this.now = now;
  }

  /**
   * Retrieves historical prices for a route, performs data tiering, and
   * computes statistical / seasonal-naive forecasts.
   *
   * @param {string} origin
   * @param {string} destination
   * @param {number} currentPrice
   * @param {string} currency
   * @returns {Promise<object>}
   */
  async forecastRoute(origin, destination, currentPrice, currency = 'USD') {
    const route = FareHistory.routeKey(origin, destination);
    const validCurrency = String(currency || 'USD').toUpperCase().trim();

    if (!this.supabase) {
      return { verdict: null, reason: 'no_database', sampleSize: 0 };
    }

    const ninetyDaysAgo = new Date(this.now() - 90 * 86_400_000).toISOString();

    try {
      const { data: rows, error } = await this.supabase
        .from(this.table)
        .select('roundtrip_price, observed_at')
        .eq('route', route)
        .eq('currency', validCurrency)
        .gte('observed_at', ninetyDaysAgo)
        .order('observed_at', { ascending: true })
        .limit(1000);

      if (error) {
        console.warn(`[forecastService] Read failed for ${route}: ${error.message}`);
        return { verdict: null, reason: 'database_error', sampleSize: 0 };
      }

      const sampleSize = rows?.length || 0;

      // Tier 1: Insufficient History (< 5 observations)
      if (sampleSize < MIN_OBS_FOR_STATS) {
        return {
          verdict: null,
          reason: 'insufficient_history',
          sampleSize
        };
      }

      const rawPrices = rows.map(r => Number(r.roundtrip_price));
      const sortedPrices = [...rawPrices].sort((a, b) => a - b);
      const low90Day = sortedPrices[0];
      const high90Day = sortedPrices[sortedPrices.length - 1];
      const avg90Day = medianOf(sortedPrices);
      const pricePercentile = percentileOf(currentPrice, rawPrices);

      // Create a clean daily timeline for price history graph
      const dailyMap = new Map();
      for (const row of rows) {
        const dateStr = row.observed_at.split('T')[0];
        if (!dailyMap.has(dateStr)) {
          dailyMap.set(dateStr, []);
        }
        dailyMap.get(dateStr).push(Number(row.roundtrip_price));
      }

      // Calculate median for each date
      const dailyTimeline = [];
      for (const [dateStr, prices] of dailyMap.entries()) {
        dailyTimeline.push({
          date: dateStr,
          price: medianOf(prices)
        });
      }
      dailyTimeline.sort((a, b) => a.date.localeCompare(b.date));

      // Construct a real priceHistory array for UI (up to 7 points)
      const graphPoints = [];
      const numPoints = dailyTimeline.length;
      if (numPoints <= 7) {
        dailyTimeline.forEach(pt => {
          graphPoints.push({ label: pt.date.slice(5), price: pt.price });
        });
      } else {
        // Take 7 evenly distributed points
        for (let i = 0; i < 7; i++) {
          const idx = Math.min(numPoints - 1, Math.floor((i / 6) * (numPoints - 1)));
          const pt = dailyTimeline[idx];
          graphPoints.push({ label: pt.date.slice(5), price: pt.price });
        }
      }
      // Set the lowest point indicator
      const minGraphPrice = Math.min(...graphPoints.map(g => g.price));
      const lowestPt = graphPoints.find(g => g.price === minGraphPrice);
      if (lowestPt) lowestPt.isLowest = true;

      // Tier 2: Basic Statistics (5 to 29 observations)
      if (sampleSize < MIN_OBS_FOR_FORECAST) {
        const recommendation = pricePercentile <= 25 ? 'BUY_NOW' : 'WAIT';
        return {
          verdict: recommendation,
          reason: 'basic_statistics',
          sampleSize,
          low90Day,
          high90Day,
          avg90Day,
          pricePercentile,
          priceHistory: graphPoints,
          recommendation,
          confidenceScore: null, // No numeric confidence for tier 2
          prices: rawPrices
        };
      }

      // Tier 3: Seasonal-Naive Forecast (>= 30 observations)
      const dailyPrices = dailyTimeline.map(pt => pt.price);
      const M = dailyPrices.length;

      // Seasonal period of 7 days (weekly seasonality)
      const S = 7;
      let forecastMedian = avg90Day;
      let stdDev = 25; // fallback standard deviation

      if (M >= S) {
        // Forecast for next 7 days is repeating the last 7 observed daily prices
        const last7Prices = dailyPrices.slice(-S);
        forecastMedian = medianOf(last7Prices);

        // Compute residuals (y_t - y_t-7) to estimate variance
        const residuals = [];
        for (let i = S; i < M; i++) {
          residuals.push(dailyPrices[i] - dailyPrices[i - S]);
        }

        if (residuals.length >= 2) {
          const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
          const variance = residuals.reduce((a, b) => a + Math.pow(b - meanResidual, 2), 0) / (residuals.length - 1);
          stdDev = Math.max(10, Math.sqrt(variance));
        }
      }

      // Calculate 80% prediction interval (z = 1.28)
      const lower80 = Math.max(10, Math.round(forecastMedian - 1.28 * stdDev));
      const upper80 = Math.round(forecastMedian + 1.28 * stdDev);

      // Decision logic: BUY_NOW if current price is low relative to recent history or forecast
      const isCheaperThanForecast = currentPrice <= forecastMedian;
      const recommendation = (pricePercentile <= 25 || isCheaperThanForecast) ? 'BUY_NOW' : 'WAIT';

      // Dynamic confidence score based on historical volatility (coefficient of variation)
      const cv = stdDev / (avg90Day || 1);
      // More volatility = less confidence. Bounded between 75% and 95%.
      const confidenceScore = Math.min(95, Math.max(75, Math.round(95 - cv * 100)));

      // Expected savings if waiting (from current price to forecast median or historical low)
      const expectedSavings = Math.max(15, Math.round(currentPrice - Math.min(forecastMedian, low90Day)));

      return {
        verdict: recommendation,
        reason: 'seasonal_naive_forecast',
        sampleSize,
        low90Day,
        high90Day,
        avg90Day,
        pricePercentile,
        priceHistory: graphPoints,
        recommendation,
        confidenceScore,
        expectedSavings,
        forecastMedian,
        predictionInterval: { lower: lower80, upper: upper80 },
        prices: rawPrices
      };
    } catch (err) {
      console.warn(`[forecastService] Forecast execution failed for ${route}: ${err.message}`);
      return { verdict: null, reason: 'error', sampleSize: 0 };
    }
  }
}

export const forecastService = new ForecastService({ supabase: getServerSupabase() });
