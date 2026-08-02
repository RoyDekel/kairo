import { getServerSupabase } from './supabaseServer.js';

/**
 * Boot-time check that the Supabase migrations in supabase/ have actually been applied.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Every file in supabase/ is applied BY HAND in the SQL editor. Nothing in the deploy runs
 * them, and nothing in the app noticed when they had not been.
 *
 * Phase 0 added `currency` and `collected_by` to fare_observations and shipped the code
 * that writes them. The migration was never run. From that deploy onward every insert was
 * rejected by Postgres — and FareHistory catches its own write errors on purpose, because
 * losing one observation must never cost a user their search:
 *
 *     if (error) { console.warn(...); return false; }
 *
 * That decision is correct and it is also what made the fault invisible. The table stayed
 * empty, which is exactly what an empty table looks like. The percentile stayed null,
 * which is exactly what "not enough history yet" looks like. Every symptom was
 * indistinguishable from normal early-life behaviour, and the only trace was a warning in
 * a log nobody had reason to read.
 *
 * A missing migration should announce itself once, loudly, at boot — not be inferred weeks
 * later from a baseline that never grew.
 * -------------------------------------------------------------------------------------
 */

/**
 * Columns the server writes on every insert. A missing one fails the whole row, so this
 * list is "what the code assumes", not "what would be nice to have".
 */
const REQUIRED_COLUMNS = {
  fare_observations: {
    file: 'supabase/fare_observations.sql',
    columns: [
      'route',
      'origin',
      'destination',
      'departure_date',
      'return_date',
      'trip_nights',
      'roundtrip_price',
      'provider',
      'currency',
      'collected_by',
      'observed_at'
    ]
  }
};

/**
 * Ceiling on the whole check.
 *
 * This runs inside the listen callback. An unreachable Supabase would otherwise leave the
 * promise pending forever — harmless to traffic, but it means the deploy log never gets
 * its verdict, which is the entire point of the check. A diagnostic that can hang is a
 * diagnostic you stop trusting.
 */
const PROBE_TIMEOUT_MS = 8000;

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms).unref?.()
    )
  ]);

/**
 * Probes one table by selecting the columns the code depends on.
 *
 * `limit(0)` asks Postgres to validate the projection without returning rows, so this
 * costs nothing and works against an empty table — which is the state it most needs to
 * work in.
 *
 * @returns {Promise<{table: string, ok: boolean, detail: string}>}
 */
async function probeTable(supabase, table, spec) {
  try {
    const { error } = await withTimeout(
      supabase.from(table).select(spec.columns.join(',')).limit(0),
      PROBE_TIMEOUT_MS,
      `[schemaCheck] ${table} probe`
    );

    if (!error) return { table, ok: true, detail: 'ok' };

    // PostgREST reports an unknown column as 42703, and names it in the message.
    const missing = /column .*?(\w+).*? does not exist/i.exec(error.message)?.[1];
    return {
      table,
      ok: false,
      detail: missing
        ? `column "${missing}" is missing — run ${spec.file}`
        : `${error.message} — check ${spec.file}`
    };
  } catch (err) {
    // Unreachable Supabase is a different problem, and not one this check should assert on.
    return { table, ok: false, detail: `could not be checked: ${err.message}` };
  }
}

/**
 * Runs every probe and logs the outcome. Never throws and never blocks startup: a schema
 * problem must be shouted about, not turned into an outage.
 *
 * @returns {Promise<boolean>} true when every checked table is usable.
 */
export async function verifySchema(supabase = getServerSupabase()) {
  if (!supabase) {
    console.warn('[schemaCheck] No Supabase service client — fare history and durable caches are disabled.');
    return false;
  }

  const results = await Promise.all(
    Object.entries(REQUIRED_COLUMNS).map(([table, spec]) => probeTable(supabase, table, spec))
  );

  const broken = results.filter((r) => !r.ok);

  if (broken.length === 0) {
    console.log('[schemaCheck] Supabase schema OK — fare observations will be recorded.');
    return true;
  }

  console.error('===============================================');
  console.error(' SUPABASE SCHEMA IS OUT OF DATE');
  for (const r of broken) {
    console.error(` - ${r.table}: ${r.detail}`);
  }
  console.error('');
  console.error(' Until this is fixed the server will keep running and every search will');
  console.error(' keep working — but NO fare observation will be recorded, and every');
  console.error(' historical percentile will be null. The failure is silent by design.');
  console.error('');
  console.error(' Apply the file above in the Supabase SQL editor. It is idempotent.');
  console.error('===============================================');
  return false;
}
