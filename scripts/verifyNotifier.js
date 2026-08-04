/**
 * Proves that alert notifications can actually be delivered, before an alert
 * depends on it.
 *
 *   node scripts/verifyNotifier.js                       # uses .env defaults
 *   node scripts/verifyNotifier.js --chat 612345678
 *   node scripts/verifyNotifier.js --email you@example.com
 *   node scripts/verifyNotifier.js --chat 612345678 --email you@example.com
 *
 * Run this BEFORE trusting alert delivery in production. notifier.js degrades
 * gracefully by design: a missing token, a wrong SMTP key and an unverified
 * sender all produce a logged warning and `false`, and in normal operation that
 * is buried in a sweep log next to a dozen healthy lines. The failure mode of a
 * notifier nobody has tested is silence, which is indistinguishable from "no
 * fares dropped below target this week".
 *
 * Each channel is checked in two stages:
 *
 *   1. A credential probe (getMe / SMTP verify) that talks to the provider and
 *      reports exactly why it was rejected. notify() only ever returns a
 *      boolean, so without this stage a failure cannot be told apart from any
 *      other failure.
 *   2. A real send through notify() — the same function the evaluator calls.
 *      Stage 1 passing only proves the credentials are good; stage 2 proves the
 *      code path is.
 *
 * Nothing here touches Supabase or the fare collector, so it is safe to run
 * against production credentials at any time.
 */

import dotenv from 'dotenv';
import { notify } from '../server/services/notifier.js';

dotenv.config();

const pass = (msg) => console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
const fail = (msg) => console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
const skip = (msg) => console.log(`  \x1b[33mSKIP\x1b[0m  ${msg}`);
const info = (msg) => console.log(`        ${msg}`);

/** Minimal flag parsing — no dependency for four lines of work. */
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
};

const SAMPLE_MESSAGE =
  '🛫 *KAIRO test notification*\n\n' +
  'If you are reading this, alert delivery works.\n' +
  'Sent by scripts/verifyNotifier.js — no real fare triggered it.';

let failures = 0;

/* ── Telegram ─────────────────────────────────────────────────────────────── */

const verifyTelegram = async () => {
  console.log('\nTelegram\n');

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = arg('chat') || process.env.TELEGRAM_DEFAULT_CHAT_ID;

  if (!token) {
    skip('TELEGRAM_BOT_TOKEN is not set — nothing to verify.');
    info('Create a bot with @BotFather, then put the token in .env.');
    return;
  }

  // Stage 1: does the token identify a real bot?
  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = await resp.json();

    if (!body.ok) {
      fail(`Telegram rejected the token: ${body.description}`);
      info('A 401 here means the token is wrong or the bot was deleted.');
      failures++;
      return;
    }
    pass(`Token is valid — bot is @${body.result.username}.`);
    info(`Update the hint text in AlertsManager.jsx if it names a different bot.`);
  } catch (err) {
    fail(`Could not reach the Telegram API: ${err.message}`);
    failures++;
    return;
  }

  if (!chatId) {
    skip('No chat ID to send to. Pass --chat <id>, or set TELEGRAM_DEFAULT_CHAT_ID.');
    info('To find yours: message the bot, then open');
    info(`https://api.telegram.org/bot<TOKEN>/getUpdates and read result[0].message.chat.id`);
    return;
  }

  // Stage 2: a real send, through the same function the evaluator uses.
  const sent = await notify('telegram', chatId, SAMPLE_MESSAGE);

  if (sent) {
    pass(`Message sent to chat ${chatId}. Check Telegram — it should be there now.`);
  } else {
    fail(`notify() could not deliver to chat ${chatId}. See the [notifier] line above.`);
    info('"chat not found" almost always means that chat has never messaged the bot.');
    info('Telegram forbids bots from opening a conversation; the user must go first.');
    failures++;
  }
};

/* ── Email ────────────────────────────────────────────────────────────────── */

const verifyEmail = async () => {
  console.log('\nEmail (SMTP)\n');

  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass_, SMTP_FROM: from } = process.env;
  const to = arg('email') || from || user;

  if (!host || !user || !pass_) {
    skip('SMTP_HOST / SMTP_USER / SMTP_PASS are not all set — nothing to verify.');
    return;
  }

  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    fail('nodemailer is not installed.');
    info('It is listed in package.json but absent from node_modules — run: npm install');
    failures++;
    return;
  }

  /*
    Brevo's login is a relay identifier, not a mailbox, so it can never be a
    valid From address. notifier.js falls back to SMTP_USER when SMTP_FROM is
    empty, which is right for Gmail and silently fatal here — the credentials
    authenticate, the send is accepted locally, and the provider rejects it.
  */
  if (!from && host.includes('brevo')) {
    fail('SMTP_FROM is empty while using Brevo.');
    info(`Delivery would be attempted as "${user}", which is not a verified sender.`);
    info('Set SMTP_FROM to an address confirmed under Senders in Brevo.');
    failures++;
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass: pass_ }
  });

  // Stage 1: are the credentials accepted at all?
  try {
    await transporter.verify();
    pass(`SMTP credentials accepted by ${host}:${port}.`);
  } catch (err) {
    fail(`SMTP authentication failed: ${err.message}`);
    if (String(err.message).includes('535')) {
      info('535 means the username or password was rejected. With Brevo the usual');
      info('cause is an API key pasted where an SMTP key belongs — they sit on the');
      info('same settings page and look alike. A trailing space also does this.');
    }
    failures++;
    return;
  }

  // Stage 2: a real send, through the same function the evaluator uses.
  const sent = await notify('email', to, SAMPLE_MESSAGE);

  if (sent) {
    pass(`Email sent to ${to} from ${from || user}.`);
    info('Check the spam folder too: a personal-domain From sent through a relay');
    info('fails that domain\'s DMARC alignment and is often filtered.');
  } else {
    fail(`notify() could not deliver to ${to}. See the [notifier] line above.`);
    info('If the credentials passed above, the sender address is the likely cause —');
    info('it must be verified with the provider before it can be used.');
    failures++;
  }
};

/* ── Run ──────────────────────────────────────────────────────────────────── */

const run = async () => {
  console.log('\nVerifying alert delivery');

  await verifyTelegram();
  await verifyEmail();

  console.log('');
  if (failures > 0) {
    console.log(`\x1b[31m${failures} check(s) failed.\x1b[0m Alerts will not deliver until these are fixed.\n`);
    process.exit(1);
  }
  console.log('\x1b[32mAll configured channels delivered.\x1b[0m\n');
  process.exit(0);
};

run();
