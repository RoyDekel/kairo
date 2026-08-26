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
    signOut: vi.fn(),
  }),
}));

vi.mock('../contexts/AuthProvider', () => ({
  AuthProvider: ({ children }) => <div>{children}</div>
}));

const OTHER_FLIGHT = {
  id: 'watch-lhr-jfk',
  flightNumber: 'BA 117',
  airlineCode: 'BA',
  airlineName: 'British Airways',
  origin: 'LHR',
  destination: 'JFK',
  departureTime: '09:15',
  arrivalTime: '12:20',
  price: 512,
  stops: 'Direct',
  stopsCount: 0,
  duration: '8h 5m',
  cabinClass: 'Economy',
  planeType: 'Boeing 777',
  passengerCosts: { adults: 512, total: 512 },
  departureDate: '2026-11-04',
};

/*
  dataService is stubbed rather than left to its localStorage fallback. App loads the watchlist
  through it on mount, and under fake timers that promise chain does not settle when the test
  wants it to -- the watchlist renders empty and the "Track Now" button never appears. Stubbing
  it makes the load deterministic and keeps the test about the simulator, not about IO.
*/
vi.mock('../lib/dataService', () => ({
  loadWatchlist: vi.fn(async () => [OTHER_FLIGHT]),
  loadAlerts: vi.fn(async () => []),
  loadNotifications: vi.fn(async () => []),
  loadPreferences: vi.fn(async () => ({})),
  migrateLocalStorage: vi.fn(async () => {}),
  savePreferences: vi.fn(async () => {}),
  saveWatchlistItem: vi.fn(async () => {}),
  removeWatchlistItem: vi.fn(async () => {}),
  saveAlert: vi.fn(async () => {}),
  deleteAlert: vi.fn(async () => {}),
  updateAlertStatus: vi.fn(async () => {}),
  saveNotification: vi.fn(async () => {}),
  clearNotifications: vi.fn(async () => {}),
}));

/*
  Switching the tracked route abandons whatever run was in progress on the old one: an aircraft
  cannot be 40% of the way along a flight path it is no longer flying.

  That used to be an effect that zeroed the run flag and the progress bar after the new route
  had already been committed, so there was one frame showing the new route carrying the old
  route's progress. See [KAI-001].
*/

const frames = [];
const sampleProgress = () => {
  const node = screen.queryByText(/% Complete$/);
  if (node) frames.push(parseInt(node.textContent, 10));
};

const advance = async (ms) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const openSimulator = () =>
  fireEvent.click(screen.getByRole('button', { name: /Simulate this flight/i }));

describe('Changing the tracked route abandons the running simulation', () => {
  beforeEach(() => {
    frames.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderApp = async (onRender) => {
    render(
      <Profiler id="app" onRender={onRender || (() => {})}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </Profiler>
    );
    // Let the stubbed watchlist load land before anything depends on it.
    await act(async () => {});
    fireEvent.click(screen.getByText('Should I Book?'));
  };

  const trackTheOtherFlight = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Watchlist' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Track Now/i }));
    });
  };

  test('the watchlist offers the other flight', async () => {
    await renderApp();
    fireEvent.click(screen.getByRole('button', { name: 'Watchlist' }));

    expect(screen.getByText('BA 117')).toBeInTheDocument();
  });

  test('never paints the new route carrying the old route\'s progress', async () => {
    await renderApp(sampleProgress);
    openSimulator();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(2000); // ~20% along at the default 5x

    expect(frames.some((p) => p > 0)).toBe(true);
    frames.length = 0;

    await trackTheOtherFlight();

    // Every frame from the switch onwards must already read zero. Resetting from an effect
    // leaves one frame showing the abandoned run's progress against the new route.
    expect(frames.filter((p) => p > 0)).toEqual([]);
  });

  test('the new route starts from the gate, stopped', async () => {
    await renderApp();
    openSimulator();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(2000);

    await trackTheOtherFlight();
    // The panel's open/closed state is not part of the run, so it stays open across the switch.

    expect(screen.getByText('0% Complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Simulation/i })).toBeInTheDocument();
  });

  test('a market price tick does not abandon the run', async () => {
    // The bundle object is replaced every 8s to tick a price, but the route is unchanged --
    // the regression flightSimulation.test.jsx already guards, re-checked against the new
    // scoping so a stale scope key cannot silently reintroduce it.
    await renderApp();
    openSimulator();
    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(2000);
    const before = parseInt(screen.getByText(/% Complete$/).textContent, 10);

    await advance(8500); // past one market-engine tick

    expect(parseInt(screen.getByText(/% Complete$/).textContent, 10)).toBeGreaterThan(before);
  });
});
