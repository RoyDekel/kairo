import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Server-side Supabase client, used for the durable fixture cache.
 *
 * Deliberately NOT the VITE_-prefixed variables the browser uses. Vite inlines anything
 * beginning with VITE_ into the public bundle, so a service key named that way would be
 * published with the site. These names have no prefix and therefore cannot leak that way.
 *
 * Returns null when unconfigured, and every caller must cope with that: the cache falls
 * back to memory-only rather than the server refusing to start.
 */
let client;

export const getServerSupabase = () => {
  if (client !== undefined) return client;

  /*
    The URL may fall back to the client's copy: it is not a secret, it is publicly visible
    in the deployed bundle anyway, and it necessarily points at the same project. Requiring
    it twice only creates an opportunity for the two to drift apart.

    The KEY has no such fallback and must never get one. VITE_SUPABASE_ANON_KEY is the
    public, RLS-enforced key; silently accepting it here would produce a client that looks
    configured, passes every startup check, and then has every cache write denied by RLS.
  */
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    const missing = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_KEY'].filter(Boolean);
    console.warn(
      `[supabase] ${missing.join(' and ')} not set — the fixture cache will be memory-only, ` +
      'and will be lost every time the service spins down.'
    );
    client = null;
    return client;
  }

  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
};

/** Test seam. */
export const resetServerSupabase = () => {
  client = undefined;
};
