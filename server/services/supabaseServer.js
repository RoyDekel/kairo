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

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    console.warn(
      '[supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — the fixture cache will be ' +
      'memory-only, and will be lost every time the service spins down.'
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
