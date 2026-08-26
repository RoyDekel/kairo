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
  A live transponder fix belongs to one particular run: this flight, being simulated, right
  now. When the run stops, the fix is meaningless and the map must fall back to the estimated
  path.

  That fallback used to be two setState calls in the polling effect's early-return branch,
  which meant one committed frame in which the aircraft was no longer flying but the map still
  read "(LIVE GPS)". These tests pin the fallback and the absence of that frame. See [KAI-001].
*/

const liveFix = {
  latitude: 45.0,
  longitude: 20.0,
  heading: 310,
  altitude: 11000,
  speed: 820,
  status: 'In Flight',
};

const frames = [];
const sampleSource = () => {
  if (screen.queryByText(/\(LIVE GPS\)/)) frames.push('live');
  else if (screen.queryByText(/\(ESTIMATED\)/)) frames.push('estimated');
};

const renderDashboard = (onRender) => {
  const result = render(
    <Profiler id="app" onRender={onRender || (() => {})}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Profiler>
  );
  fireEvent.click(screen.getByText('Should I Book?'));
  fireEvent.click(screen.getByRole('button', { name: /Simulate this flight/i }));
  return result;
};

const advance = async (ms) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('Live telemetry belongs to the run it was fetched for', () => {
  beforeEach(() => {
    frames.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn((url) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/telemetry/live')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ telemetry: liveFix }) });
      }
      // Everything else this screen touches degrades to its simulated fallback.
      return Promise.reject(new Error(`Unmocked fetch in liveTelemetryScope.test: ${urlStr}`));
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('shows the live GPS feed while the flight is being simulated', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));

    await advance(100);

    expect(screen.getByText(/\(LIVE GPS\)/)).toBeInTheDocument();
  });

  test('never paints a stopped flight still reading LIVE GPS', async () => {
    renderDashboard(sampleSource);
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(100);
    expect(screen.getByText(/\(LIVE GPS\)/)).toBeInTheDocument();

    frames.length = 0;
    fireEvent.click(screen.getByRole('button', { name: /Pause Simulation/i }));
    await act(async () => {});

    // The run is over; not one committed frame may still claim a live fix.
    expect(frames).not.toContain('live');
    expect(screen.getByText(/\(ESTIMATED\)/)).toBeInTheDocument();
  });

  test('falls back to the estimated path once the run is paused', async () => {
    renderDashboard();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(100);

    fireEvent.click(screen.getByRole('button', { name: /Pause Simulation/i }));
    await act(async () => {});

    expect(screen.getByText(/\(ESTIMATED\)/)).toBeInTheDocument();
  });
});
