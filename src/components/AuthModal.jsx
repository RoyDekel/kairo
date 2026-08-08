import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/authContext';
import { Mail, Lock, Eye, EyeOff, X, Loader2, UserPlus, LogIn, KeyRound } from 'lucide-react';

export default function AuthModal({ isOpen, onClose, initialMode = 'signin', notice = '' }) {
  const { signIn, signUp, resetPassword, supabaseAvailable } = useAuth();

  const [mode, setMode] = useState(initialMode); // 'signin' | 'signup' | 'forgot'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Re-sync when the caller re-opens the modal in a different mode (e.g. App.jsx forcing
  // 'signin' after an expired/reused email-confirmation link) -- `useState(initialMode)`
  // only reads its argument on first mount, so without this the modal would stay stuck in
  // whatever mode it opened with the very first time.
  useEffect(() => {
    if (isOpen) setMode(initialMode);
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError('');
    setSuccessMsg('');
    setShowPassword(false);
  };

  const switchMode = (newMode) => {
    resetForm();
    setMode(newMode);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!supabaseAvailable) {
      setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    // Validation
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    if (mode !== 'forgot' && !password) {
      setError('Please enter a password.');
      return;
    }

    if (mode === 'signup') {
      if (password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setIsLoading(true);

    try {
      if (mode === 'signin') {
        await signIn(email, password);
        onClose();
      } else if (mode === 'signup') {
        await signUp(email, password);
        setSuccessMsg('Account created! Check your email to confirm your account.');
      } else if (mode === 'forgot') {
        await resetPassword(email);
        setSuccessMsg('Password reset link sent! Check your email inbox.');
      }
    } catch (err) {
      // Map Supabase error messages to user-friendly ones
      const msg = err.message || 'An unexpected error occurred.';
      if (msg.includes('Invalid login credentials')) {
        setError('Invalid email or password. Please try again.');
      } else if (msg.includes('User already registered')) {
        setError('An account with this email already exists. Try signing in instead.');
      } else if (msg.includes('Email not confirmed')) {
        setError('Please confirm your email before signing in. Check your inbox.');
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const titles = {
    signin: 'Welcome Back',
    signup: 'Create Account',
    forgot: 'Reset Password',
  };

  const subtitles = {
    signin: 'Sign in to sync your watchlists, alerts, and preferences across devices.',
    signup: 'Create a free account to save your flight data to the cloud.',
    forgot: 'Enter your email and we\'ll send you a password reset link.',
  };

  return (
    <div
      className="auth-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="auth-modal animate-fade-in" onClick={(e) => e.stopPropagation()}>
        {/* Close Button */}
        <button
          onClick={onClose}
          className="auth-close-btn"
          title="Close"
        >
          <X size={18} />
        </button>

        {/* Header */}
        <div className="auth-header">
          <div className="auth-logo">
            <div className="auth-logo-icon">✈</div>
          </div>
          <h2 className="auth-title">{titles[mode]}</h2>
          <p className="auth-subtitle">{subtitles[mode]}</p>
        </div>

        {/* Error / Success Messages */}
        {notice && !error && !successMsg && (
          <div className="auth-message auth-message-notice">
            {notice}
          </div>
        )}
        {error && (
          <div className="auth-message auth-message-error">
            {error}
          </div>
        )}
        {successMsg && (
          <div className="auth-message auth-message-success">
            {successMsg}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="auth-form">
          {/* Email */}
          <div className="auth-input-group">
            <label htmlFor="auth-email" className="auth-input-label">Email</label>
            <div className="auth-input-wrapper">
              <Mail size={16} className="auth-input-icon" />
              <input
                id="auth-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="auth-input"
                autoComplete="email"
                autoFocus
              />
            </div>
          </div>

          {/* Password (not shown for forgot mode) */}
          {mode !== 'forgot' && (
            <div className="auth-input-group">
              <label htmlFor="auth-password" className="auth-input-label">Password</label>
              <div className="auth-input-wrapper">
                <Lock size={16} className="auth-input-icon" />
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="auth-input"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="auth-password-toggle"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          )}

          {/* Confirm Password (signup only) */}
          {mode === 'signup' && (
            <div className="auth-input-group">
              <label htmlFor="auth-confirm-password" className="auth-input-label">Confirm Password</label>
              <div className="auth-input-wrapper">
                <Lock size={16} className="auth-input-icon" />
                <input
                  id="auth-confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="auth-input"
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          {/* Forgot Password Link (signin mode only) */}
          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginTop: '-4px' }}>
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="auth-link-btn"
              >
                Forgot password?
              </button>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            className="btn btn-primary auth-submit-btn"
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 size={18} className="auth-spinner" />
            ) : mode === 'signin' ? (
              <LogIn size={18} />
            ) : mode === 'signup' ? (
              <UserPlus size={18} />
            ) : (
              <KeyRound size={18} />
            )}
            {isLoading
              ? 'Please wait...'
              : mode === 'signin'
              ? 'Sign In'
              : mode === 'signup'
              ? 'Create Account'
              : 'Send Reset Link'}
          </button>
        </form>

        {/* Mode Switcher */}
        <div className="auth-footer">
          {mode === 'signin' && (
            <p>
              Don't have an account?{' '}
              <button type="button" onClick={() => switchMode('signup')} className="auth-link-btn auth-link-btn-accent">
                Sign Up
              </button>
            </p>
          )}
          {mode === 'signup' && (
            <p>
              Already have an account?{' '}
              <button type="button" onClick={() => switchMode('signin')} className="auth-link-btn auth-link-btn-accent">
                Sign In
              </button>
            </p>
          )}
          {mode === 'forgot' && (
            <p>
              Remember your password?{' '}
              <button type="button" onClick={() => switchMode('signin')} className="auth-link-btn auth-link-btn-accent">
                Back to Sign In
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
