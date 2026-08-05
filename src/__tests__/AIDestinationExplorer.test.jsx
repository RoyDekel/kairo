import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import AIDestinationExplorer from '../components/AIDestinationExplorer';
import { searchAIDestinations } from '../utils/aiDestinationEngine';

vi.mock('../contexts/AuthProvider', () => ({
  useAuth: () => ({
    session: { access_token: 'fake-token' },
    user: { id: 'test-user-123', email: 'test@example.com' },
    isAuthenticated: true
  })
}));

vi.mock('../utils/aiDestinationEngine', () => ({
  searchAIDestinations: vi.fn(),
  fetchAuthoritativeQuote: vi.fn(),
  DiscoveryUnavailableError: class DiscoveryUnavailableError extends Error {}
}));

describe('AIDestinationExplorer Component', () => {
  const mockSearchParams = {
    origin: 'BER',
    departureDate: '2026-08-11',
    returnDate: '2026-08-16'
  };
  const mockSetSearchParams = vi.fn();
  const mockSetActiveRoundtrip = vi.fn();
  const mockSetActiveTab = vi.fn();
  const mockOnToggleWatchlist = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders initial empty state without triggering API call on mount', () => {
    render(
      <AIDestinationExplorer
        searchParams={mockSearchParams}
        setSearchParams={mockSetSearchParams}
        setActiveRoundtrip={mockSetActiveRoundtrip}
        setActiveTab={mockSetActiveTab}
        onToggleWatchlist={mockOnToggleWatchlist}
        watchlist={[]}
      />
    );

    // Verify initial empty state heading is NOT rendered and badge is rendered
    expect(screen.queryByRole('heading', { name: /Ready to Find Your Next Trip\?/i })).not.toBeInTheDocument();
    expect(screen.getByText('Click Search Routes to scan')).toBeInTheDocument();

    // Verify searchAIDestinations was NOT called automatically on mount
    expect(searchAIDestinations).not.toHaveBeenCalled();
  });

  test('executes searchAIDestinations when Search Routes CTA button is clicked', async () => {
    searchAIDestinations.mockResolvedValueOnce([
      {
        id: 'BARCELONA-2026-08-11',
        originCode: 'BER',
        destCode: 'BCN',
        destination: {
          code: 'BCN',
          city: 'Barcelona',
          country: 'Spain'
        },
        roundtripPrice: 370,
        priceSource: 'estimate',
        matchScore: 94,
        outboundFlight: { id: 'FL-BCN-1', price: 180, origin: 'BER', destination: 'BCN' },
        returnFlight: { id: 'FL-BER-2', price: 190, origin: 'BCN', destination: 'BER' },
        totalFare: 370,
        departureDate: '2026-08-11',
        returnDate: '2026-08-16',
        matchedEvents: [
          { id: 'event-1', name: 'Sónar Festival', category: 'music', venueName: 'Fira Gran Via' }
        ]
      }
    ]);

    render(
      <AIDestinationExplorer
        searchParams={mockSearchParams}
        setSearchParams={mockSetSearchParams}
        setActiveRoundtrip={mockSetActiveRoundtrip}
        setActiveTab={mockSetActiveTab}
        onToggleWatchlist={mockOnToggleWatchlist}
        watchlist={[]}
      />
    );

    // Find and click the 'Search Routes' CTA button
    const searchButton = screen.getByRole('button', { name: /Search Routes/i });
    fireEvent.click(searchButton);

    // Verify searchAIDestinations is called
    expect(searchAIDestinations).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'BER',
        departureDate: '2026-08-11',
        returnDate: '2026-08-16'
      })
    );

    // Wait for result card to render
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Barcelona' })).toBeInTheDocument();
    });
  });

  test('renders no events state after empty search result', async () => {
    searchAIDestinations.mockResolvedValueOnce([]);

    render(
      <AIDestinationExplorer
        searchParams={mockSearchParams}
        setSearchParams={mockSetSearchParams}
        setActiveRoundtrip={mockSetActiveRoundtrip}
        setActiveTab={mockSetActiveTab}
        onToggleWatchlist={mockOnToggleWatchlist}
        watchlist={[]}
      />
    );

    const searchButton = screen.getByRole('button', { name: /Search Routes/i });
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No Verified Ticketmaster Events Found' })).toBeInTheDocument();
    });
  });

  test('validates return date is after departure date before searching', () => {
    const invalidParams = {
      origin: 'BER',
      departureDate: '2026-08-20',
      returnDate: '2026-08-10'
    };

    render(
      <AIDestinationExplorer
        searchParams={invalidParams}
        setSearchParams={mockSetSearchParams}
        setActiveRoundtrip={mockSetActiveRoundtrip}
        setActiveTab={mockSetActiveTab}
        onToggleWatchlist={mockOnToggleWatchlist}
        watchlist={[]}
      />
    );

    const searchButton = screen.getByRole('button', { name: /Search Routes/i });
    fireEvent.click(searchButton);

    expect(screen.getByText('Return date must be after the departure date.')).toBeInTheDocument();
    expect(searchAIDestinations).not.toHaveBeenCalled();
  });

  test('expands and collapses extra events when toggle button is clicked', async () => {
    searchAIDestinations.mockResolvedValueOnce([
      {
        id: 'EDINBURGH-2026-10-01',
        originCode: 'BER',
        destCode: 'EDI',
        destination: { code: 'EDI', city: 'Edinburgh', country: 'United Kingdom' },
        roundtripPrice: 812,
        priceSource: 'estimate',
        matchScore: 81,
        outboundFlight: { id: 'FL-EDI-1', price: 400, origin: 'BER', destination: 'EDI' },
        returnFlight: { id: 'FL-BER-2', price: 412, origin: 'EDI', destination: 'BER' },
        totalFare: 812,
        departureDate: '2026-10-01',
        returnDate: '2026-10-05',
        matchedEvents: [
          { id: 'e1', title: 'Don Broco', venue: 'Edinburgh Corn Exchange', url: 'https://ticketmaster.com/e1' },
          { id: 'e2', title: 'Cast', venue: "The Queen's Hall", url: 'https://ticketmaster.com/e2' },
          { id: 'e3', title: 'Agnieszka Chylinska', venue: 'Edinburgh Corn Exchange', url: 'https://ticketmaster.com/e3' },
          { id: 'e4', title: 'Franz Ferdinand', venue: 'Usher Hall', url: 'https://ticketmaster.com/e4' },
          { id: 'e5', title: 'Mogwai', venue: 'Barrowland', url: 'https://ticketmaster.com/e5' }
        ]
      }
    ]);

    render(
      <AIDestinationExplorer
        searchParams={mockSearchParams}
        setSearchParams={mockSetSearchParams}
        setActiveRoundtrip={mockSetActiveRoundtrip}
        setActiveTab={mockSetActiveTab}
        onToggleWatchlist={mockOnToggleWatchlist}
        watchlist={[]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Search Routes/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edinburgh' })).toBeInTheDocument();
    });

    // Initially top 3 events shown, 4th and 5th hidden
    expect(screen.getByText('Don Broco')).toBeInTheDocument();
    expect(screen.queryByText('Franz Ferdinand')).not.toBeInTheDocument();

    // Find expand toggle button
    const expandBtn = screen.getByRole('button', { name: /\+2 more events during your trip/i });
    expect(expandBtn).toBeInTheDocument();

    // Click to expand
    fireEvent.click(expandBtn);

    // All events now shown
    expect(screen.getByText('Franz Ferdinand')).toBeInTheDocument();
    expect(screen.getByText('Mogwai')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Show fewer events/i })).toBeInTheDocument();

    // Click to collapse again
    fireEvent.click(screen.getByRole('button', { name: /Show fewer events/i }));
    expect(screen.queryByText('Franz Ferdinand')).not.toBeInTheDocument();
  });

  /*
    Ordering is a product claim, not a detail.

    "When to Go" answers "where should I go on these dates", so its default order is best
    match — the cheapest fare to a city with nothing on is not an answer to that question.
    Cheapest stays one click away, mirroring the Search & Compare control.
  */
  describe('result ordering', () => {
    const destination = (city, code, price, matchScore) => ({
      id: `${code}-2026-08-11`,
      originCode: 'BER',
      destCode: code,
      destination: { code, city, country: 'Spain' },
      roundtripPrice: price,
      priceSource: 'estimate',
      matchScore,
      matchBreakdown: [],
      matchConfidence: { level: 'medium', gaps: ['Fare is modelled, not a live quote'] },
      outboundFlight: { id: `FL-${code}-1`, price: price / 2, origin: 'BER', destination: code },
      returnFlight: { id: `FL-${code}-2`, price: price / 2, origin: code, destination: 'BER' },
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      matchedEvents: [{ id: `ev-${code}`, title: 'Something on', category: 'music', venue: 'A venue', date: '2026-08-12' }]
    });

    const renderWithResults = async () => {
      searchAIDestinations.mockResolvedValueOnce([
        destination('Barcelona', 'BCN', 900, 88),
        destination('Madrid', 'MAD', 300, 55)
      ]);

      render(
        <AIDestinationExplorer
          searchParams={mockSearchParams}
          setSearchParams={mockSetSearchParams}
          setActiveRoundtrip={mockSetActiveRoundtrip}
          setActiveTab={mockSetActiveTab}
          onToggleWatchlist={mockOnToggleWatchlist}
          watchlist={[]}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: /Search Routes/i }));
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Barcelona' })).toBeInTheDocument());
    };

    const renderedCities = () =>
      screen.getAllByRole('heading', { name: /Barcelona|Madrid/ }).map((h) => h.textContent);

    test('defaults to best match, even when it is the dearer destination', async () => {
      await renderWithResults();
      expect(renderedCities()).toEqual(['Barcelona', 'Madrid']);
    });

    test('Cheapest reorders by price', async () => {
      await renderWithResults();

      fireEvent.click(screen.getByRole('button', { name: 'Cheapest' }));
      expect(renderedCities()).toEqual(['Madrid', 'Barcelona']);

      fireEvent.click(screen.getByRole('button', { name: 'Best match' }));
      expect(renderedCities()).toEqual(['Barcelona', 'Madrid']);
    });
  });
});
