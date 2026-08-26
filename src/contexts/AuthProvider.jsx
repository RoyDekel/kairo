import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { AuthContext } from './authContext';

/*
  Hardcoded, not `window.location.origin + window.location.pathname`, for the same reason
  src/lib/apiBase.js hardcodes PRODUCTION_API_URL: this is a GitHub Pages SPA served under
  `base: '/kairo/'` (vite.config.js), so the origin+pathname it was computing was already
  the right shape in production -- but Supabase requires every redirect target to be on an
  allow-list configured in the Supabase dashboard, and a value that quietly changes with
  whatever host/path the signup happened to be run from (a preview deploy, a stray query
  string, etc.) can't be allow-listed. Pinning it to the one canonical production URL keeps
  the confirmation link deterministic and matches what's actually registered with Supabase.
  `?confirmed=true` is read on mount in App.jsx to show a welcome toast (or, if the link was
  expired/reused and the user isn't actually authenticated, fall back to the sign-in modal).
*/
const EMAIL_CONFIRMATION_REDIRECT_URL = 'https://roydekel.github.io/kairo/?confirmed=true';

// This file exports exactly one thing, and it must stay that way: the context and the
// `useAuth` hook live in ./authContext.js so Fast Refresh can keep auth state across edits.
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  /*
    `loading` means "a session check is in flight". With no Supabase client there is no check
    to run, so the provider is already in its final state and must say so on its first render.

    This used to start at `true` unconditionally and be corrected by the effect below, which
    mounted the entire application behind a loading gate and immediately re-rendered it out --
    every component in the app sits under this provider, so it was the widest cascading render
    of the eleven KAI-001 found. `supabase` is a module import and cannot change at runtime, so
    reading it here is safe.
  */
  const [loading, setLoading] = useState(!!supabase);

  useEffect(() => {
    // If Supabase is not configured, skip auth entirely. `loading` is already false above.
    if (!supabase) return;

    // Get the initial session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setUser(currentSession?.user ?? null);
      setLoading(false);
    });

    // Listen for auth state changes (login, logout, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUser(newSession?.user ?? null);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async (email, password) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL,
      },
    });
    if (error) throw error;
    // With email confirmations enabled, Supabase deliberately does NOT return an error when
    // the email already belongs to a confirmed account -- that would leak which addresses are
    // registered (anti-enumeration). Instead signUp resolves successfully but hands back a user
    // whose `identities` array is empty. Detect that and raise the same "User already registered"
    // error Supabase gives in other configs, so AuthModal's existing message map surfaces it as
    // a real error rather than the misleading "check your email" success state.
    // Guard for shape: only an explicit empty array is the signal -- a missing/undefined
    // `identities` must not trip this, to avoid false positives on unexpected response shapes.
    if (Array.isArray(data?.user?.identities) && data.user.identities.length === 0) {
      throw new Error('User already registered');
    }
    return data;
  };

  const signIn = async (email, password) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  };

  const signInWithGoogle = async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const resetPassword = async (email) => {
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw error;
    return data;
  };

  const value = {
    user,
    session,
    loading,
    isAuthenticated: !!user,
    supabaseAvailable: !!supabase,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    resetPassword,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
