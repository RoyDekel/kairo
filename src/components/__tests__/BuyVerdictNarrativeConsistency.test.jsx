import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BuyVerdict from '../BuyVerdict';

/*
  The badge, the accent colour and the paragraph under them are one answer.

  BuyVerdict reads `insight.recommendation` for the headline and the colour, and
  `insight.summary` for the sentence beneath. Those two fields are produced together by one
  rule in server/services/insightsEngine.js, and the client has neither the fare sample nor
  the forecast median that rule consumes. When the client re-decided `recommendation` on its
  own — from a crude "within 12% of the 90-day low" comparison — the panel could show a green
  "Book now" headline above a paragraph explaining why fares were about to fall.
*/

/** Shaped as computeEventDrivenInsights returns it: no `prices`, no `forecastMedian`. */
const waitInsights = {
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
  reason: 'seasonal_naive_forecast'
};

const buyInsights = {
  ...waitInsights,
  currentPrice: 620,
  pricePercentile: 18,
  recommendation: 'BUY_NOW',
  actionHeadline: 'BUY NOW (BEST FARE)',
  expectedSavings: 160,
  summary: 'Current fare ($620) is in the lowest 18% of 90-day historical prices ($460 low). Airline pricing algorithms indicate an imminent price increase.',
  verdict: 'BUY_NOW'
};

const flightWith = (insights, price) => ({
  id: 'LO-101-outbound-2026-09-20',
  price,
  airlineCode: 'LO',
  airlineName: 'LOT Polish Airlines',
  flightNumber: 'LO101',
  origin: 'TLV',
  destination: 'BCN',
  cabinClass: 'Economy',
  passengerCosts: { total: price },
  insights
});

describe('BuyVerdict headline and narrative', () => {
  test('a WAIT payload renders the wait headline, not a book-now one', () => {
    // $500 sits 9% above the $460 low, which the deleted client rule scored as BUY_NOW
    // while the summary below it still argued for waiting.
    render(
      <BuyVerdict
        activeFlight={flightWith(waitInsights, 500)}
        activeRoundtrip={null}
        selectedDate="2026-09-20"
      />
    );

    expect(screen.getByText(/Save ~\$40 by waiting/)).toBeInTheDocument();
    expect(screen.queryByText(/Book now — this is the price/)).not.toBeInTheDocument();
    expect(screen.getByText(waitInsights.summary)).toBeInTheDocument();
  });

  test('a BUY_NOW payload renders the book-now headline, not a wait one', () => {
    // $620 sits 35% above the low — the deleted client rule scored that as WAIT.
    render(
      <BuyVerdict
        activeFlight={flightWith(buyInsights, 620)}
        activeRoundtrip={null}
        selectedDate="2026-09-20"
      />
    );

    expect(screen.getByText(/Book now — this is the price/)).toBeInTheDocument();
    expect(screen.queryByText(/by waiting/)).not.toBeInTheDocument();
    expect(screen.getByText(buyInsights.summary)).toBeInTheDocument();
  });

  test('the market engine moving the price does not rewrite the verdict', () => {
    // App.jsx ticks activeFlight.price by ±$5 every 8s and never refetches insights.
    render(
      <BuyVerdict
        activeFlight={flightWith(waitInsights, 495)}
        activeRoundtrip={null}
        selectedDate="2026-09-20"
      />
    );

    expect(screen.getByText(/Save ~\$40 by waiting/)).toBeInTheDocument();
    expect(screen.getByText(waitInsights.summary)).toBeInTheDocument();
    // The fare on display is the live one.
    expect(screen.getByText('$495')).toBeInTheDocument();
  });
});
