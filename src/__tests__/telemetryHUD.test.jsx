import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
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
  const dashTab = screen.getByText('Price Radar HUD');
  fireEvent.click(dashTab);
  return result;
};

describe('Telemetry HUD and Watchlist/Alerts UI Tests', () => {
  test('controls the simulator HUD (Play/Pause, speed selection, reset)', () => {
    renderApp();

    // 1. Initial simulation state (paused)
    const playButton = screen.getByRole('button', { name: /Start Simulation/i });
    expect(playButton).toBeInTheDocument();
    expect(screen.getByText('0% Complete')).toBeInTheDocument();

    // 2. Click Start Simulation -> check text shifts to Pause
    fireEvent.click(playButton);
    expect(screen.getByRole('button', { name: /Pause Simulation/i })).toBeInTheDocument();

    // 3. Test speed selection buttons
    const speed20x = screen.getByRole('button', { name: '20x' });
    expect(speed20x).toBeInTheDocument();
    fireEvent.click(speed20x);
    // Button styling should update (handled dynamically via state)
    
    // 4. Test slider manual dragging change
    const progressSlider = screen.getByRole('slider');
    fireEvent.change(progressSlider, { target: { value: '0.5' } });
    
    // 50% should be complete and status updated
    expect(screen.getByText('50% Complete')).toBeInTheDocument();
    expect(screen.getAllByText('In Flight').length).toBeGreaterThan(0);

    // 5. Test Reset Simulation
    const resetButton = screen.getByTitle('Reset flight simulation');
    fireEvent.click(resetButton);
    expect(screen.getByText('0% Complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Simulation/i })).toBeInTheDocument();
  });

  test('adds flight to watchlist and removes it', () => {
    renderApp();

    // 1. Click Track/Watch button in Dashboard HUD
    const watchButton = screen.getByRole('button', { name: /Track/i });
    expect(watchButton).toBeInTheDocument();
    
    fireEvent.click(watchButton);
    
    // 2. Verify button text updates to "Watched"
    expect(screen.getByRole('button', { name: /Watched/i })).toBeInTheDocument();

    // 3. Navigate to Watchlist tab
    fireEvent.click(screen.getByText('Watchlist'));
    
    // Verify flight is listed in Watchlist View
    expect(screen.getByText(/LOT Polish Airlines/i)).toBeInTheDocument();
    expect(screen.getByText('LO 101')).toBeInTheDocument();

    // 4. Remove from watchlist
    const removeButton = screen.getByRole('button', { name: /Remove/i });
    fireEvent.click(removeButton);

    // Verify watchlist becomes empty
    expect(screen.getByText(/Your Watchlist is empty/i)).toBeInTheDocument();
  });
});
