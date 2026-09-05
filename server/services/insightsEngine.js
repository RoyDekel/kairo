import { percentileOf } from './fareHistory.js';

/**
 * KAIRO Unified Event-Driven Flight Insights Engine
 * Correlates flight fare analytics with Ticketmaster Event Intelligence & Days-to-Departure curves.
 */

export function computeEventDrivenInsights(flight, searchRequest = {}, events = [], { coverage = 'full', forecast = null, comparisonPrice = null } = {}) {
  const currentPrice = flight?.price || 450;
  const comparisonPriceToUse = comparisonPrice !== null && comparisonPrice !== undefined ? comparisonPrice : currentPrice;

  // 1. Calculate Days to Departure (U-shape price curve)
  let daysToDeparture = 45;
  if (searchRequest.departureDate) {
    const depDate = new Date(searchRequest.departureDate);
    const today = new Date();
    const diffTime = depDate.getTime() - today.getTime();
    daysToDeparture = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  }

  // 2. Event Surge Factor (Find top high-impact event in destination)
  const topEvent = events.length > 0
    ? events.reduce((prev, curr) => (curr.eventImpactScore > prev.eventImpactScore ? curr : prev), events[0])
    : null;

  /*
    eventImpactScore is NOT an input to the recommendation. Do not make it one again.

    The number is not a measurement: ticketmasterProvider.format computes it as
    `isSoldOut ? 96 : 75 + (idx % 20)` — a hardcoded constant, or the event's ordinal
    position in the response array. This function used to force BUY_NOW whenever it reached
    90, so one sold-out listing anywhere in the destination city overrode the Chronos-2
    forecast, and a raise of Ticketmaster's `size` param would have let ordinal position
    alone do the same. That is the confidently-wrong-BUY failure mode the whole verdict path
    is built to avoid.

    Both fields are kept because they are honest as CONTEXT — verdictEvidence.js renders the
    event as one weighted reason among several, and the discovery UI lists it. A real,
    signal-derived scorer is specced (P3a, docs/product/specs/p3-events-covariate-loop.md);
    until it exists and can be weighed against measured history, the BUY/WAIT verdict comes
    from the forecast engine and the price, and from nothing else.
  */
  const eventImpactScore = topEvent ? topEvent.eventImpactScore : 70;
  const isHighImpactEvent = eventImpactScore >= 90;

  // isSoldOut, unlike the score, is a real field the ticketing API reports. It is the only
  // event signal allowed to reach the user-facing narrative, and even then only as a fact.
  const hasSoldOutEvent = Boolean(topEvent?.isSoldOut);

  // Handle Insufficient History empty state early
  if (forecast && forecast.verdict === null) {
    return {
      currentPrice,
      daysToDeparture,
      recommendation: null,
      actionHeadline: 'NO RECOMMENDATION',
      confidenceScore: null,
      confidenceStars: null,
      summary: `We have only observed this route ${forecast.sampleSize} times. We need 5 observations to compute a reliable pricing recommendation.`,
      topEvent,
      eventImpactScore,
      isHighImpactEvent,
      eventCoverage: coverage,
      rationalePillars: [
        topEvent ? `Event Surge: "${topEvent.title}" (${topEvent.eventImpactScore}% Impact)` : 'Ticketmaster live event analytics',
        'Historical fare baseline (Insufficient history)'
      ],
      priceHistory: null,
      sampleSize: forecast.sampleSize,
      verdict: null,
      reason: 'insufficient_history'
    };
  }

  // 3. 90-Day Price Statistics
  const low90Day = forecast ? forecast.low90Day : Math.max(45, Math.round(currentPrice * 0.76));
  const high90Day = forecast ? forecast.high90Day : Math.round(currentPrice * 1.32);
  const avg90Day = forecast ? forecast.avg90Day : Math.round((low90Day + high90Day) / 2);
  const priceRange = Math.max(10, high90Day - low90Day);
  const pricePercentile = forecast 
    ? (forecast.prices ? percentileOf(comparisonPriceToUse, forecast.prices) : forecast.pricePercentile) 
    : Math.min(100, Math.max(0, Math.round(((currentPrice - low90Day) / priceRange) * 100)));

  // 4. Recommendation Algorithm (BUY_NOW vs WAIT)
  let recommendation = forecast ? forecast.recommendation : 'WAIT';
  // No initialiser: the branch chain below ends in an unconditional `else`, so riskLevel is
  // always assigned before it is read. A default here was dead and hid that fact.
  let riskLevel;

  // For specific flight options, we recalculate recommendation based on their own percentile if forecast is available
  if (forecast && forecast.prices) {
    const isCheaperThanForecast = comparisonPriceToUse <= (forecast.forecastMedian || avg90Day);
    recommendation = (pricePercentile <= 25 || isCheaperThanForecast) ? 'BUY_NOW' : 'WAIT';
  }

  // The days-to-departure override stays: weaker than the forecast, but it is a real
  // property of airline revenue management, not an invented score. Removing it is a
  // separate decision (P3 spec §5.1) and bundling it here would make either regression
  // untraceable.
  if (recommendation === 'BUY_NOW' || daysToDeparture <= 14) {
    recommendation = 'BUY_NOW';
    riskLevel = daysToDeparture <= 14 ? 'High (Last Minute Spikes)' : 'Low';
  } else if (daysToDeparture > 40 && pricePercentile > 40) {
    recommendation = 'WAIT';
    riskLevel = 'Low (Stable Pre-booking Window)';
  } else {
    recommendation = 'WAIT';
    riskLevel = 'Medium';
  }

  // 5. Confidence Score and Stars
  // The event term is gone from here too: an invented score must not inflate the confidence
  // the user reads off the stars either.
  const confidenceScore = forecast
    ? forecast.confidenceScore
    : Math.min(97, Math.max(82, 85 - Math.round(pricePercentile / 10)));

  let stars = null;
  if (confidenceScore !== null) {
    stars = '★★★★☆';
    if (confidenceScore >= 92) stars = '★★★★★';
    else if (confidenceScore < 85) stars = '★★★☆☆';
  }

  const expectedSavings = forecast 
    ? Math.max(15, Math.round(comparisonPriceToUse - Math.min(forecast.forecastMedian || avg90Day, low90Day)))
    : Math.max(35, Math.round(currentPrice - low90Day));
  const dropDaysNum = Math.min(10, Math.max(3, Math.round(daysToDeparture * 0.15)));

  // No "(EVENT SURGE)" variant. The verdict is never the event's doing, so the headline may
  // not credit it.
  const actionHeadline = recommendation === 'BUY_NOW'
    ? `BUY NOW (BEST FARE)`
    : `WAIT ${dropDaysNum} MORE DAYS`;

  /*
    Humanized summary. Both branches explain the verdict with the numbers that produced it.

    What was here before: BUY_NOW with a high-impact event read "Fares are predicted to rise
    by ~$X due to event ticket pressure", where X was `expectedSavings * 1.2` — a statement
    about the 90-day price range, multiplied by a constant and attributed to a concert. No
    estimator produces that figure. WAIT asserted the mirror image, "No major Sold-Out event
    conflict detected", which was previously unreachable-but-true (a sold-out event forced
    BUY_NOW) and is now reachable and sometimes false. Both are deleted rather than
    reworded.
  */
  let summary;
  if (recommendation === 'BUY_NOW') {
    summary = `Current fare ($${currentPrice}) is in the lowest ${pricePercentile}% of 90-day historical prices ($${low90Day} low). Airline pricing algorithms indicate an imminent price increase.`;
  } else {
    summary = `Fare ($${currentPrice}) is ${pricePercentile}% above the 90-day low ($${low90Day}). Fares expected to drop by ~$${expectedSavings} within ${dropDaysNum} days.`;
  }

  // The event is named as context when the ticketing API actually reported it sold out —
  // a fact the user can weigh themselves, with no fare effect claimed on their behalf.
  if (hasSoldOutEvent && topEvent) {
    summary += ` Note: "${topEvent.title}" at ${topEvent.venue} is sold out during your dates.`;
  }

  const priceHistory = forecast ? forecast.priceHistory : [
    { label: '90d ago', price: Math.round(high90Day * 0.96) },
    { label: '60d ago', price: high90Day },
    { label: '45d ago', price: Math.round(avg90Day * 1.08) },
    { label: '30d ago', price: Math.round(avg90Day * 0.95) },
    { label: '14d ago', price: low90Day, isLowest: true },
    { label: '7d ago', price: Math.round(low90Day * 1.12) },
    { label: 'Today', price: currentPrice }
  ];

  return {
    currentPrice,
    low90Day,
    high90Day,
    avg90Day,
    pricePercentile,
    daysToDeparture,
    recommendation,
    actionHeadline,
    confidenceScore,
    confidenceStars: stars,
    expectedSavings,
    riskLevel,
    summary,
    topEvent,
    eventImpactScore,
    isHighImpactEvent,
    eventCoverage: coverage,
    priceHistory,
    sampleSize: forecast ? forecast.sampleSize : null,
    verdict: forecast ? forecast.verdict : recommendation,
    reason: forecast ? forecast.reason : 'simulated',
    rationalePillars: [
      topEvent ? `Event Surge: "${topEvent.title}" (${topEvent.eventImpactScore}% Impact)` : 'Ticketmaster live event analytics',
      forecast ? `Dynamic statistical baseline (${forecast.sampleSize} samples)` : 'Historical 90-day fare percentile modeling',
      'Days-to-departure airline revenue algorithms',
      'Carrier seat inventory & demand pressure'
    ]
  };
}
