import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';

const renderApp = () => {
  const result = render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  const launchBtn = screen.getByRole('button', { name: /Launch Web App/i });
  fireEvent.click(launchBtn);
  const dashTab = screen.getByText('Dashboard HUD');
  fireEvent.click(dashTab);
  return result;
};

describe('Booking Flow Integration Tests', () => {
  test('successfully performs search and completes booking flow step-by-step', async () => {
    renderApp();

    // 1. Initially on Dashboard HUD
    expect(screen.getByText('Dashboard HUD')).toBeInTheDocument();
    
    // 2. Navigate to "Find Flights" tab
    const findFlightsTab = screen.getByText('Find Flights');
    fireEvent.click(findFlightsTab);
    
    // Verify search panel is loaded
    expect(screen.getByText('Flight Search & Telemetry')).toBeInTheDocument();

    // Select Arrival Airport as 'KRK'
    const arrivalSelect = screen.getByLabelText('Arrival Airport');
    fireEvent.change(arrivalSelect, { target: { value: 'KRK' } });

    // Set Departure Date & Return Date
    const departureDateInput = screen.getByPlaceholderText('Departure');
    const returnDateInput = screen.getByPlaceholderText('Return');
    fireEvent.change(departureDateInput, { target: { value: '2026-08-11' } });
    fireEvent.change(returnDateInput, { target: { value: '2026-08-16' } });

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

    // 8. Verify navigation back to Dashboard HUD tab
    expect(screen.getByText('Dashboard HUD')).toHaveStyle({
      color: 'var(--primary)'
    });
    
    // Verify active route HUD displays the correct airports on Dashboard
    expect(screen.getByText('Active Route')).toBeInTheDocument();
  });

  test('supports One-way trip selection and flow', async () => {
    renderApp();

    // Navigate to "Find Flights"
    fireEvent.click(screen.getByText('Find Flights'));

    // Select One-way trip type
    const tripTypeSelect = screen.getByLabelText('Trip Type');
    fireEvent.change(tripTypeSelect, { target: { value: 'one-way' } });

    // Return date should be hidden for one-way
    expect(screen.queryByPlaceholderText('Return')).not.toBeInTheDocument();

    // Select Arrival Airport as 'LHR'
    const arrivalSelect = screen.getByLabelText('Arrival Airport');
    fireEvent.change(arrivalSelect, { target: { value: 'LHR' } });

    // Set Departure Date
    const departureDateInput = screen.getByPlaceholderText('Departure');
    fireEvent.change(departureDateInput, { target: { value: '2026-09-01' } });

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
  });

  test('validates origin and destination cannot be identical', async () => {
    renderApp();

    // Navigate to "Find Flights"
    fireEvent.click(screen.getByText('Find Flights'));

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
