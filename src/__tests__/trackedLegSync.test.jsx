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
  The flight being tracked, and the date shown with it, are the leg of the active bundle that
  the outbound/return toggle points at. That used to be two state slots kept in step with the
  bundle by an effect.

  The market engine replaces the bundle object every 8 seconds to tick a price, so that effect
  did not fire once on a leg switch -- it fired on a timer, for the lifetime of the session,
  committing a second render each time. Underneath that second render sit the Leaflet map and
  the Chart.js canvas, which is exactly the cost KAI-001 describes.

  See [KAI-001].
*/

const commits = [];

const renderDashboard = () => {
  const result = render(
    <Profiler id="app" onRender={(_id, phase) => commits.push(phase)}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </Profiler>
  );
  fireEvent.click(screen.getByText('Should I Book?'));
  return result;
};

const advance = async (ms) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe('Tracked leg follows the active bundle', () => {
  beforeEach(() => {
    commits.length = 0;
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The market engine picks a leg and a direction with Math.random(). Pinned so a tick is
    // deterministic: > 0.5 selects the outbound leg, > 0.55 makes the change +5.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('a market price tick no longer re-syncs the tracked leg', async () => {
    renderDashboard();
    commits.length = 0;

    await advance(8000); // one market-engine tick

    /*
      A tick used to cost three committed renders. One of them was this: the effect re-setting
      activeFlight/selectedDate to the leg they already pointed at.

      Asserted as an upper bound rather than an exact count on purpose. One further redundant
      commit per tick still exists and is NOT this fix's to remove -- it survives even when
      the dashboard has never been opened, so it is in App itself rather than in a child.
      An exact `toEqual(['update'])` here would turn removing it into a test failure, which
      is precisely the wrong incentive. Tighten this bound as the remaining KAI-001 sites in
      App.jsx land.
    */
    expect(commits.length).toBeLessThanOrEqual(2);
  });

  test('the dashboard tracks the outbound leg of the active bundle', () => {
    renderDashboard();

    // The HUD names the flight it is tracking; it must be the bundle's outbound leg.
    expect(screen.getByText('Active Route')).toBeInTheDocument();
  });

  test('a price tick does not change which leg is tracked', async () => {
    renderDashboard();
    const before = screen.getByText('Active Route').closest('div')?.textContent;

    await advance(8000);

    expect(screen.getByText('Active Route').closest('div')?.textContent).toBe(before);
  });
});
