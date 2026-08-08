/**
 * Keeps the Render web service awake so the in-process schedulers actually fire.
 *
 * -------------------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * fareCollector and alertEvaluator are node-cron jobs living INSIDE this process. Render's
 * free tier spins a web service down after roughly 15 minutes with no inbound HTTP
 * traffic, and the process dies with it — taking both schedules along. With
 * COLLECTOR_CRON="0 *\/6 * * *" there are six silent hours between sweeps, so the service
 * is asleep long before the next one is due and the sweep simply never happens. The
 * collector then looks correct in code, logs nothing, and fare_observations stays empty.
 *
 * An HTTP request the service makes to its OWN public URL is inbound traffic from
 * Render's point of view, which resets the idle timer.
 *
 * -------------------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO
 *
 * It PREVENTS spin-down. It cannot RECOVER from one. A process that is already asleep is
 * not running this timer and cannot wake itself — only a genuinely external request can.
 * So after any deploy, crash or manual suspend, the first wake-up must come from outside.
 *
 * That is the whole argument for ALSO pointing a free external pinger (cron-job.org,
 * UptimeRobot) at /api/health. This module reduces how often you depend on that; it does
 * not remove the dependency. Treat it as a mitigation, not a fix.
 *
 * -------------------------------------------------------------------------------------
 * COST
 *
 * Staying awake 24/7 is ~730 instance-hours/month against the free tier's 750. That is
 * fine for ONE free web service and blows the budget the moment there are two. If you add
 * another free service, lengthen KEEPALIVE_INTERVAL_MS or accept the spin-downs.
 */

/** Render's idle timeout is ~15 minutes. Ten leaves room for a slow request. */
const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;

/** A ping is a liveness signal, not a query. It should never hang the timer. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Resolves the public URL to ping.
 *
 * RENDER_EXTERNAL_URL is injected by Render for web services at runtime — not at build
 * time, and not for background workers or cron services. KEEPALIVE_URL is the explicit
 * override for every other host.
 */
export function resolveKeepAliveUrl(env = process.env) {
  const explicit = (env.KEEPALIVE_URL || '').trim();
  if (explicit) return explicit;

  const base = (env.RENDER_EXTERNAL_URL || '').trim();
  if (!base) return null;

  return `${base.replace(/\/+$/, '')}/api/health`;
}

/**
 * True when pinging this URL would be pointless or actively wrong.
 *
 * Local development has no idle timer to defeat, and a loopback ping on a host that does
 * have one would not count as inbound traffic anyway — it would just produce a log line
 * every ten minutes that looks like the feature working when it isn't.
 */
export function isSelfPingUseless(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return true; // Unparseable URL: refuse rather than ping something unintended.
  }
}

export async function pingOnce(url, { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { method: 'GET', signal: controller.signal });
    if (!response.ok) {
      console.warn(`[keepAlive] Ping returned HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    /*
      Warn, never throw. A failed ping costs one skipped idle-timer reset. Letting it reach
      the top level as an unhandled rejection would cost the whole process — which is the
      exact outcome this module exists to prevent.
    */
    console.warn(`[keepAlive] Ping failed: ${err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message}`);
    return false;
  } finally {
    /*
      The abort timer must be cancelled on every exit path, not just the slow one. Without
      this, each ping left a live timer holding a reference to its AbortController until the
      full timeout elapsed — once every cron tick, forever, on a process that is meant to run
      for months. It also meant a controller for an already-settled request was still aborted
      later, which is harmless here only by luck.
    */
    clearTimeout(timeoutId);
  }
}

export function startKeepAlive({ env = process.env, fetchImpl = fetch } = {}) {
  if (env.KEEPALIVE_ENABLED !== 'true') {
    return null;
  }

  const url = resolveKeepAliveUrl(env);
  if (!url) {
    console.warn(
      '[keepAlive] Enabled but no URL available. Set KEEPALIVE_URL, or deploy as a Render ' +
      'web service so RENDER_EXTERNAL_URL is injected. Not starting.'
    );
    return null;
  }

  if (isSelfPingUseless(url)) {
    console.log(`[keepAlive] Skipping: ${url} is loopback, so there is no idle timer to reset.`);
    return null;
  }

  const intervalMs = Math.max(60_000, Number(env.KEEPALIVE_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  console.log(`[keepAlive] Pinging ${url} every ${Math.round(intervalMs / 60000)} min to hold off spin-down.`);

  const timer = setInterval(() => {
    pingOnce(url, { fetchImpl });
  }, intervalMs);

  /*
    unref() so this timer alone never keeps the event loop alive. The HTTP server is what
    should decide when the process may exit; a keep-alive that outlives it would turn a
    clean shutdown into a hang.
  */
  timer.unref?.();

  return timer;
}
