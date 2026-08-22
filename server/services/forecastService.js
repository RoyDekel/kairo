import { getServerSupabase } from './supabaseServer.js';
import { FareHistory, percentileOf, medianOf } from './fareHistory.js';

export const MIN_OBS_FOR_FORECAST = 30;
export const MIN_OBS_FOR_STATS = 5;

/**
 * Seasonal period, in days. The naive forecast repeats the last week.
 */
export const SEASONAL_PERIOD_DAYS = 7;

/**
 * Distinct OBSERVATION DAYS required before a seasonal forecast is attempted.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHAT IT REPLACED
 *
 * MIN_OBS_FOR_FORECAST counts ROWS. The seasonal calculation consumes DAYS: it collapses
 * every row for a date into one median and then differences that series against itself at
 * a 7-day lag. A route could therefore satisfy the row threshold many times over and still
 * have nothing for the model to difference.
 *
 * Production on 6 Aug 2026: TLV-CDG held 78 observations — more than twice the row
 * threshold — spread over FIVE days. The old code entered tier 3 on the row count, found
 * M(5) < S(7), skipped the seasonal branch, and fell through to a hardcoded
 * `stdDev = 25`. Everything downstream was then a function of that constant:
 *
 *     cv              = 25 / avg90Day
 *     confidenceScore = 95 - cv * 100
 *
 * which is a function of PRICE LEVEL and nothing else. A $300 route reported 87%, a $600
 * route 91%, a $1000 route 93% — every time, for any market, however violently the fare
 * moved. The 80% prediction interval was a flat ±$32 for the same reason.
 *
 * This is the failure recorded in bdcb68a ("the Buy/Wait verdict was a constant, not a
 * calculation") reappearing one layer down, and it was live and user-facing.
 *
 * Gating on days rather than rows means the seasonal branch is now guaranteed to run when
 * tier 3 is entered, so the fallback constant has been deleted rather than made harder to
 * reach. Below this threshold the service reports tier 2 and a null confidence, which the
 * UI already knows how to render as "not enough history".
 */
export const MIN_DAYS_FOR_FORECAST = SEASONAL_PERIOD_DAYS;

/**
 * Days-to-departure for an observation.
 *
 * A fare quoted 14 days out and one quoted 90 days out are different products at
 * systematically different price levels. Pooling them into one daily median makes that
 * median a function of WHICH horizons happened to be sampled that day.
 *
 * That is not hypothetical. The collector's measured yield on 6 Aug 2026 was 18%-58% of
 * attempted samples: sweeps at 15:00, 18:00 and 19:00 recorded 1.69, 2.80 and 2.80
 * observations per route against an intended 4.00. So the horizon mix genuinely does
 * change from sweep to sweep, and an unnormalised median moves when no price has moved.
 */
export function horizonDaysOf(observedAt, departureDate) {
  if (!observedAt || !departureDate) return null;
  const observed = Date.parse(String(observedAt).slice(0, 10));
  const departure = Date.parse(String(departureDate).slice(0, 10));
  if (!Number.isFinite(observed) || !Number.isFinite(departure)) return null;
  return Math.round((departure - observed) / 86_400_000);
}

/**
 * Buckets a horizon onto the collector's sampling grid.
 *
 * User searches arrive at arbitrary horizons — 7, 37, 41, 45, 161 were all present in
 * production — so they cannot be compared to each other directly. Snapping to the nearest
 * decade of days gives enough buckets to separate "a fortnight out" from "three months
 * out" while still letting a 41-day user search inform the 40-day bucket.
 */
export function horizonBucketOf(horizonDays) {
  if (!Number.isFinite(horizonDays) || horizonDays < 0) return null;
  return Math.round(horizonDays / 10) * 10;
}

/**
 * Collapses raw observations into one price index per day, corrected for horizon mix.
 *
 * Each observation is expressed as a RATIO to the median of its own horizon bucket, the
 * day's index is the median of those ratios, and the result is rescaled by the global
 * median so the series stays in currency units for the UI.
 *
 * The effect: a day on which only the 90-day horizon survived is comparable to a day on
 * which all four did. Without this the series records the collector's failure rate as
 * price volatility, and stdDev — the whole basis of the confidence score — measures how
 * often Google refused us rather than how much fares moved.
 *
 * @returns {{timeline: Array<{date: string, price: number}>, distinctDays: number}}
 */
export function buildDailyIndex(rows = []) {
  const usable = [];

  for (const row of rows) {
    const price = Number(row.roundtrip_price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const date = String(row.observed_at || '').slice(0, 10);
    if (!date) continue;

    usable.push({
      date,
      price,
      bucket: horizonBucketOf(horizonDaysOf(row.observed_at, row.departure_date))
    });
  }

  if (usable.length === 0) return { timeline: [], distinctDays: 0 };

  // Median per horizon bucket, over the whole window.
  const byBucket = new Map();
  for (const obs of usable) {
    const key = obs.bucket ?? 'unknown';
    if (!byBucket.has(key)) byBucket.set(key, []);
    byBucket.get(key).push(obs.price);
  }
  const bucketMedian = new Map();
  for (const [key, prices] of byBucket) bucketMedian.set(key, medianOf(prices));

  const globalMedian = medianOf(usable.map((o) => o.price));

  // Ratio to own bucket, then median per day, then back to currency units.
  const byDay = new Map();
  for (const obs of usable) {
    const base = bucketMedian.get(obs.bucket ?? 'unknown');
    // A bucket of one observation has a median equal to that observation, giving a ratio
    // of exactly 1. That is correct: with nothing to compare against, the honest statement
    // is "typical for its horizon", not an invented deviation.
    const ratio = base && base > 0 ? obs.price / base : 1;
    if (!byDay.has(obs.date)) byDay.set(obs.date, []);
    byDay.get(obs.date).push(ratio);
  }

  const timeline = [...byDay.entries()]
    .map(([date, ratios]) => ({
      date,
      price: Math.round((medianOf(ratios.map((r) => r * 1000)) / 1000) * globalMedian)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { timeline, distinctDays: timeline.length };
}

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
   * @param {{source?: 'live'|'batch'}} options
   *   `source: 'batch'` marks a call from forecastBatch.js, the ONLY caller allowed to
   *   reach HF_ENDPOINT_URL while FORECAST_LIVE_HF_ENABLED=false. See the flag check below
   *   for why: HF Inference Endpoints bill per compute-hour the instance is running, not
   *   per request, with a scale-to-zero idle timer that every request resets. The nightly
   *   batch alone keeps that bounded to roughly one run a day; a live /api/flights request
   *   hitting an uncached-but-eligible route calls the exact same paid endpoint on the
   *   spot, and steady search traffic can keep re-arming the idle timer all day, defeating
   *   scale-to-zero entirely. Defaults to 'live' so an un-migrated call site (or a test)
   *   still exercises the same HF path as before this flag existed.
   * @returns {Promise<object>}
   */
  async forecastRoute(origin, destination, currentPrice, currency = 'USD', options = {}) {
    const { source = 'live' } = options;
    const route = FareHistory.routeKey(origin, destination);
    const validCurrency = String(currency || 'USD').toUpperCase().trim();

    if (!this.supabase) {
      return { verdict: null, reason: 'no_database', sampleSize: 0 };
    }

    const ninetyDaysAgo = new Date(this.now() - 90 * 86_400_000).toISOString();

    try {
      /*
        departure_date comes back too, because the horizon it implies is what makes two
        observations comparable. See buildDailyIndex.

        The provider lock is the same argument FARE_CURRENCY makes in .env.example: a
        median taken across mixed sources measures the difference between the sources.
        Production held 59 serpapi rows (1-2 Aug) and 1,133 fli rows (2-6 Aug) in one
        pool, so the provider switch injected a level shift into a five-day series and the
        model had no way to read it as anything but a price movement. Unset, the lock is
        off and behaviour is unchanged.
      */
      let query = this.supabase
        .from(this.table)
        .select('roundtrip_price, observed_at, departure_date, provider')
        .eq('route', route)
        .eq('currency', validCurrency)
        .gte('observed_at', ninetyDaysAgo);

      const providerLock = (process.env.FORECAST_PROVIDER || process.env.FLIGHT_PROVIDER || '').trim();
      // 'simulated' is skipped because fareHistory refuses to write those rows in the first
      // place, so locking to it would filter the table down to nothing.
      if (providerLock && providerLock !== 'simulated' && providerLock !== 'all') {
        query = query.eq('provider', providerLock);
      }

      const { data: rows, error } = await query
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

      /*
        One index per day, corrected for which horizons survived that day.

        This replaces a plain median over whatever rows shared a date. That median moved
        whenever the horizon mix moved, which — at a measured collector yield of 18%-58% —
        was most days, and the movement was indistinguishable from a fare change.
      */
      const { timeline: dailyTimeline, distinctDays } = buildDailyIndex(rows);

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

      /*
        Tier 2: enough observations to place a price, not enough to forecast one.

        The day condition is the new half. Rows alone never proved the seasonal branch
        could run: TLV-CDG cleared 30 rows nearly threefold on 78 observations spread over
        five days, entered tier 3 anyway, and reported a confidence derived from a
        hardcoded constant. Requiring MIN_DAYS_FOR_FORECAST distinct days means tier 3 is
        entered only when there is genuinely something to difference at a 7-day lag.

        `insufficientDays` is reported so the UI can say WHICH threshold is missing —
        "keep collecting" reads very differently from "this route is barely searched".
      */
      const hasEnoughDays = distinctDays >= MIN_DAYS_FOR_FORECAST;

      if (sampleSize < MIN_OBS_FOR_FORECAST || !hasEnoughDays) {
        const recommendation = pricePercentile <= 25 ? 'BUY_NOW' : 'WAIT';
        return {
          verdict: recommendation,
          reason: 'basic_statistics',
          sampleSize,
          distinctDays,
          insufficientDays: sampleSize >= MIN_OBS_FOR_FORECAST && !hasEnoughDays,
          low90Day,
          high90Day,
          avg90Day,
          pricePercentile,
          priceHistory: graphPoints,
          recommendation,
          // Deliberately null. A number here would have to be invented, and an invented
          // confidence is worse than an absent one: the UI can render "not enough history",
          // but it cannot un-tell a user it was 91% sure.
          confidenceScore: null,
          prices: rawPrices
        };
      }

      // Tier 3: Seasonal-Naive Forecast (>= 30 observations)
      const dailyPrices = dailyTimeline.map(pt => pt.price);
      const M = dailyPrices.length;

      const hfEndpointUrl = process.env.HF_ENDPOINT_URL;
      const hfApiKey = process.env.HF_API_KEY;

      // Default true: HF stays the live path's default too, unless explicitly turned off.
      const liveHfEnabled = process.env.FORECAST_LIVE_HF_ENABLED !== 'false';
      const hfAllowedForCaller = source === 'batch' || liveHfEnabled;

      if (hfEndpointUrl && hfEndpointUrl.trim() !== '' && hfAllowedForCaller) {
        try {
          const payload = {
            inputs: dailyPrices,
            parameters: {
              prediction_length: 7,
              num_samples: 20
            }
          };

          const headers = {
            'Content-Type': 'application/json'
          };
          if (hfApiKey && hfApiKey.trim() !== '') {
            headers['Authorization'] = `Bearer ${hfApiKey}`;
          }

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          let response;
          try {
            response = await fetch(hfEndpointUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(payload),
              signal: controller.signal
            });
          } finally {
            clearTimeout(timeoutId);
          }

          if (!response.ok) {
            throw new Error(`HF Endpoint returned status ${response.status}`);
          }

          const responseData = await response.json();
          let hfForecastMedian = null;
          let hfLower80 = null;
          let hfUpper80 = null;

          const data = Array.isArray(responseData) ? responseData[0] : responseData;
          if (data && data.quantiles) {
            const q50 = data.quantiles['0.5'] || data.quantiles['50'];
            const q10 = data.quantiles['0.1'] || data.quantiles['10'];
            const q90 = data.quantiles['0.9'] || data.quantiles['90'];

            if (Array.isArray(q50) && q50.length > 0) {
              hfForecastMedian = medianOf(q50.map(Number));
            }
            if (Array.isArray(q10) && q10.length > 0) {
              hfLower80 = Math.min(...q10.map(Number));
            }
            if (Array.isArray(q90) && q90.length > 0) {
              hfUpper80 = Math.max(...q90.map(Number));
            }
          } else if (data && Array.isArray(data.mean)) {
            /*
              A mean-only response carries no uncertainty, and the interval is left unset
              rather than manufactured from an assumed std of 25 — the same constant, and
              the same lie, as the seasonal fallback deleted below. Both hfLower80 and
              hfUpper80 stay null, the guard beneath rejects the response, and the seasonal
              path (which measures its own residuals) answers instead.

              Chronos-2 returns quantiles natively, so this branch should never fire against
              a correctly configured endpoint. If it does, that is worth discovering as a
              fallback rather than hiding behind a plausible-looking interval.
            */
            hfForecastMedian = medianOf(data.mean.map(Number));
            console.warn('[forecastService] HF response had no quantiles; cannot derive a prediction interval.');
          }

          if (hfForecastMedian !== null && hfLower80 !== null && hfUpper80 !== null) {
            const isCheaperThanForecast = currentPrice <= hfForecastMedian;
            const recommendation = (pricePercentile <= 25 || isCheaperThanForecast) ? 'BUY_NOW' : 'WAIT';
            
            const forecastRange = Math.max(10, hfUpper80 - hfLower80);
            const cv = forecastRange / (hfForecastMedian || 1);
            const confidenceScore = Math.min(95, Math.max(75, Math.round(95 - cv * 30)));
            const expectedSavings = Math.max(15, Math.round(currentPrice - Math.min(hfForecastMedian, low90Day)));

            console.log(`[forecastService] HF Dedicated Endpoint forecast succeeded for ${route}. Median: $${hfForecastMedian}`);

            return {
              verdict: recommendation,
              reason: 'huggingface_chronos_forecast',
              sampleSize,
              low90Day,
              high90Day,
              avg90Day,
              pricePercentile,
              priceHistory: graphPoints,
              recommendation,
              confidenceScore,
              expectedSavings,
              forecastMedian: hfForecastMedian,
              predictionInterval: { lower: hfLower80, upper: hfUpper80 },
              prices: rawPrices
            };
          }
          console.warn(`[forecastService] HF response format was unrecognized, falling back to seasonal-naive.`);
        } catch (apiErr) {
          console.warn(`[forecastService] HF Dedicated Endpoint failed: ${apiErr.message}. Falling back to seasonal-naive.`);
        }
      }

      /*
        Seasonal-naive over a weekly period.

        `if (M >= S)` and the `stdDev = 25` fallback beside it are both gone. Reaching this
        line already guarantees M >= MIN_DAYS_FOR_FORECAST === S, so the branch was
        unreachable-by-contract and the constant was reachable only through the bug it
        caused. Deleting it means there is no longer any path on which a confidence score
        is produced without a measured residual behind it.
      */
      const S = SEASONAL_PERIOD_DAYS;
      const last7Prices = dailyPrices.slice(-S);
      const forecastMedian = medianOf(last7Prices);

      // Residuals at the seasonal lag: what last week failed to predict about this week.
      const residuals = [];
      for (let i = S; i < M; i++) {
        residuals.push(dailyPrices[i] - dailyPrices[i - S]);
      }

      /*
        Exactly S days gives zero residuals, and S+1 gives one — too few for a sample
        variance, which needs the n-1 correction to mean anything. Rather than substitute a
        constant, report tier 2: the forecast is real but its uncertainty is not yet
        measurable, and a prediction interval nobody measured is not a prediction interval.
      */
      if (residuals.length < 2) {
        return {
          verdict: pricePercentile <= 25 ? 'BUY_NOW' : 'WAIT',
          reason: 'basic_statistics',
          sampleSize,
          distinctDays,
          insufficientDays: true,
          low90Day,
          high90Day,
          avg90Day,
          pricePercentile,
          priceHistory: graphPoints,
          recommendation: pricePercentile <= 25 ? 'BUY_NOW' : 'WAIT',
          confidenceScore: null,
          prices: rawPrices
        };
      }

      const meanResidual = residuals.reduce((a, b) => a + b, 0) / residuals.length;
      const variance = residuals.reduce((a, b) => a + Math.pow(b - meanResidual, 2), 0) / (residuals.length - 1);
      const stdDev = Math.max(10, Math.sqrt(variance));

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
        // Reported alongside sampleSize because they are not interchangeable and the UI
        // was showing the flattering one. "145 observations" sounds authoritative; the
        // model ran on five days.
        distinctDays,
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
