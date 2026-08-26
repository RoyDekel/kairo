import { Profiler } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import App from '../App';
import { AuthProvider } from '../contexts/AuthProvider';

/*
  Companion to emailConfirmation.test.jsx, which covers WHAT the `?confirmed=true` redirect
  does. This file covers WHEN: the outcome of a confirmation link is a function of how the page
  was opened and what Supabase made of the link, so it is knowable on the first render once
  auth has resolved.

  It used to be written into state from an effect, so the app painted a frame with neither the
  welcome toast nor the fallback modal before showing either. On the expired path that frame is
  a landing page that looks like the link simply did nothing. See [KAI-001].

  Same mocking approach as emailConfirmation.test.jsx: useAuth comes from authContext.js, and
  vi.hoisted lets each test set the auth state before rendering.
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

const renderWithFrames = (frames) =>
  render(
    <Profiler
      id="app"
      onRender={() => {
        frames.push({
          toast: !!screen.queryByText(/email confirmed/i),
          modal: !!screen.queryByRole('heading', { name: 'Welcome Back' }),
        });
      }}
    >
      <AuthProvider>
        <App />
      </AuthProvider>
    </Profiler>
  );

describe('Email confirmation resolves without a wasted frame', () => {
  beforeEach(() => {
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    mockAuthState.loading = false;
    setUrl('');
  });

  test('shows the welcome toast in the first committed frame', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', email: 'roy@example.com' };
    setUrl('?confirmed=true');

    const frames = [];
    renderWithFrames(frames);

    expect(frames[0].toast).toBe(true);
    // Never a frame where the confirmation silently did nothing.
    expect(frames.filter((f) => !f.toast && !f.modal)).toEqual([]);
  });

  test('shows the expired-link fallback in the first committed frame', () => {
    mockAuthState.isAuthenticated = false;
    setUrl('?confirmed=true');

    const frames = [];
    renderWithFrames(frames);

    expect(frames[0].modal).toBe(true);
    expect(frames.filter((f) => !f.toast && !f.modal)).toEqual([]);
  });

  test('shows neither when the page was not opened from a confirmation link', () => {
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { id: 'user-1', email: 'roy@example.com' };
    setUrl('');

    const frames = [];
    renderWithFrames(frames);

    expect(frames.every((f) => !f.toast && !f.modal)).toBe(true);
  });

  test('a normal sign-in prompt carries no expired-link notice', () => {
    mockAuthState.isAuthenticated = false;
    setUrl('');

    render(
      <AuthProvider>
        <App />
      </AuthProvider>
    );

    // Opening the modal by hand must not inherit a notice left behind by a previous
    // confirmation attempt.
    expect(screen.queryByText(/expired or was already used/i)).not.toBeInTheDocument();
  });
});
