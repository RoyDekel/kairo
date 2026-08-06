/**
 * Browser-side cache of event lookups for the "When to Go" page.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The server cache already stops a repeated search from reaching Ticketmaster, but the
 * client still paid a full round trip — with a spinner, and a 12-second ceiling against a
 * backend that cold-starts — to be told something it had just been told. Re-running the
 * same dates after changing the budget slider, or coming back to the tab, re-fetched
 * results the page had already rendered.
 *
 * Cached PER DESTINATION rather than per search. The destination list is derived from the
 * budget filter, so a whole-search key would miss on every slider move; keyed per
 * destination, raising the budget asks the backend only about the destinations it just
 * admitted, and lowering it asks nothing at all.
 *
 * Events only. Fares are deliberately NOT cached here: "When to Go" and "Search & Compare"
 * must quote the same number for the same route (see priceConsistency.test.js), and a
 * client-held fare that outlives the server's 15-minute quote cache is exactly how those
 * two pages start disagreeing.
 *
 * sessionStorage rather than localStorage: surviving a reload is the useful part, and
 * scoping to the tab means a stale schedule cannot follow the user around for days.
 * -------------------------------------------------------------------------------------
 */

/** Bumped when the cached shape changes, so old entries are ignored rather than parsed. */
const NAMESPACE = 'kairo:events:v1';

/** Mirrors the server's event TTL. Schedules move far more slowly than fares. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fallback store for environments without a usable sessionStorage — Safari private mode
 * throws on write, and a test renderer may not have one at all. Losing the cache is
 * acceptable; throwing inside a search is not.
 */
const memoryFallback = new Map();

function getStore() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    // Touch it: presence is not permission in private browsing modes.
    const probe = `${NAMESPACE}:probe`;
    window.sessionStorage.setItem(probe, '1');
    window.sessionStorage.removeItem(probe);
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function buildKey(destination, startDate, endDate) {
  return [NAMESPACE, String(destination || '').toUpperCase(), startDate || '', endDate || ''].join('|');
}

function readRaw(key) {
  const store = getStore();
  if (!store) return memoryFallback.get(key) ?? null;

  const raw = store.getItem(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // A corrupt entry is a miss, not a crash.
    store.removeItem(key);
    return null;
  }
}

function writeRaw(key, entry) {
  const store = getStore();
  if (!store) {
    memoryFallback.set(key, entry);
    return;
  }

  try {
    store.setItem(key, JSON.stringify(entry));
  } catch {
    // Almost always a quota error. Drop our own entries and try once more; if that still
    // fails, run without a cache rather than failing the search.
    clearCachedEvents();
    try {
      store.setItem(key, JSON.stringify(entry));
    } catch {
      memoryFallback.set(key, entry);
    }
  }
}

/**
 * Splits a destination list into what we already know and what must be fetched.
 *
 * @returns {{cached: Record<string, Array>, misses: string[]}}
 */
export function readCachedEvents(destinationCodes = [], startDate, endDate, { ttlMs = DEFAULT_TTL_MS, now = Date.now() } = {}) {
  const cached = {};
  const misses = [];

  for (const code of destinationCodes) {
    const entry = readRaw(buildKey(code, startDate, endDate));

    if (!entry || !Array.isArray(entry.events) || now - entry.storedAt > ttlMs) {
      misses.push(code);
      continue;
    }

    cached[code] = entry.events;
  }

  return { cached, misses };
}

/**
 * Records answers.
 *
 * A destination the backend reported as `unavailable` is skipped: an empty array cached
 * for six hours would turn "we couldn't check" into "nothing is on", which is the exact
 * confusion the server's status codes were introduced to end.
 */
export function writeCachedEvents(eventsByDestination = {}, statusByDestination = {}, startDate, endDate, { now = Date.now() } = {}) {
  for (const [code, events] of Object.entries(eventsByDestination)) {
    if (statusByDestination[code] === 'unavailable') continue;
    if (!Array.isArray(events)) continue;

    writeRaw(buildKey(code, startDate, endDate), { events, storedAt: now });
  }
}

/**
 * How much of "what's on" the backend could see, cached alongside the events.
 *
 * A property of the deployment rather than of a search — it depends on which providers are
 * configured — so one key covers every destination. When it is unknown the caller assumes
 * the conservative answer, which can only lower a confidence label, never inflate one.
 */
const COVERAGE_KEY = `${NAMESPACE}|coverage`;

export function readCachedCoverage() {
  return readRaw(COVERAGE_KEY)?.coverage || null;
}

export function writeCachedCoverage(coverage) {
  if (!coverage) return;
  writeRaw(COVERAGE_KEY, { coverage });
}

/** Drops every entry this module owns, leaving the rest of sessionStorage alone. */
export function clearCachedEvents() {
  memoryFallback.clear();

  const store = getStore();
  if (!store) return;

  const doomed = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key?.startsWith(NAMESPACE)) doomed.push(key);
  }
  doomed.forEach((key) => store.removeItem(key));
}
