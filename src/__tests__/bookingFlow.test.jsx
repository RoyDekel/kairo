import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';

vi.mock('../contexts/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'test@example.com' },
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
  AuthProvider: ({ children }) => <div>{children}</div>
}));

const renderApp = () => {
  const result = render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  const dashTab = screen.getByText('Should I Book?');
  fireEvent.click(dashTab);
  return result;
};

describe('Booking Flow Integration Tests', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/flights')) {
        const mockFlights = Array.from({ length: 4 }, (_, i) => ({
          id: `mock-flight-${i}`,
          flightNumber: `LH ${100 + i}`,
          airlineCode: 'LH',
          airlineName: 'Lufthansa',
          departureTime: '08:00',
          arrivalTime: '12:00',
          price: 200 + i * 10,
          stopsCount: 0,
          stops: 'Direct',
          duration: '4h 0m',
          cabinClass: 'Economy',
          passengerCosts: { adults: 200 + i * 10, total: 200 + i * 10 },
          planeType: 'Airbus A321neo',
          departureDate: '2026-10-11'
        }));
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            outbound: mockFlights,
            return: mockFlights,
            provider: 'fli',
            currency: 'USD'
          })
        });
      }
      return Promise.reject(new Error(`Unmocked fetch in bookingFlow.test: ${urlStr}`));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('successfully performs search and completes booking flow step-by-step', async () => {
    renderApp();

    // 1. Initially on Price Radar HUD
    expect(screen.getByText('Active Route')).toBeInTheDocument();
    
    // 2. Navigate to "Search & Compare" tab via Top Header Navigation
    const findFlightsTab = screen.getByText('Search & Compare');
    fireEvent.click(findFlightsTab);
    
    // Verify search panel is loaded
    expect(screen.getByText('Search & Compare Fares')).toBeInTheDocument();

    // Select Arrival Airport as 'KRK'
    const arrivalSelect = screen.getByLabelText('Arrival Airport');
    fireEvent.change(arrivalSelect, { target: { value: 'KRK' } });

    // Set Departure Date & Return Date
    const departureDateBtn = screen.getByRole('button', { name: /Departure Date/i });
    const returnDateBtn = screen.getByRole('button', { name: /Return Date/i });
    expect(departureDateBtn).toBeInTheDocument();
    expect(returnDateBtn).toBeInTheDocument();

    // Click Search Flights
    const searchButton = screen.getByRole('button', { name: /Search Flights/i });
    fireEvent.click(searchButton);

    // Verify outbound flights are listed
    const outboundButtons = await screen.findAllByRole('button', { name: /Select Outbound/i });
    expect(outboundButtons.length).toBe(4);

    // 3. Select the first outbound leg flight
    fireEvent.click(outboundButtons[0]);

    // 4. Verify we transition to the Return Selection step
    const returnButtons = screen.getAllByRole('button', { name: /Select Return/i });
    expect(returnButtons.length).toBe(4);

    // 5. Select the first return leg flight
    fireEvent.click(returnButtons[0]);

    // 6. Verify we transition to the Confirmation Bundle step
    expect(screen.getByText('Confirm Your Roundtrip Bundle')).toBeInTheDocument();
    expect(screen.getByText('Passenger Pricing Details')).toBeInTheDocument();
    expect(screen.getByText('Track Roundtrip Bundle')).toBeInTheDocument();

    // 7. Complete booking and start tracking
    const trackButton = screen.getByText('Track Roundtrip Bundle');
    fireEvent.click(trackButton);

    // 8. Verify active route HUD displays the correct airports on Dashboard
    expect(screen.getByText('Active Route')).toBeInTheDocument();
  }, 20000);

  test('supports One-way trip selection and flow', async () => {
    renderApp();

    // Navigate to "Search & Compare"
    fireEvent.click(screen.getByText('Search & Compare'));

    // Select One-way trip type
    const tripTypeSelect = screen.getByLabelText('Trip Type');
    fireEvent.change(tripTypeSelect, { target: { value: 'one-way' } });

    // Return date should be hidden for one-way
    expect(screen.queryByRole('button', { name: /Return Date/i })).not.toBeInTheDocument();

    // Select Arrival Airport as 'LHR'
    const arrivalSelect = screen.getByLabelText('Arrival Airport');
    fireEvent.change(arrivalSelect, { target: { value: 'LHR' } });

    // Set Departure Date
    const departureDateBtn = screen.getByRole('button', { name: /Departure Date/i });
    expect(departureDateBtn).toBeInTheDocument();

    // Click Search Flights
    const searchButton = screen.getByRole('button', { name: /Search Flights/i });
    fireEvent.click(searchButton);

    // Outbound flights listed
    const selectButtons = await screen.findAllByRole('button', { name: /Select Outbound/i });
    expect(selectButtons.length).toBe(4);

    // Select flight
    fireEvent.click(selectButtons[0]);

    // Transition directly to One-Way confirmation step
    expect(screen.getByText('Confirm Your One-Way Flight')).toBeInTheDocument();
    expect(screen.getByText('Track One-Way Flight')).toBeInTheDocument();
  }, 20000);

  test('validates origin and destination cannot be identical', async () => {
    renderApp();

    // Navigate to "Search & Compare"
    fireEvent.click(screen.getByText('Search & Compare'));

    // We can select the Departure Airport dropdown and change it to match Arrival
    const departureSelect = screen.getByLabelText('Departure Airport');
    const arrivalSelect = screen.getByLabelText('Arrival Airport');

    // Select 'KRK' for both
    fireEvent.change(departureSelect, { target: { value: 'KRK' } });
    fireEvent.change(arrivalSelect, { target: { value: 'KRK' } });

    // Submit form by clicking Search Flights
    const searchButton = screen.getByRole('button', { name: /Search Flights/i });
    fireEvent.click(searchButton);

    // Check for error validation message
    expect(screen.getByText('Departure and Arrival airports cannot be the same.')).toBeInTheDocument();
  });
});
