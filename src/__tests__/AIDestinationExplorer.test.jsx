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

    // Verify initial empty state heading and badge are rendered
    expect(screen.getByRole('heading', { name: /Ready to Find Your Next Trip\?/i })).toBeInTheDocument();
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
    const searchButtons = screen.getAllByRole('button', { name: /Search Routes/i });
    expect(searchButtons.length).toBeGreaterThan(0);
    fireEvent.click(searchButtons[0]);

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

    const searchButtons = screen.getAllByRole('button', { name: /Search Routes/i });
    fireEvent.click(searchButtons[0]);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'No Verified Ticketmaster Events Found' })).toBeInTheDocument();
    });
  });
});
