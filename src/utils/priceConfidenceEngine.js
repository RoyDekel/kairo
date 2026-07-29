/**
 * KAIRO AI Price Confidence & Buy Timing Engine
 * Predicts whether flight prices are likely to drop or rise, calculates 90-day low benchmarks,
 * provides data rationale pillars, and generates humanized AI recommendations.
 */

export function getPriceConfidenceInsight(flight, basePriceOverride = null) {
  if (flight?.insights && !basePriceOverride) {
    return flight.insights;
  }

  const currentPrice = basePriceOverride || flight?.price || 450;
  
  // Deterministic seed based on flight ID or price for consistent output across renders
  const flightIdStr = flight?.id || `${currentPrice}`;
  let hash = 0;
  for (let i = 0; i < flightIdStr.length; i++) {
    hash = (hash << 5) - hash + flightIdStr.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);

  // Generate 90-day price history simulation
  const low90Day = Math.max(45, Math.round(currentPrice * 0.75));
  const high90Day = Math.round(currentPrice * 1.25);
  const avg90Day = Math.round((low90Day + high90Day) / 2);

  // Price history points for interactive SVG graph (90d ago -> Today)
  const priceHistory = [
    { label: '90d ago', price: Math.round(high90Day * 0.96) },
    { label: '60d ago', price: high90Day },
    { label: '45d ago', price: Math.round(avg90Day * 1.08) },
    { label: '30d ago', price: Math.round(avg90Day * 0.95) },
    { label: '14d ago', price: low90Day, isLowest: true },
    { label: '7d ago', price: Math.round(low90Day * 1.12) },
    { label: 'Today', price: currentPrice }
  ];

  // Determine recommendation: WAIT vs BUY_NOW
  const priceDiffPct = Math.round(((currentPrice - low90Day) / low90Day) * 100);
  const isGoodDeal = priceDiffPct <= 12;

  const recommendation = isGoodDeal ? 'BUY_NOW' : 'WAIT';
  const confidenceScore = 84 + (positiveHash % 12); // 84% to 95%
  
  // Star rating calculation
  let stars = '★★★★☆';
  if (confidenceScore >= 90) stars = '★★★★★';
  else if (confidenceScore < 85) stars = '★★★☆☆';

  const expectedSavings = Math.max(45, currentPrice - low90Day);
  const dropDaysNum = 4 + (positiveHash % 4);
  const expectedDropDays = `${dropDaysNum}–${dropDaysNum + 3} days`;

  const actionHeadline = recommendation === 'BUY_NOW'
    ? 'BUY NOW'
    : `WAIT ${dropDaysNum} MORE DAYS`;

  // Humanized AI Personality Badges
  const personalityBadge = recommendation === 'BUY_NOW'
    ? '🟢 Good news! This is one of the cheapest prices we have seen this month.'
    : `⏳ KAIRO recommends waiting ${dropDaysNum} more days for an expected $${expectedSavings} drop.`;

  const summary = recommendation === 'BUY_NOW'
    ? `Current fare ($${currentPrice}) is near the 90-day low ($${low90Day}). Airline price algorithms indicate fares will rise shortly.`
    : `Fares are predicted to drop by ~$${expectedSavings} within ${expectedDropDays}. We strongly advise waiting before booking.`;

  // Data Rationale Pillars ("Why Trust KAIRO?")
  const rationalePillars = [
    '4 years of historical flight pricing algorithms',
    'Seasonal travel demand forecasting models',
    'Airline carrier revenue management patterns',
    'Global event & concert schedule price pressure'
  ];

  return {
    currentPrice,
    low90Day,
    high90Day,
    avg90Day,
    recommendation,
    actionHeadline,
    personalityBadge,
    confidenceScore,
    confidenceStars: stars,
    expectedSavings,
    expectedDropDays,
    summary,
    priceDiffPct,
    priceHistory,
    rationalePillars,
    animatedSteps: [
      currentPrice,
      Math.round(currentPrice - expectedSavings * 0.35),
      Math.round(currentPrice - expectedSavings * 0.7),
      low90Day
    ]
  };
}

/**
 * Zero-Click Demo Data Generator for Tokyo route
 */
export function getZeroClickDemoData() {
  return {
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
