import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import AuthModal from '../AuthModal';

// useAuth lives in authContext.js, not AuthProvider.jsx (split for Fast Refresh — see the
// comment on AuthContext in src/contexts/authContext.js), so that's the module to mock.
const signUp = vi.fn().mockResolvedValue({ user: { id: 'new-user' } });

vi.mock('../../contexts/authContext', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp,
    resetPassword: vi.fn(),
    supabaseAvailable: true,
  }),
}));

describe('AuthModal — Create Account flow', () => {
  test('shows the post-signup success message with the success styling class', async () => {
    render(<AuthModal isOpen={true} onClose={() => {}} />);

    fireEvent.click(screen.getByText('Sign Up'));

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'roy@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(signUp).toHaveBeenCalledWith('roy@example.com', 'password123'));

    const successMsg = await screen.findByText(
      'Account created! Check your email to confirm your account.'
    );
    expect(successMsg).toHaveClass('auth-message-success');
  });
});

/*
  App.jsx forces the modal into sign-in mode with an explanatory notice when a user lands
  back on the site via an email-confirmation link that turned out to be expired or already
  used (see src/__tests__/emailConfirmation.test.jsx for that mount-time trigger). These
  cover the props AuthModal itself exposes for that: `initialMode` and `notice`.
*/
describe('AuthModal — initialMode / notice props', () => {
  test('opens in the mode given by initialMode instead of always defaulting to sign-in', () => {
    render(<AuthModal isOpen={true} onClose={() => {}} initialMode="signup" />);
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeInTheDocument();
  });

  test('defaults to sign-in mode when initialMode is not given', () => {
    render(<AuthModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
  });

  test('renders the notice message when provided, before any error or success state', () => {
    render(
      <AuthModal
        isOpen={true}
        onClose={() => {}}
        initialMode="signin"
        notice="That confirmation link has expired or was already used. Sign in below, or sign up again to get a new link."
      />
    );
    const notice = screen.getByText(/expired or was already used/i);
    expect(notice).toHaveClass('auth-message-notice');
  });

  test('re-syncs to a new initialMode when the modal is re-opened (e.g. forced to sign-in after an expired link)', () => {
    const { rerender } = render(
      <AuthModal isOpen={false} onClose={() => {}} initialMode="signup" />
    );
    rerender(<AuthModal isOpen={true} onClose={() => {}} initialMode="signin" />);
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
  });
});
