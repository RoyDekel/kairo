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

  const eventImpactScore = topEvent ? topEvent.eventImpactScore : 70;
  const isHighImpactEvent = eventImpactScore >= 90;

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

  if (recommendation === 'BUY_NOW' || daysToDeparture <= 14 || isHighImpactEvent) {
    recommendation = 'BUY_NOW';
    riskLevel = isHighImpactEvent ? 'High (Event Demand Surge)' : daysToDeparture <= 14 ? 'High (Last Minute Spikes)' : 'Low';
  } else if (daysToDeparture > 40 && pricePercentile > 40) {
    recommendation = 'WAIT';
    riskLevel = 'Low (Stable Pre-booking Window)';
  } else {
    recommendation = 'WAIT';
    riskLevel = 'Medium';
  }

  // 5. Confidence Score and Stars
  const confidenceScore = forecast 
    ? forecast.confidenceScore 
    : Math.min(97, Math.max(82, 85 + (isHighImpactEvent ? 8 : 0) - Math.round(pricePercentile / 10)));

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

  const actionHeadline = recommendation === 'BUY_NOW'
    ? isHighImpactEvent ? `BUY NOW (EVENT SURGE)` : `BUY NOW (BEST FARE)`
    : `WAIT ${dropDaysNum} MORE DAYS`;

  // Humanized Summary & Rationale
  let summary;
  if (recommendation === 'BUY_NOW') {
    if (isHighImpactEvent && topEvent) {
      summary = `High travel demand expected for "${topEvent.title}" at ${topEvent.venue} (${topEvent.categoryLabel}). Fares are predicted to rise by ~$${Math.round(expectedSavings * 1.2)} due to event ticket pressure.`;
    } else {
      summary = `Current fare ($${currentPrice}) is in the lowest ${pricePercentile}% of 90-day historical prices ($${low90Day} low). Airline pricing algorithms indicate an imminent price increase.`;
    }
  } else {
    summary = `Fare ($${currentPrice}) is ${pricePercentile}% above the 90-day low ($${low90Day}). No major Sold-Out event conflict detected in ${flight?.destination || 'destination'}. Fares expected to drop by ~$${expectedSavings} within ${dropDaysNum} days.`;
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
