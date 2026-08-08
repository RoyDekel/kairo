import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexCss = readFileSync(resolve(__dirname, '../../index.css'), 'utf-8');

// Pulls a single top-level `.selector { ... }` rule block out of the stylesheet source so
// assertions below read one declaration at a time instead of matching anywhere in the file.
function getRuleBlock(css, selector) {
  const escaped = selector.replace(/[.]/g, '\\.');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Rule ${selector} not found in index.css`);
  return match[1];
}

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

  /*
    The two bugs Roy reported (see-through modal background, unreadable success text) are
    both CSS-paint problems: jsdom has no layout/paint pipeline, so no amount of RTL
    rendering here can tell us the modal is actually opaque or that the green text actually
    has enough contrast. What *is* testable, and what regresses these bugs if it slips, is
    the stylesheet source those computed values come from -- so pin that directly.

    Manual verification of the actual fix (this sandbox has no working browser -- `npm run
    dev` fails with EPERM unlinking node_modules/.vite/deps on this bind-mounted repo) was
    done by hand-computing the WCAG relative-luminance contrast ratio of the composited
    layers (auth-overlay scrim -> auth-modal background -> auth-message-success background)
    for both themes:
      - Modal background: before, .auth-modal used var(--bg-glass) (0.75-0.8 alpha), which
        composites with whatever page content sits behind the overlay -- the reported "see
        through" card. var(--bg-secondary) is fully opaque in both themes.
      - Success text: before, the hardcoded #34d399 gave ~7.5:1 contrast against the
        composited dark-theme banner background but only ~1.3:1 against the composited
        light-theme one -- and light is the app's default theme (see App.jsx's
        `localStorage.getItem('theme') || 'light'`). --success-text now resolves to #065f46
        in light (~5.2:1) and keeps #34d399 in dark (~7.5:1, unchanged).
  */
  test('auth-modal uses an opaque background, not the translucent glass-panel variable', () => {
    const rule = getRuleBlock(indexCss, '.auth-modal');
    expect(rule).toMatch(/background:\s*var\(--bg-secondary\)/);
    expect(rule).not.toMatch(/background:\s*var\(--bg-glass\)/);
  });

  test('auth-message-success uses a theme-aware, contrast-checked text color', () => {
    const rule = getRuleBlock(indexCss, '.auth-message-success');
    expect(rule).toMatch(/color:\s*var\(--success-text\)/);
    expect(rule).not.toMatch(/color:\s*#34d399/);
  });

  test('--success-text is defined for both the light (:root) and dark theme', () => {
    const rootBlock = getRuleBlock(indexCss, ':root');
    const darkBlock = getRuleBlock(indexCss, '.dark-theme');
    expect(rootBlock).toMatch(/--success-text:\s*#065f46/);
    expect(darkBlock).toMatch(/--success-text:\s*#34d399/);
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
