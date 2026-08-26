import { useState } from 'react';
import { Profiler } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import AuthModal from '../AuthModal.jsx';

vi.mock('../../contexts/authContext', () => ({
  useAuth: () => ({
    signIn: vi.fn(),
    signUp: vi.fn(),
    resetPassword: vi.fn(),
    supabaseAvailable: true,
  }),
}));

/*
  The modal opens in whatever mode the caller asked for, every time it opens -- App.jsx forces
  'signin' after an expired confirmation link, and that must win over whichever tab the user
  last switched to. `useState(initialMode)` alone does not do that, because an initialiser only
  runs on the first mount, which is why this used to be an effect re-setting the mode on open.

  The cost was a committed frame showing the previous mode's form before the effect corrected
  it. These tests pin the mode-on-open rule, the user's ability to switch while open, and the
  absence of that frame. See [KAI-001].
*/

const HEADINGS = { signin: 'Welcome Back', signup: 'Create Account' };

const visibleHeading = () => {
  if (screen.queryByRole('heading', { name: HEADINGS.signin })) return 'signin';
  if (screen.queryByRole('heading', { name: HEADINGS.signup })) return 'signup';
  return null;
};

// A stand-in for App.jsx: it owns isOpen/initialMode and hands them down as props.
function Host({ initialMode, onRender }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button onClick={() => setIsOpen(true)}>open</button>
      <button onClick={() => setIsOpen(false)}>close</button>
      <Profiler id="modal" onRender={onRender || (() => {})}>
        <AuthModal isOpen={isOpen} onClose={() => setIsOpen(false)} initialMode={initialMode} />
      </Profiler>
    </>
  );
}

const open = () => fireEvent.click(screen.getByText('open'));
const close = () => fireEvent.click(screen.getByText('close'));

describe('AuthModal opening mode', () => {
  test('opens in the mode the caller asked for', () => {
    render(<Host initialMode="signup" />);
    open();

    expect(visibleHeading()).toBe('signup');
  });

  test('lets the user switch mode while it is open', () => {
    render(<Host initialMode="signin" />);
    open();

    fireEvent.click(screen.getByText(/Sign Up/i, { selector: 'button, span, a' }));

    expect(visibleHeading()).toBe('signup');
  });

  test('never paints the previous mode when reopened', () => {
    const frames = [];
    render(
      <Host
        initialMode="signin"
        onRender={() => {
          const h = visibleHeading();
          if (h) frames.push(h);
        }}
      />
    );

    open();
    // The user wanders off to the sign-up tab, then closes the modal.
    fireEvent.click(screen.getByText(/Sign Up/i, { selector: 'button, span, a' }));
    expect(visibleHeading()).toBe('signup');
    close();

    frames.length = 0;
    open();

    // The caller asked for 'signin'. Not one committed frame may show the stale 'signup' form.
    expect(frames).not.toContain('signup');
    expect(visibleHeading()).toBe('signin');
  });

  test('renders nothing while closed', () => {
    render(<Host initialMode="signin" />);

    expect(visibleHeading()).toBeNull();
  });
});
