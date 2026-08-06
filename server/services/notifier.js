/**
 * Notification dispatcher for price alert delivery.
 *
 * Supports two channels:
 *   - telegram: Direct HTTP POST to the Telegram Bot API
 *   - email:    SMTP via nodemailer
 *
 * Both channels degrade gracefully when credentials are missing: a warning is
 * logged and the function returns false rather than throwing. This lets the
 * alert evaluator run in every environment without conditional gating.
 */

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a Telegram message via the Bot API.
 * @param {string} chatId  - Recipient chat ID
 * @param {string} message - Message text (supports Markdown)
 * @returns {Promise<boolean>} true if sent successfully
 */
export async function sendTelegram(chatId, message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('[notifier] TELEGRAM_BOT_TOKEN not set — skipping Telegram delivery.');
    return false;
  }

  const targetChatId = chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID;
  if (!targetChatId) {
    console.warn('[notifier] No chat_id provided and TELEGRAM_DEFAULT_CHAT_ID not set.');
    return false;
  }

  try {
    const url = `${TELEGRAM_API}/bot${token}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[notifier] Telegram API error ${resp.status}: ${body}`);
      return false;
    }

    console.log(`[notifier] Telegram message sent to chat ${targetChatId}.`);
    return true;
  } catch (err) {
    console.error(`[notifier] Telegram delivery failed: ${err.message}`);
    return false;
  }
}

/**
 * Send an email via SMTP.
 * @param {string} to      - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body    - Email body (plain text)
 * @returns {Promise<boolean>} true if sent successfully
 */
export async function sendEmail(to, subject, body) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn('[notifier] SMTP credentials not fully configured — skipping email delivery.');
    return false;
  }

  try {
    // Dynamic import so nodemailer is only loaded when actually needed
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user, pass }
    });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || user,
      to,
      subject,
      text: body
    });

    console.log(`[notifier] Email sent to ${to}.`);
    return true;
  } catch (err) {
    console.error(`[notifier] Email delivery failed: ${err.message}`);
    return false;
  }
}

/**
 * Route a notification to the correct channel.
 * @param {'telegram'|'email'} channel
 * @param {string} target  - chat_id or email address
 * @param {string} message - Notification message
 * @returns {Promise<boolean>}
 */
export async function notify(channel, target, message) {
  switch (channel) {
    case 'telegram':
      return sendTelegram(target, message);
    case 'email':
      return sendEmail(target, `KAIRO Price Alert`, message);
    default:
      console.warn(`[notifier] Unknown channel: ${channel}`);
      return false;
  }
}
