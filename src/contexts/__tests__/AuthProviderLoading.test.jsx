import { Profiler, useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect } from 'vitest';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../authContext';

/*
  When Supabase is not configured there is no session to wait for, so the provider is already
  in its final state on the very first render. It used to start at `loading: true` regardless
  and be corrected by an effect, which meant the entire application mounted behind a loading
  gate and immediately re-rendered out of it -- the most expensive cascading render in the app,
  because everything else is below it.

  `src/setupTests.js` mocks `lib/supabaseClient` to `{ supabase: null }` for every suite, which
  is exactly the unconfigured case. This file deliberately does NOT override that (unlike
  AuthProvider.test.jsx, which supplies a fake client to exercise signUp). See [KAI-001].
*/

// The context values are rendered into the DOM rather than captured in a closure during
// render: reading them back from the committed markup keeps the probe a pure component.
function Probe() {
  const { loading, supabaseAvailable, isAuthenticated } = useAuth();
  return (
    <div
      data-testid="probe"
      data-loading={String(loading)}
      data-available={String(supabaseAvailable)}
      data-authed={String(isAuthenticated)}
    />
  );
}

const readProbe = () => {
  const el = document.querySelector('[data-testid="probe"]');
  return el ? { ...el.dataset } : null;
};

// Hands the live context back through an effect rather than a render-time assignment, which
// would be an impure side effect during render. Same pattern, and same reason, as the Consumer
// in AuthProvider.test.jsx.
function Consumer({ onReady }) {
  const auth = useAuth();
  useEffect(() => {
    onReady(auth);
  }, [onReady, auth]);
  return null;
}

describe('AuthProvider loading gate with Supabase unconfigured', () => {
  test('is not loading on the first committed render', () => {
    const frames = [];
    const commits = [];

    render(
      <Profiler
        id="auth"
        onRender={(_id, phase) => {
          commits.push(phase);
          frames.push(readProbe()?.loading);
        }}
      >
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </Profiler>
    );

    // No committed frame may gate the app behind a session check that will never happen.
    expect(frames).not.toContain('true');
    // One mount commit. Clearing the flag from an effect adds a second, and re-renders the
    // whole application tree with it.
    expect(commits).toEqual(['mount']);
  });

  test('reports Supabase as unavailable so callers can degrade', () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(readProbe()).toMatchObject({ available: 'false', loading: 'false' });
  });

  test('exposes no authenticated user when unconfigured', () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>
    );

    expect(readProbe().authed).toBe('false');
  });

  test('still refuses to sign in when Supabase is unconfigured', async () => {
    let signIn;
    render(
      <AuthProvider>
        <Consumer onReady={(auth) => { signIn = auth.signIn; }} />
      </AuthProvider>
    );

    await expect(signIn('a@b.com', 'pw')).rejects.toThrow(/not configured/i);
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument();
  });
});
