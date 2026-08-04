/**
 * Alert evaluator — runs immediately after each fare collector sweep.
 *
 * Reads every active price alert from Supabase, checks whether the most recent
 * fare observation for that route is at or below the target price, and fires a
 * notification if so.
 *
 * Rate-limited to one notification per alert per 24 hours so a volatile route
 * cannot spam the user.
 */

import { getServerSupabase } from '../services/supabaseServer.js';
import { notify } from '../services/notifier.js';

const RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Compose the alert text for a channel.
 *
 * Telegram renders Markdown; sendEmail passes its body through as `text`, with
 * no conversion. One shared string therefore cannot serve both — the version
 * that reads correctly in Telegram arrives in the inbox as literal asterisks
 * around every value, which is what a user then sees as the product's voice.
 *
 * @param {'telegram'|'email'} channel
 * @param {object} alert  - price_alerts row
 * @param {number} price  - latest observed fare
 * @returns {string}
 */
function buildMessage(channel, alert, price) {
  const route = `${alert.origin} → ${alert.destination}`;

  if (channel === 'email') {
    return (
      `KAIRO Price Alert\n\n` +
      `Route:         ${route}\n` +
      `Current price: $${price}\n` +
      `Your target:   $${alert.target_price}\n\n` +
      `The fare dropped below your target. Book before it rises again.`
    );
  }

  return (
    `🛫 *KAIRO Price Alert*\n\n` +
    `Route: *${route}*\n` +
    `Current price: *$${price}*\n` +
    `Your target: *$${alert.target_price}*\n\n` +
    `💰 The fare dropped below your target! Book now before it rises.`
  );
}

/**
 * Evaluate all active alerts against the latest fare observations.
 * @param {object} [supabase] - Supabase client (defaults to server client)
 */
export async function evaluateAlerts(supabase = getServerSupabase()) {
  if (!supabase) {
    console.warn('[alertEvaluator] No Supabase client — alert evaluation skipped.');
    return { evaluated: 0, fired: 0 };
  }

  // 1. Fetch all active alerts
  const { data: alerts, error: alertError } = await supabase
    .from('price_alerts')
    .select('*')
    .eq('is_active', true);

  if (alertError) {
    console.error(`[alertEvaluator] Failed to fetch alerts: ${alertError.message}`);
    return { evaluated: 0, fired: 0 };
  }

  if (!alerts || alerts.length === 0) {
    return { evaluated: 0, fired: 0 };
  }

  // 2. Collect unique routes to query
  const routes = [...new Set(alerts.map((a) => a.route))];

  // 3. Fetch the latest fare observation per route (last 24 hours)
  const latestFares = new Map();
  for (const route of routes) {
    const { data: fares } = await supabase
      .from('fare_observations')
      .select('roundtrip_price, observed_at')
      .eq('route', route)
      .order('observed_at', { ascending: false })
      .limit(1);

    if (fares && fares.length > 0) {
      latestFares.set(route, {
        price: Number(fares[0].roundtrip_price),
        observedAt: fares[0].observed_at
      });
    }
  }

  // 4. Evaluate each alert
  const now = Date.now();
  let fired = 0;

  for (const alert of alerts) {
    const fare = latestFares.get(alert.route);
    if (!fare) continue;

    // Check price threshold
    if (fare.price > Number(alert.target_price)) continue;

    // Check rate limit (24h cooldown)
    if (alert.last_notified_at) {
      const lastNotified = new Date(alert.last_notified_at).getTime();
      if (now - lastNotified < RATE_LIMIT_MS) continue;
    }

    const sent = await notify(
      alert.channel,
      alert.channel_target,
      buildMessage(alert.channel, alert, fare.price)
    );

    if (sent) {
      // Update last_notified_at to enforce the 24h rate limit
      await supabase
        .from('price_alerts')
        .update({ last_notified_at: new Date().toISOString() })
        .eq('id', alert.id);

      fired++;
      console.log(`[alertEvaluator] Fired alert ${alert.id} for ${alert.route}: $${fare.price} <= $${alert.target_price}`);
    }
  }

  console.log(`[alertEvaluator] Evaluated ${alerts.length} alerts, fired ${fired} notifications.`);
  return { evaluated: alerts.length, fired };
}
