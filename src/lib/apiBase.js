/**
 * Resolves the KAIRO backend base URL.
 *
 * Extracted so App.jsx, AlternativeFlights.jsx and aiDestinationEngine.js cannot
 * drift apart on how they locate the API.
 */
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

  // Fallback to local backend (or configured production VITE_API_URL).
  // GitHub Pages (roydekel.github.io) is a static host without an Express backend,
  // so querying window.location.origin results in 404 errors.
  return 'http://localhost:3001';
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
