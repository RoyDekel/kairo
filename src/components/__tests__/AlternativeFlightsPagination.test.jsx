import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AlternativeFlights from '../AlternativeFlights.jsx';

vi.mock('../../contexts/authContext', () => ({
  useAuth: () => ({ session: null, user: null, isAuthenticated: false }),
}));

/*
  The results list resets to page 1 whenever the result set underneath it changes -- a new
  search, a different carrier filter, a different sort, or a move between the outbound and
  return legs of the booking flow. That reset used to be an effect calling setCurrentPage(1),
  which committed a second render every time, on the single most expensive list in the app.

  These tests pin the reset behaviour on each of those triggers, ordinary page navigation,
  and the render economy. See [KAI-001].
*/

const FLIGHT_COUNT = 25; // > ITEMS_PER_PAGE (10), so three pages

const makeFlights = () =>
  Array.from({ length: FLIGHT_COUNT }, (_, i) => ({
    id: `f-${i}`,
    flightNumber: `LH ${100 + i}`,
    airlineCode: i % 2 === 0 ? 'LH' : 'BA',
    airlineName: i % 2 === 0 ? 'Lufthansa' : 'British Airways',
    departureTime: '08:00',
    arrivalTime: '12:00',
    price: 200 + i,
    stopsCount: 0,
    stops: 'Direct',
    duration: `${4 + (i % 5)}h 0m`,
    cabinClass: 'Economy',
    passengerCosts: { adults: 200 + i, total: 200 + i },
    planeType: 'Airbus A321neo',
    departureDate: '2026-10-11',
  }));

const makeSearchParams = () => ({
  origin: 'TLV',
  destination: 'KRK',
  departureDate: '2026-10-11',
  returnDate: '2026-10-18',
  tripType: 'round-trip',
  stops: '0',
  travelClass: 'ALL',
  passengers: { adults: 1, children: 0, infants: 0 },
});

const noopProps = {
  setSelectedDate: vi.fn(),
  setActiveFlight: vi.fn(),
  setSearchParams: vi.fn(),
  setActiveRoundtrip: vi.fn(),
  setActiveTab: vi.fn(),
};

const pageButton = (n) => screen.getByRole('button', { name: String(n) });
const sortButton = (name) => screen.getByRole('button', { name });
const carrierSelect = () => screen.getByRole('combobox', { name: '' });

// The active page button is the one painted with the primary background.
const activePage = () =>
  [1, 2, 3]
    .map((n) => screen.queryByRole('button', { name: String(n) }))
    .find((b) => b && b.style.backgroundColor === 'var(--primary)')?.textContent;

async function renderList(commits) {
  const ui = <AlternativeFlights searchParams={makeSearchParams()} {...noopProps} />;
  const result = render(
    commits
      ? <Profiler id="alts" onRender={(_id, phase) => commits.push(phase)}>{ui}</Profiler>
      : ui
  );
  // Flights arrive from the stubbed /api/flights call.
  await screen.findByText('LH 100');
  return result;
}

describe('AlternativeFlights pagination', () => {
  beforeEach(() => {
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
      return Promise.reject(new Error(`Unmocked fetch in AlternativeFlightsPagination.test: ${urlStr}`));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('navigates between pages', async () => {
    await renderList();

    expect(activePage()).toBe('1');
    fireEvent.click(pageButton(3));

    expect(activePage()).toBe('3');
  });

  it('returns to page 1 on a sort change in a single committed render', async () => {
    const commits = [];
    await renderList(commits);
    fireEvent.click(pageButton(3));
    commits.length = 0;

    fireEvent.click(sortButton('Shortest'));

    expect(activePage()).toBe('1');
    // One commit for the sort change. Resetting the page from an effect adds a second.
    expect(commits).toEqual(['update']);
  });

  it('returns to page 1 on a carrier filter change', async () => {
    await renderList();
    fireEvent.click(pageButton(3));

    fireEvent.change(carrierSelect(), { target: { value: 'Lufthansa' } });

    expect(activePage()).toBe('1');
  });

  it('returns to page 1 when a new search is handed down', async () => {
    const { rerender } = await renderList();
    fireEvent.click(pageButton(3));
    expect(activePage()).toBe('3');

    // App.jsx hands down a fresh searchParams object per committed search.
    rerender(<AlternativeFlights searchParams={makeSearchParams()} {...noopProps} />);
    await screen.findByText('LH 100');

    expect(activePage()).toBe('1');
  });

  it('keeps the page when an unrelated re-render happens', async () => {
    const searchParams = makeSearchParams();
    const { rerender } = render(
      <AlternativeFlights searchParams={searchParams} {...noopProps} />
    );
    await screen.findByText('LH 100');
    fireEvent.click(pageButton(2));

    // Same searchParams identity: this is a re-render, not a new search.
    rerender(<AlternativeFlights searchParams={searchParams} {...noopProps} />);

    expect(activePage()).toBe('2');
  });

  it('steps forward and back with the arrow controls', async () => {
    await renderList();

    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
    expect(activePage()).toBe('2');

    fireEvent.click(screen.getByRole('button', { name: /^Prev/ }));
    expect(activePage()).toBe('1');
  });
});
