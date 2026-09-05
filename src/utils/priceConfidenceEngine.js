/**
 * KAIRO AI Price Confidence & Buy Timing Engine
 * Presenter that reads genuine statistical trends and forecasts computed by the server.
 */

/**
 * Presents the server's buy/wait analysis for one flight.
 *
 * `basePriceOverride` is the price the CLIENT currently shows. It can differ from the price
 * the server priced: App.jsx's market engine moves the tracked fare by ±$5 every 8 seconds
 * and never refetches `insights`. So the override is honoured for `currentPrice` — the fare
 * the user is looking at, which the stat rows and verdictEvidence read — and for nothing
 * else.
 *
 * ---------------------------------------------------------------------------------------
 * WHY NOTHING ELSE IS RECOMPUTED HERE
 *
 * `recommendation`, `pricePercentile`, `expectedSavings`, `actionHeadline` and `summary` are
 * one answer, produced together by one rule in server/services/insightsEngine.js. That rule
 * consumes the 90-day fare sample and the Chronos forecast median. Neither is in the
 * payload — `computeEventDrivenInsights` returns `priceHistory` (7 display points) and no
 * `prices` array, and it does not pass `forecastMedian` through — so the client cannot re-run
 * it, only guess at it.
 *
 * It used to guess. Two branches ran here:
 *
 *   - one gated on `insights.prices`, which the server has never sent, so it was dead. It
 *     also still carried the "BUY NOW (EVENT SURGE)" headline and the "fares predicted to
 *     rise by ~$X due to event ticket pressure" narrative that PR #36 deleted server-side
 *     for asserting a fare effect no estimator produces. Both are gone with the branch.
 *
 *   - the `else`, which therefore ran on EVERY render of the verdict panel, overwrote
 *     `recommendation` from `priceDiffPct <= 12` — is this fare within 12% of the 90-day
 *     low — and left `summary`, `actionHeadline` and `pricePercentile` describing the
 *     server's verdict. The two rules disagree at the same price, so the panel could show a
 *     green "Book now — this is the price" above a paragraph explaining why fares were
 *     about to fall, on the first render, with nothing stale involved.
 *
 * A presenter may restate the server's verdict. It may not reach a different one. If the
 * verdict genuinely needs to move with a client-side price change, the price has to go back
 * to the server, because that is where the model lives.
 */
export function getPriceConfidenceInsight(flight, basePriceOverride = null) {
  if (!flight?.insights) {
    return {
      verdict: null,
      recommendation: null,
      reason: 'insufficient_history',
      priceHistory: null,
      summary: 'No historical price data available for this route.'
    };
  }

  // Clone backend insights to avoid mutations
  const insights = { ...flight.insights };

  if (basePriceOverride !== null && basePriceOverride !== undefined) {
    insights.currentPrice = basePriceOverride;
  }

  return insights;
}

/**
 * Zero-Click Demo Data Generator for Tokyo route
 */
export function getZeroClickDemoData() {
  return {
    isDemo: true,
    routeStr: 'Tel Aviv → Tokyo (NRT)',
    destinationName: 'Tokyo, Japan',
    currentPrice: 814,
    low90Day: 718,
    high90Day: 1120,
    recommendation: 'WAIT',
    actionHeadline: 'WAIT 6 MORE DAYS',
    personalityBadge: '⏳ KAIRO recommends waiting 6 more days for an expected $96 drop.',
    confidenceScore: 89,
    confidenceStars: '★★★★☆',
    expectedSavings: 96,
    expectedDropDays: '6 days',
    summary: 'Current price is $814. Expected to drop ~$96 within 6 days based on 89% historical model confidence.',
    rationalePillars: [
      '4 years of historical flight price analytics',
      'Seasonal demand forecasting models',
      'Airline carrier pricing trend patterns',
      'Live concert & sports event schedule metrics'
    ],
    priceHistory: [
      { label: 'Apr 30', price: 1080 },
      { label: 'May 30', price: 950 },
      { label: 'Jun 14', price: 890 },
      { label: 'Jun 29', price: 718, isLowest: true },
      { label: 'Jul 15', price: 790 },
      { label: 'Jul 22', price: 845 },
      { label: 'Today', price: 814 }
    ],
    animatedSteps: [814, 780, 745, 718]
  };
}
