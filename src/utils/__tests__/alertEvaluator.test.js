/**
 * @vitest-environment node
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { evaluateAlerts, startAlertEvaluator } from '../../../server/jobs/alertEvaluator.js';

// Mock the notifier module
vi.mock('../../../server/services/notifier.js', () => ({
  notify: vi.fn().mockResolvedValue(true)
}));

import { notify } from '../../../server/services/notifier.js';

describe('AlertEvaluator — server-side alert matching', () => {
  let mockSupabase;

  const makeAlert = (overrides = {}) => ({
    id: 1,
    user_id: 'user-1',
    route: 'TLV-BCN',
    origin: 'TLV',
    destination: 'BCN',
    target_price: 400,
    channel: 'telegram',
    channel_target: '123456',
    is_active: true,
    last_notified_at: null,
    ...overrides
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    };
  });

  test('returns early with {evaluated:0, fired:0} when supabase is null', async () => {
    const result = await evaluateAlerts(null);
    expect(result).toEqual({ evaluated: 0, fired: 0 });
  });

  test('returns {evaluated:0, fired:0} when no active alerts exist', async () => {
    // Chain: from('price_alerts').select('*').eq('is_active', true)
    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === 'price_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        };
      }
      return mockSupabase;
    });
    mockSupabase.from = fromMock;

    const result = await evaluateAlerts(mockSupabase);
    expect(result).toEqual({ evaluated: 0, fired: 0 });
  });

  test('fires notification when fare is at or below target price', async () => {
    const alert = makeAlert({ target_price: 400 });

    // Build a mock that supports chained .from().select().eq().order().limit()
    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === 'price_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [alert], error: null })
          }),
          // The evaluator writes last_notified_at back through the same table.
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'fare_observations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ roundtrip_price: 350, observed_at: new Date().toISOString() }]
                })
              })
            })
          })
        };
      }
      // For the update call after notification
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        })
      };
    });
    mockSupabase.from = fromMock;

    const result = await evaluateAlerts(mockSupabase);

    expect(result.fired).toBe(1);
    expect(notify).toHaveBeenCalledWith(
      'telegram',
      '123456',
      expect.stringContaining('$350')
    );
  });

  test('does NOT fire when fare is above target price', async () => {
    const alert = makeAlert({ target_price: 300 });

    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === 'price_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [alert], error: null })
          }),
          // The evaluator writes last_notified_at back through the same table.
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'fare_observations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ roundtrip_price: 450, observed_at: new Date().toISOString() }]
                })
              })
            })
          })
        };
      }
      return mockSupabase;
    });
    mockSupabase.from = fromMock;

    const result = await evaluateAlerts(mockSupabase);

    expect(result.fired).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  test('respects 24-hour rate limit — skips alert notified recently', async () => {
    const recentTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const alert = makeAlert({
      target_price: 400,
      last_notified_at: recentTime
    });

    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === 'price_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [alert], error: null })
          }),
          // The evaluator writes last_notified_at back through the same table.
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'fare_observations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ roundtrip_price: 300, observed_at: new Date().toISOString() }]
                })
              })
            })
          })
        };
      }
      return mockSupabase;
    });
    mockSupabase.from = fromMock;

    const result = await evaluateAlerts(mockSupabase);

    expect(result.fired).toBe(0);
    expect(notify).not.toHaveBeenCalled();
  });

  test('fires when last_notified_at is older than 24 hours', async () => {
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
    const alert = makeAlert({
      target_price: 400,
      last_notified_at: oldTime
    });

    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === 'price_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [alert], error: null })
          }),
          // The evaluator writes last_notified_at back through the same table.
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'fare_observations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ roundtrip_price: 350, observed_at: new Date().toISOString() }]
                })
              })
            })
          })
        };
      }
      // For the update call
      return {
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        })
      };
    });
    mockSupabase.from = fromMock;

    const result = await evaluateAlerts(mockSupabase);

    expect(result.fired).toBe(1);
    expect(notify).toHaveBeenCalled();
  });

  test('sends email alerts as plain text, without Telegram Markdown', async () => {
    const alert = makeAlert({
      target_price: 400,
      channel: 'email',
      channel_target: 'roy@example.com'
    });

    const fromMock = vi.fn().mockImplementation((table) => {
      if (table === 'price_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: [alert], error: null })
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        };
      }
      if (table === 'fare_observations') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({
                  data: [{ roundtrip_price: 350, observed_at: new Date().toISOString() }]
                })
              })
            })
          })
        };
      }
      return mockSupabase;
    });
    mockSupabase.from = fromMock;

    const result = await evaluateAlerts(mockSupabase);
    expect(result.fired).toBe(1);

    // sendEmail passes its body through untouched, so an asterisk here is an
    // asterisk in the reader's inbox rather than bold text.
    const [channel, target, message] = notify.mock.calls[0];
    expect(channel).toBe('email');
    expect(target).toBe('roy@example.com');
    expect(message).not.toContain('*');
    expect(message).toContain('$350');
    expect(message).toContain('TLV → BCN');
  });
});

describe('startAlertEvaluator — schedule independent of the collector', () => {
  test('returns a scheduled task by default', () => {
    vi.stubEnv('ALERTS_BOOT_DELAY_MS', '999999'); // keep the boot run out of this test
    const job = startAlertEvaluator();

    expect(job).not.toBeNull();
    job.stop();
    vi.unstubAllEnvs();
  });

  test('returns null when ALERTS_ENABLED is explicitly false', () => {
    vi.stubEnv('ALERTS_ENABLED', 'false');

    expect(startAlertEvaluator()).toBeNull();
    vi.unstubAllEnvs();
  });

  /*
    The regression this guards: alert evaluation used to be reachable only from
    FareCollector.runSweep(), which iterates the whole airport catalog and runs for
    hours. Anything that re-couples the two reintroduces a feature that looks wired
    up and never fires.
  */
  test('does not depend on the fare collector module', async () => {
    const source = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../../../server/jobs/alertEvaluator.js', import.meta.url), 'utf8')
    );

    expect(source).not.toContain('fareCollector');
  });
});
