import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import AlternativeFlights from '../AlternativeFlights.jsx';

vi.mock('../../contexts/authContext', () => ({
  useAuth: () => ({ session: null, user: null, isAuthenticated: false }),
}));

/*
  The search panel is a DRAFT. Typing a new destination must not change what the rest of the
  app thinks is being searched until Search is pressed -- that is deliberate and is what the
  comment on the old re-hydration effect was protecting. But the draft must also not go stale:
  when "When to Go" hands a destination over to "Search & Compare", App.jsx passes down a new
  `searchParams` object and the form has to adopt it.

  That adoption used to be an effect setting all ten fields, which meant one committed frame
  in between where the form still displayed the previous search. These tests pin both halves:
  the draft stays uncommitted, and no committed frame ever shows the superseded values.
  See [KAI-001].
*/

const makeFlights = () => ([{
  id: 'f-0',
  flightNumber: 'LH 100',
  airlineCode: 'LH',
  airlineName: 'Lufthansa',
  departureTime: '08:00',
  arrivalTime: '12:00',
  price: 200,
  stopsCount: 0,
  stops: 'Direct',
  duration: '4h 0m',
  cabinClass: 'Economy',
  passengerCosts: { adults: 200, total: 200 },
  planeType: 'Airbus A321neo',
  departureDate: '2026-10-11',
}]);

const makeSearchParams = (overrides = {}) => ({
  origin: 'TLV',
  destination: 'KRK',
  departureDate: '2026-10-11',
  returnDate: '2026-10-18',
  tripType: 'round-trip',
  stops: '0',
  travelClass: 'ALL',
  passengers: { adults: 1, children: 0, infants: 0 },
  ...overrides,
});

// Selected by id: the panel renders desktop and mobile variants of several controls, so
// label and title text are not unique in the tree.
const destinationInput = () => document.querySelector('#arrival-airport-select');
const originInput = () => document.querySelector('#departure-airport-select');
const swapButton = () => screen.getAllByLabelText('Swap Departure and Arrival Airports')[0];

describe('AlternativeFlights draft search form', () => {
  let setSearchParams;

  const props = () => ({
    setSelectedDate: vi.fn(),
    setActiveFlight: vi.fn(),
    setSearchParams,
    setActiveRoundtrip: vi.fn(),
    setActiveTab: vi.fn(),
  });

  beforeEach(() => {
    setSearchParams = vi.fn();
    vi.stubGlobal('fetch', vi.fn((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/flights')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            outbound: makeFlights(),
            return: makeFlights(),
            provider: 'fli',
            currency: 'USD',
          }),
        });
      }
      return Promise.reject(new Error(`Unmocked fetch in AlternativeFlightsDraftForm.test: ${urlStr}`));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates the form from the current search', () => {
    render(<AlternativeFlights searchParams={makeSearchParams()} {...props()} />);

    expect(originInput()).toHaveValue('Tel Aviv (TLV)');
    expect(destinationInput()).toHaveValue('Krakow (KRK)');
  });

  it('keeps an edit uncommitted until Search is pressed', () => {
    const searchParams = makeSearchParams();
    const { rerender } = render(
      <AlternativeFlights searchParams={searchParams} {...props()} />
    );

    fireEvent.change(destinationInput(), { target: { value: 'CDG' } });

    // The draft changed; the app-wide search has not.
    expect(destinationInput()).toHaveValue('Paris (CDG)');
    expect(setSearchParams).not.toHaveBeenCalled();

    // And the draft survives a re-render that is not a new search.
    rerender(<AlternativeFlights searchParams={searchParams} {...props()} />);

    expect(destinationInput()).toHaveValue('Paris (CDG)');
    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it('never paints a committed frame still showing the superseded search', async () => {
    const seen = [];
    const record = () => {
      const input = destinationInput();
      if (input) seen.push(input.value);
    };

    const { rerender } = render(
      <Profiler id="draft" onRender={record}>
        <AlternativeFlights searchParams={makeSearchParams()} {...props()} />
      </Profiler>
    );
    await screen.findByText('LH 100');
    seen.length = 0;

    // The "When to Go" -> "Search & Compare" handoff: a brand new searchParams object.
    await act(async () => {
      rerender(
        <Profiler id="draft" onRender={record}>
          <AlternativeFlights searchParams={makeSearchParams({ destination: 'CDG' })} {...props()} />
        </Profiler>
      );
    });

    expect(destinationInput()).toHaveValue('Paris (CDG)');
    // Not one committed frame may still show Krakow: that is the cascading render.
    expect(seen.filter((v) => v.includes('KRK'))).toEqual([]);
  });

  it('discards an uncommitted edit when a new search is handed down', async () => {
    const { rerender } = render(
      <AlternativeFlights searchParams={makeSearchParams()} {...props()} />
    );
    fireEvent.change(destinationInput(), { target: { value: 'LHR' } });
    expect(destinationInput()).toHaveValue('London (LHR)');

    await act(async () => {
      rerender(
        <AlternativeFlights searchParams={makeSearchParams({ destination: 'CDG' })} {...props()} />
      );
    });

    // The handoff wins over the abandoned draft, exactly as the old effect did.
    expect(destinationInput()).toHaveValue('Paris (CDG)');
  });

  it('commits the whole draft when Search is pressed', () => {
    const { container } = render(
      <AlternativeFlights searchParams={makeSearchParams()} {...props()} />
    );

    fireEvent.change(destinationInput(), { target: { value: 'CDG' } });
    fireEvent.submit(container.querySelector('form'));

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    expect(setSearchParams.mock.calls[0][0]).toMatchObject({
      origin: 'TLV',
      destination: 'CDG',
    });
  });

  it('swaps origin and destination without committing the search', () => {
    render(<AlternativeFlights searchParams={makeSearchParams()} {...props()} />);

    fireEvent.click(swapButton());

    expect(originInput()).toHaveValue('Krakow (KRK)');
    expect(destinationInput()).toHaveValue('Tel Aviv (TLV)');
    expect(setSearchParams).not.toHaveBeenCalled();
  });
});
