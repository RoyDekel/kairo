import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BuyVerdict from '../BuyVerdict';

/*
  The server withholds a verdict for two different reasons. The panel used to have one
  message for "no verdict" — insufficient history — so a round trip with no return flights
  would have been explained to the user as a route we had not observed enough.
*/

const flightWith = (insights) => ({
  id: 'W6-2097-return-2026-09-14',
  price: 218,
  airlineCode: 'W6',
  airlineName: 'Wizz Air',
  flightNumber: 'W6 2097',
  origin: 'KRK',
  destination: 'TLV',
  cabinClass: 'Economy',
  passengerCosts: { total: 218 },
  insights
});

describe('BuyVerdict with no verdict', () => {
  test('explains an incomplete round trip as missing flights, not missing history', () => {
    render(
      <BuyVerdict
        activeFlight={flightWith({
          currentPrice: 218,
          recommendation: null,
          verdict: null,
          reason: 'incomplete_roundtrip',
          missingDirection: 'outbound',
          summary: "No outbound flights were found for these dates, so there is no round-trip fare to compare with this route's history.",
          sampleSize: null
        })}
        activeRoundtrip={null}
        selectedDate="2026-09-14"
      />
    );

    expect(screen.getByText('No verdict for this trip')).toBeInTheDocument();
    expect(screen.getByText(/No outbound flights were found for these dates/)).toBeInTheDocument();
    expect(screen.queryByText(/Insufficient history/)).not.toBeInTheDocument();
    expect(screen.queryByText('History status')).not.toBeInTheDocument();
  });

  test('names one-way history when a one-way fare has too little of it', () => {
    render(
      <BuyVerdict
        activeFlight={flightWith({
          currentPrice: 218,
          recommendation: null,
          verdict: null,
          reason: 'insufficient_history',
          tripType: 'oneway',
          sampleSize: 0
        })}
        activeRoundtrip={null}
        selectedDate="2026-09-14"
      />
    );

    expect(screen.getByText('Insufficient one-way history for this route')).toBeInTheDocument();
    expect(screen.getByText(/We have observed one-way fares on this route only 0 times/)).toBeInTheDocument();
  });

  test('keeps the insufficient-history message for that reason', () => {
    render(
      <BuyVerdict
        activeFlight={flightWith({
          currentPrice: 218,
          recommendation: null,
          verdict: null,
          reason: 'insufficient_history',
          sampleSize: 3
        })}
        activeRoundtrip={null}
        selectedDate="2026-09-14"
      />
    );

    expect(screen.getByText('Insufficient history for this route')).toBeInTheDocument();
    expect(screen.getByText('History status')).toBeInTheDocument();
    expect(screen.getByText('3 / 5')).toBeInTheDocument();
  });
});
