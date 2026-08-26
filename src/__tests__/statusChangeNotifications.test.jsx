import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Profiler, StrictMode } from 'react';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';
import { generateFlightsForRoute } from '../utils/flightSimulator';
import {
  DEFAULT_ORIGIN,
  DEFAULT_DESTINATION,
  DEFAULT_DEPARTURE_DATE,
} from '../utils/searchDefaults';

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

/*
  The flight App tracks on first load. generateFlightsForRoute is deterministic (no Math.random
  anywhere in flightSimulator), so the test can build the same default bundle App does and know
  which flight number an alert has to name.
*/
const TRACKED_FLIGHT = generateFlightsForRoute(
  DEFAULT_ORIGIN, DEFAULT_DESTINATION, DEFAULT_DEPARTURE_DATE, 'outbound', { adults: 1 }
)[0];

const statusAlert = {
  id: 'alert-status-1',
  flightNumber: TRACKED_FLIGHT.flightNumber,
  flightId: TRACKED_FLIGHT.id,
  type: 'status-change',
  isActive: true,
  createdAt: '10:00',
};

let alertsToLoad = [];

vi.mock('../lib/dataService', () => ({
  loadWatchlist: vi.fn(async () => []),
  loadAlerts: vi.fn(async () => alertsToLoad),
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
  A status-change alert fires a notification when the tracked flight moves between phases
  (Scheduled -> Boarding -> Takeoff -> In Flight -> Descending -> Landed).

  That used to be an effect comparing the rendered status against a ref, so the notification
  landed a commit AFTER the status it was reporting was already on screen: the HUD announced
  "Takeoff" while the bell was still silent. It also meant the notification was triggered by
  rendering rather than by the thing that actually changed the status, which is why it needed a
  ref to avoid re-firing. See [KAI-001].
*/

const bellBadge = () =>
  document.querySelector('[title="Notification alerts"] .pulse-target');

const currentStatus = () => {
  const node = document.querySelector('.hud-status-value')
    || screen.queryByText(/Scheduled|Boarding|Takeoff|In Flight|Descending|Landed/);
  return node ? node.textContent.trim() : null;
};

const advance = async (ms) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

const renderApp = async ({ strict = false, onRender } = {}) => {
  const tree = (
    <Profiler id="app" onRender={onRender || (() => {})}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Profiler>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await act(async () => {});
  fireEvent.click(screen.getByText('Should I Book?'));
  fireEvent.click(screen.getByRole('button', { name: /Simulate this flight/i }));
};

// The phases announced in the notification tray, newest first. The bell is located by title:
// several other controls in the header match /Alerts/.
const notificationMessages = () => {
  fireEvent.click(document.querySelector('[title="Notification alerts"]'));
  return screen
    .queryAllByText(/Flight status updated to:/i)
    .map((n) => n.textContent.trim().replace(/^.*updated to:\s*/i, ''));
};

describe('Status-change notifications', () => {
  beforeEach(() => {
    alertsToLoad = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('raises the bell badge when the tracked flight changes phase', async () => {
    alertsToLoad = [statusAlert];
    await renderApp();
    expect(bellBadge()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(1000); // past Boarding and Takeoff at the default 5x

    expect(bellBadge()).not.toBeNull();
  });

  test('stays silent when no status-change alert is configured', async () => {
    alertsToLoad = [];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(1000);

    expect(bellBadge()).toBeNull();
  });

  test('never announces a phase on screen before the notification exists', async () => {
    alertsToLoad = [statusAlert];
    const frames = [];
    await renderApp({
      onRender: () => {
        frames.push({ status: currentStatus(), badge: !!bellBadge() });
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    frames.length = 0;
    await advance(1000);

    // Once the flight has left 'Scheduled', no committed frame may show the new phase with a
    // silent bell -- that gap is the cascading render.
    const movedOn = frames.filter((f) => f.status && f.status !== 'Scheduled');
    expect(movedOn.length).toBeGreaterThan(0);
    expect(movedOn.filter((f) => !f.badge)).toEqual([]);
  });

  test('fires once per phase change, not twice, under StrictMode', async () => {
    alertsToLoad = [statusAlert];
    await renderApp({ strict: true });

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    // 200ms at the default 5x is 4 ticks: past Scheduled -> Boarding and nothing further, so
    // the count is unambiguous. StrictMode double-invokes effects; one transition must still
    // produce exactly one notification.
    await advance(200);

    expect(notificationMessages()).toEqual(['BOARDING']);
  });

  test('fires once per phase change, and once more for the next phase', async () => {
    alertsToLoad = [statusAlert];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(200);
    expect(notificationMessages()).toEqual(['BOARDING']);

    // Back to the dashboard so the simulation keeps running, then on past Takeoff.
    fireEvent.click(screen.getByText('Should I Book?'));
    await advance(400);

    // Newest first.
    expect(notificationMessages()).toEqual(['TAKEOFF', 'BOARDING']);
  });

  test('announces every phase the aircraft passes through, even between renders', async () => {
    /*
      React batches the 50ms progress updates, so a status read back from rendered state can sit
      several ticks behind and skip a phase entirely. Advancing in one go is the case that
      exposes it: without the ticker keeping its own accumulator, Takeoff here goes unreported.
    */
    alertsToLoad = [statusAlert];
    await renderApp();

    fireEvent.click(screen.getByRole('button', { name: /Start Simulation/i }));
    await advance(600);

    expect(notificationMessages()).toEqual(['TAKEOFF', 'BOARDING']);
  });
});
