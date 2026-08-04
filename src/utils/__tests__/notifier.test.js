/**
 * @vitest-environment node
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { notify, sendTelegram, sendEmail } from '../../../server/services/notifier.js';

describe('Notifier — Telegram and Email delivery', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    global.fetch = vi.fn();
  });

  describe('sendTelegram', () => {
    test('returns false when TELEGRAM_BOT_TOKEN is unset', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
      const result = await sendTelegram('123456', 'Hello');
      expect(result).toBe(false);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('sends message via Telegram Bot API when configured', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token-123');
      global.fetch.mockResolvedValue({ ok: true });

      const result = await sendTelegram('789', 'Price dropped!');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.telegram.org/bottest-token-123/sendMessage',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"chat_id":"789"')
        })
      );
    });

    test('falls back to TELEGRAM_DEFAULT_CHAT_ID when no chatId given', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
      vi.stubEnv('TELEGRAM_DEFAULT_CHAT_ID', '999');
      global.fetch.mockResolvedValue({ ok: true });

      const result = await sendTelegram(null, 'Test');

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"chat_id":"999"')
        })
      );
    });

    test('returns false on API error', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
      global.fetch.mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('Forbidden') });

      const result = await sendTelegram('123', 'Test');
      expect(result).toBe(false);
    });

    test('returns false on network error', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
      global.fetch.mockRejectedValue(new Error('Network error'));

      const result = await sendTelegram('123', 'Test');
      expect(result).toBe(false);
    });
  });

  describe('sendEmail', () => {
    test('returns false when SMTP credentials are missing', async () => {
      vi.stubEnv('SMTP_HOST', '');
      vi.stubEnv('SMTP_USER', '');
      vi.stubEnv('SMTP_PASS', '');

      const result = await sendEmail('test@example.com', 'Subject', 'Body');
      expect(result).toBe(false);
    });
  });

  describe('notify', () => {
    test('routes telegram channel to sendTelegram', async () => {
      vi.stubEnv('TELEGRAM_BOT_TOKEN', 'tok');
      global.fetch.mockResolvedValue({ ok: true });

      const result = await notify('telegram', '123', 'Hello');
      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalled();
    });

    test('returns false for unknown channel', async () => {
      const result = await notify('pigeon', 'target', 'Hello');
      expect(result).toBe(false);
    });
  });
});
