/**
 * Proves the durable fixture cache works, without spending a single API call.
 *
 *   node scripts/verifyFixtureCache.js
 *
 * Everything this exercises — the credentials, the table, the column names, the upsert,
 * the TTL, and the cold-start read — is independent of API-Sports. So it can be run while
 * the API account is unavailable, and it will never touch the daily allowance.
 *
 * Run it BEFORE relying on the cache in production. If the table or the key is wrong, the
 * only symptom in normal operation is a [dayCache] warning buried in the logs while the
 * cache silently degrades to memory-only — which looks exactly like everything working.
 */

import { PersistentDayCache, ttlForDate } from '../server/services/persistentDayCache.js';
import { getServerSupabase } from '../server/services/supabaseServer.js';

/*
  A sentinel date, deliberately in the past, so this probe can never collide with or
  pollute a real lookup. The row is left behind rather than deleted: it is inert, it costs
  nothing, and a verification script should not be in the business of removing rows.
*/
const PROBE_DATE = '1970-01-01';

const pass = (msg) => console.log(`  [32mPASS[0m  ${msg}`);
const fail = (msg) => console.log(`  [31mFAIL[0m  ${msg}`);
const info = (msg) => console.log(`        ${msg}`);

const run = async () => {
  console.log('\nVerifying the durable fixture cache\n');

  const supabase = getServerSupabase();

  if (!supabase) {
    fail('No credentials. SUPABASE_URL / SUPABASE_SERVICE_KEY are not set in .env.');
    info('The cache will work, but only in memory — and Render drops that on every');
    info('spin-down, which is the whole problem this was meant to solve.');
    process.exit(1);
  }
  pass('Credentials found.');

  const cache = new PersistentDayCache({ supabase });
  const payload = { fixtures: [], probe: true, at: new Date().toISOString() };

  // 1. Write.
  try {
    await cache.set(PROBE_DATE, payload);
  } catch (err) {
    fail(`Write threw: ${err.message}`);
    process.exit(1);
  }

  // 2. Read back from a COLD cache — a new object with empty memory, which is exactly
  //    what Render hands the app after a spin-down or a deploy.
  const cold = new PersistentDayCache({ supabase });
  const readBack = await cold.get(PROBE_DATE);

  if (!readBack) {
    fail('Wrote a row, but a cold read returned nothing.');
    info('Most likely one of:');
    info('  - the table does not exist      -> run supabase/fixtures_cache.sql');
    info('  - the key is the ANON key       -> RLS blocks it; use the secret/service key');
    info('  - the column names differ       -> expected fixture_date, payload, expires_at');
    info('Re-run with the warnings above visible; they name the Postgres error.');
    process.exit(1);
  }

  if (readBack.at !== payload.at) {
    fail('Read a row back, but it was not the one just written.');
    process.exit(1);
  }

  pass('Wrote a row and read it back from a cold cache.');
  pass('The cache now survives spin-downs and deploys.');

  // 3. Show the TTL policy on real dates, so the numbers are visible rather than assumed.
  console.log('\nTTL by distance from today:\n');
  const day = 24 * 60 * 60 * 1000;
  const hours = (ms) => `${Math.round(ms / (60 * 60 * 1000))}h`;

  for (const [label, offset, isEmpty] of [
    ['tomorrow', 1, false],
    ['in 2 weeks', 14, false],
    ['in 3 months', 90, false],
    ['in 3 months, no fixtures listed', 90, true]
  ]) {
    const date = new Date(Date.now() + offset * day).toISOString().slice(0, 10);
    console.log(`  ${label.padEnd(34)} ${date}   ${hours(ttlForDate(date, { isEmpty }))}`);
  }

  console.log(`\nA probe row remains at ${PROBE_DATE}. It is inert and matches no real search.\n`);
};

run().catch((err) => {
  fail(`Unexpected: ${err.message}`);
  process.exit(1);
});
