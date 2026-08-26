import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler } from 'react';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';

// useAuth lives in authContext.js, not AuthProvider.jsx (split for Fast Refresh — see the
// comment on AuthContext in src/contexts/authContext.js). App reads it from there, so the
// mock has to intercept that module, not the one that exports the AuthProvider component.
vi.mock('../contexts/authContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'test@example.com' },
    isAuthenticated: true,
    signOut: vi.fn()
  }),
}));

vi.mock('../contexts/AuthProvider', () => ({
  AuthProvider: ({ children }) => <div>{children}</div>
}));

/*
  A simulation run is over when the aircraft arrives. That used to be an effect watching
  simulationProgress and flipping isSimulating off once it hit 1, which committed an extra
  render at the exact moment the map is drawing the final frame of the flight path.

  It also meant one committed frame in which the HUD read "100% Complete" while the control
  still offered "Pause" -- a run that had arrived but had not yet been told to stop. This test
  asserts no such frame is ever painted. See [KAI-001].
*/

const frames = [];

const sample = () => {
  const progressNode = screen.queryByText(/% Complete$/);
  const control = screen
    .queryAllByRole('button')
    .find((b) => /Simulation$/.test(b.textContent.trim()));
  if (!progressNode || !control) return;
  frames.push({
    percent: parseInt(progressNode.textContent, 10),
    label: control.textContent.trim(),
  });
};

const renderDashboard = () => {
  const result = render(
    <Profiler id="app" onRender={sample}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Profiler>
  );
  fireEvent.click(screen.getByText('Should I Book?'));
  // The simulator is collapsed by default now that it lives under the map.
  fireEvent.click(screen.getByRole('button', { name: /Simulate this flight/i }));
  return result;
};

const advance = async (ms) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('Simulation arrival', () => {
  beforeEach(() => {
    frames.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('never paints an arrived flight that is still running', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    frames.length = 0;

    // Default speed is 5x: 0.005 per 50ms tick, so ~10s of simulated time to arrive.
    await advance(12000);

    // Sanity: the run really did complete, otherwise the assertion below is vacuous.
    expect(frames.some((f) => f.percent === 100)).toBe(true);
    // The wasted frame: arrived, but the control still says the run is in progress.
    expect(frames.filter((f) => f.percent === 100 && /Pause/.test(f.label))).toEqual([]);
  });

  test('offers a replay once it has arrived', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));

    await advance(12000);

    expect(screen.getByRole('button', { name: /Replay Simulation/i })).toBeInTheDocument();
  });
});
