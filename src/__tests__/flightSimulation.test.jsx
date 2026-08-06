import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';

vi.mock('../contexts/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'test@example.com' },
    isAuthenticated: true,
    signOut: vi.fn()
  }),
  AuthProvider: ({ children }) => <div>{children}</div>
}));

const renderDashboard = () => {
  const result = render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  fireEvent.click(screen.getByText('Should I Book?'));
  // The simulator is collapsed by default now that it lives under the map.
  fireEvent.click(screen.getByRole('button', { name: /Simulate this flight/i }));
  return result;
};

/** Advances fake timers inside act() so React flushes the resulting state updates. */
const advance = async (ms) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

/** Reads the "NN% Complete" readout from the simulator HUD. */
const readProgress = () => {
  const node = screen.getByText(/% Complete$/);
  return parseInt(node.textContent, 10);
};

describe('Flight telemetry simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('progresses steadily once started', async () => {
    renderDashboard();
    expect(readProgress()).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(1000); // 20 ticks at the default 5x -> ~10%

    expect(readProgress()).toBeGreaterThan(0);
  });

  /*
    The regression this whole fix exists for.

    The market engine replaces activeRoundtrip every 8s to tick a price. That used to
    fire the [activeRoundtrip] effect, which called setSimulationProgress(0) and
    setIsSimulating(false) — so a run at the default 5x speed (10s to complete) was
    always destroyed at ~80%, and the aircraft never reached the end of the map.
  */
  test('a price tick from the market engine does not reset progress', async () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(4000);
    const beforeTick = readProgress();
    expect(beforeTick).toBeGreaterThan(0);

    // Cross the 8s market-engine boundary, where the reset used to happen.
    await advance(5000);

    expect(readProgress()).toBeGreaterThan(beforeTick);
    expect(screen.getByRole('button', { name: /Pause Simulation/i })).toBeInTheDocument();
  });

  test('reaches 100% and stops without being interrupted', async () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    // 5x needs ~10s; run well past both that and several market-engine ticks.
    await advance(14000);

    expect(readProgress()).toBe(100);
    // Progress clamps at 1 rather than overshooting, and the run halts.
    expect(screen.queryByRole('button', { name: /Pause Simulation/i })).not.toBeInTheDocument();
  });

  test('offers a replay once the flight has landed', async () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(14000);
    expect(readProgress()).toBe(100);

    const replay = screen.getByRole('button', { name: /Replay Simulation/i });
    fireEvent.click(replay);
    await advance(500);

    // Replays from the gate instead of appearing to do nothing.
    expect(readProgress()).toBeLessThan(100);
    expect(screen.getByRole('button', { name: /Pause Simulation/i })).toBeInTheDocument();
  });

  test('pause holds position, and resume continues from there', async () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(2000);
    fireEvent.click(screen.getByRole('button', { name: /Pause Simulation/i }));

    const paused = readProgress();
    await advance(3000);
    expect(readProgress()).toBe(paused);

    fireEvent.click(screen.getByRole('button', { name: /Resume Simulation/i }));
    await advance(1000);
    expect(readProgress()).toBeGreaterThan(paused);
  });

  test('reset returns the aircraft to the departure gate', async () => {
    renderDashboard();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(2000);
    expect(readProgress()).toBeGreaterThan(0);

    fireEvent.click(screen.getByTitle('Reset flight simulation'));
    expect(readProgress()).toBe(0);
    expect(screen.getByRole('button', { name: /Start Simulation/i })).toBeInTheDocument();
  });
});
