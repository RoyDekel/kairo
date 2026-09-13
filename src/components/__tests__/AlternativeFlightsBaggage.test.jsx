import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AlternativeFlights from '../AlternativeFlights.jsx';

vi.mock('../../contexts/authContext', () => ({
  useAuth: () => ({ session: null, user: null, isAuthenticated: false }),
}));

/*
  The bag selector re-prices the results already on screen: "Cheapest" ranks by fare plus
  the estimated bag, the deal tag follows, and the bag never triggers another search.
*/

const makeFlight = (id, airlineCode, airlineName, price) => ({
  id,
  flightNumber: `${airlineCode} ${id}`,
  airlineCode,
  airlineName,
  departureTime: '08:00',
  arrivalTime: '12:00',
  price,
  stops: 'Direct',
  duration: '4h 0m',
  cabinClass: 'Economy',
  passengerCosts: { adults: price, children: 0, infants: 0, total: price },
  distance: 2500,
  currency: 'USD',
});

// Wizz is cheaper on fare alone; EL AL includes a carry-on in its Lite fare. The third
// carrier has no baggage policy on file.
const outbound = () => [
  makeFlight('1', 'W6', 'Wizz Air', 90),
  makeFlight('2', 'LY', 'EL AL Israel Airlines', 110),
  makeFlight('3', 'ZZ', 'Unlisted Air', 100),
];

// Relative to today, as in fliProvider.test.js, so the search never sits in the past once a
// hardcoded date passes.
const daysFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().split('T')[0];

const makeSearchParams = () => ({
  origin: 'TLV',
  destination: 'KRK',
  departureDate: daysFromNow(60),
  returnDate: daysFromNow(67),
  tripType: 'round-trip',
  stops: '0',
  travelClass: 'ALL',
  passengers: { adults: 1, children: 0, infants: 0 },
});

const noopProps = {
  setSearchParams: vi.fn(),
  setActiveRoundtrip: vi.fn(),
  setActiveTab: vi.fn(),
};

const flightOrder = () =>
  screen.getAllByText(/^(W6|LY|ZZ) \d$/).map((el) => el.textContent);

const bagButton = (name) =>
  within(screen.getByRole('group', { name: 'Baggage' })).getByRole('button', { name });

describe('AlternativeFlights baggage selector', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn((url) => {
      if (String(url).includes('/api/flights')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ outbound: outbound(), return: outbound() }),
        });
      }
      return Promise.reject(new Error(`Unmocked fetch: ${url}`));
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function renderList() {
    render(<AlternativeFlights searchParams={makeSearchParams()} {...noopProps} />);
    await screen.findByText('W6 1');
  }

  it('defaults to personal item only and ranks by fare', async () => {
    await renderList();

    expect(bagButton('Personal item')).toHaveAttribute('aria-pressed', 'true');
    expect(flightOrder()).toEqual(['W6 1', 'ZZ 3', 'LY 2']);
    expect(screen.queryByTestId('bag-note')).not.toBeInTheDocument();
  });

  it('re-ranks by fare plus carry-on without searching again', async () => {
    await renderList();
    const callsBefore = fetchMock.mock.calls.length;

    fireEvent.click(bagButton('Carry-on'));

    // The unlisted carrier's bag cost is unknown, so it ranks after both known ones even
    // though its fare plus an unknown bag would read as $100.
    expect(flightOrder()).toEqual(['LY 2', 'W6 1', 'ZZ 3']);
    expect(screen.getByText('Carry-on included')).toBeInTheDocument();
    expect(screen.getByText('Carry-on fee unknown')).toBeInTheDocument();
    expect(screen.getByText(/^\+~\$\d+ carry-on \(est\.\)$/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('moves the Cheapest Deal tag to the cheapest flight with the bag', async () => {
    await renderList();
    fireEvent.click(bagButton('Carry-on'));

    const tag = screen.getByText('Cheapest Deal');
    const card = tag.closest('div');
    expect(within(card).getByText('LY 2')).toBeInTheDocument();
  });

  it('shows an estimated party total when a bag fee applies', async () => {
    await renderList();
    fireEvent.click(bagButton('Checked bag 20–23kg'));

    expect(screen.getAllByText(/Total w\/ bags:/).length).toBeGreaterThan(0);
    expect(screen.getByText(/estimates from each airline/)).toBeInTheDocument();
  });

  it('carries the bag estimate into the confirmation breakdown', async () => {
    await renderList();
    fireEvent.click(bagButton('Checked bag 20–23kg'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Select Outbound' })[0]);
    await screen.findByText('Selected Outbound Leg');
    fireEvent.click(screen.getAllByRole('button', { name: 'Select Return' })[0]);

    const line = await screen.findByTestId('bag-breakdown');
    expect(line).toHaveTextContent(/Checked bag 20–23kg \(1 pax, est\.\)/);
    expect(line).toHaveTextContent(/~\$\d+/);
    expect(screen.getByText(/Est\. total with bags/)).toBeInTheDocument();
  });
});
