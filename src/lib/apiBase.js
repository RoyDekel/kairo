/**
 * Resolves the KAIRO backend base URL.
 *
 * Extracted so App.jsx, AlternativeFlights.jsx and aiDestinationEngine.js cannot
 * drift apart on how they locate the API.
 */

/**
 * Known-good production backend, used ONLY as a last resort when the build was not
 * given VITE_API_URL at all (e.g. the `VITE_API_URL` GitHub Actions secret is missing).
 *
 * The previous fallback here was `http://localhost:3001` unconditionally — including on
 * a real deployed hostname. That is actively dangerous: it "works" only by accident, when
 * whoever is loading the site happens to have a local dev backend running on their own
 * machine at that moment (which is exactly what made this bug hard to notice — it looked
 * fine while testing locally). For every other visitor it's a silent connection-refused,
 * indistinguishable from the app being down, and it explains why production traffic never
 * showed up in Render's logs even though the backend itself was healthy. Falling back to
 * the real backend instead means a misconfigured build still works for real users; it
 * does NOT excuse leaving VITE_API_URL unset in CI, which is the actual fix (see
 * .github/workflows/deploy.yml).
 */
const PRODUCTION_API_URL = 'https://flight-tracker-backend-8bxt.onrender.com';

export function getApiBase() {
  if (import.meta.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }

  if (typeof window !== 'undefined') {
    const { hostname } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
  }

  // Built without VITE_API_URL and not running on localhost: this is a real deployment
  // that CI failed to configure. Point it at production rather than localhost so real
  // visitors still reach a working API instead of a connection refused.
  return PRODUCTION_API_URL;
}

/** Builds the Authorization header set for a Supabase session (empty when signed out). */
export function authHeaders(accessToken) {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/**
 * fetch() with an abort-based timeout. The Render free tier cold-starts, so every
 * client call needs a ceiling rather than hanging the UI.
 */
export async function fetchWithTimeout(url, { timeoutMs = 8000, ...options } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
