import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';

/*
  Covers the mount-time handling of the `?confirmed=true` redirect Supabase sends the
  browser back to after the user clicks the link in the signup confirmation email (see
  EMAIL_CONFIRMATION_REDIRECT_URL in AuthProvider.jsx). There is no client-side router here
  -- this is query-string + state handling on the single SPA mount -- so the thing under
  test is App.jsx's effect, exercised through a full render the same way bookingFlow.test.jsx
  does.

  useAuth lives in authContext.js, not AuthProvider.jsx (split for Fast Refresh -- see the
  comment on AuthContext in src/contexts/authContext.js). App reads it from there, so the
  mock has to intercept that module. It's declared with vi.hoisted so each test can flip
  isAuthenticated/loading before rendering, to exercise both branches of the effect.
*/
const mockAuthState = vi.hoisted(() => ({
  user: null,
  isAuthenticated: false,
  loading: false,
  signOut: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  resetPassword: vi.fn(),
  supabaseAvailable: true,
}));

vi.mock('../contexts/authContext', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('../contexts/AuthProvider', () => ({
  AuthProvider: ({ children }) => <div>{children}</div>,
}));

function setUrl(search) {
  window.history.pushState({}, '', `/kairo/${search}`);
}

describe('Email confirmation redirect handling (App mount)', () => {
  beforeEach(() => {
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    mockAuthState.loading = false;
    setUrl('');
  });

  test('shows a one-time welcome toast and strips the query param when the user is authenticated', async () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', email: 'roy@example.com' };
    setUrl('?confirmed=true');

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    expect(await screen.findByText(/email confirmed/i)).toBeInTheDocument();
    // The param must not survive so a refresh / back-nav can't replay the toast.
    expect(window.location.search).not.toContain('confirmed');

    // Un-related state (the sign-in modal) must stay closed on the success path.
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).not.toBeInTheDocument();
  });

  test('falls back to the sign-in modal with an explanatory notice when the link was expired or already used', async () => {
    mockAuthState.isAuthenticated = false;
    setUrl('?confirmed=true');

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    expect(
      await screen.findByText(/expired or was already used/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();

    // The param must not survive so a refresh / back-nav can't replay the fallback.
    expect(window.location.search).not.toContain('confirmed');

    // No welcome toast on the failure path.
    expect(screen.queryByText(/email confirmed/i)).not.toBeInTheDocument();
  });

  test('does nothing when confirmed is absent from the query string', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', email: 'roy@example.com' };
    setUrl('');

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    expect(screen.queryByText(/email confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).not.toBeInTheDocument();
  });

  test('waits for the auth check to resolve before acting on confirmed=true', () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.loading = true;
    setUrl('?confirmed=true');

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    // Still resolving the "short check" -- neither branch should have fired yet, and the
    // param should still be there for the effect to read once loading flips false.
    expect(screen.queryByText(/email confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Welcome Back' })).not.toBeInTheDocument();
    expect(window.location.search).toContain('confirmed=true');
  });
});
