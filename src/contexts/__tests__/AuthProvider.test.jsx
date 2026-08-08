import { useEffect } from 'react';
import { render } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { AuthProvider } from '../AuthProvider';
import { useAuth } from '../authContext';

/*
  signUp lives on the auth context AuthProvider builds, so exercise it the way the app does:
  mount the real provider (with the Supabase client mocked at the module boundary) and pull
  the function off useAuth. The behaviour under test is the "already registered" detection --
  Supabase with email confirmations enabled does NOT return an error for an existing confirmed
  email (anti-enumeration); it resolves successfully with an empty `identities` array instead.
*/
const mockSignUp = vi.fn();

vi.mock('../../lib/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      signUp: (...args) => mockSignUp(...args),
    },
  },
}));

// Hand the live signUp back to the test through an effect (not a render-time assignment,
// which would be an impure side effect during render).
function Consumer({ onReady }) {
  const { signUp } = useAuth();
  useEffect(() => {
    onReady(signUp);
  }, [onReady, signUp]);
  return null;
}

function mountProvider() {
  let captured;
  render(
    <AuthProvider>
      <Consumer onReady={(fn) => { captured = fn; }} />
    </AuthProvider>
  );
  return captured;
}

describe('AuthProvider.signUp — existing-email detection', () => {
  beforeEach(() => {
    mockSignUp.mockReset();
  });

  test('throws "User already registered" when the returned user has an empty identities array', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'existing', identities: [] }, session: null },
      error: null,
    });
    const signUp = mountProvider();
    await expect(signUp('taken@example.com', 'password123')).rejects.toThrow(
      /User already registered/
    );
  });

  test('does NOT throw for a genuinely new signup (non-empty identities array)', async () => {
    mockSignUp.mockResolvedValue({
      data: {
        user: { id: 'new-user', identities: [{ id: 'idp-1' }] },
        session: null,
      },
      error: null,
    });
    const signUp = mountProvider();
    await expect(signUp('fresh@example.com', 'password123')).resolves.toMatchObject({
      user: { id: 'new-user' },
    });
  });

  test('does NOT treat a missing/undefined identities field as already-registered', async () => {
    // Guard against false positives on an unexpected response shape: only an explicit empty
    // array is the signal, never a missing field.
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'shapeless' }, session: null },
      error: null,
    });
    const signUp = mountProvider();
    await expect(signUp('unknown@example.com', 'password123')).resolves.toMatchObject({
      user: { id: 'shapeless' },
    });
  });

  test('still propagates a real Supabase error unchanged', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error('Password should be at least 6 characters'),
    });
    const signUp = mountProvider();
    await expect(signUp('x@example.com', 'short')).rejects.toThrow(
      /Password should be at least 6 characters/
    );
  });
});
