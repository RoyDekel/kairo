import { describe, it, expect, vi } from 'vitest';
import {
  resolveKeepAliveUrl,
  isSelfPingUseless,
  pingOnce,
  startKeepAlive
} from '../../../server/jobs/keepAlive.js';

describe('resolveKeepAliveUrl', () => {
  it('builds the health URL from the variable Render injects', () => {
    expect(resolveKeepAliveUrl({ RENDER_EXTERNAL_URL: 'https://kairo.onrender.com' }))
      .toBe('https://kairo.onrender.com/api/health');
  });

  it('tolerates trailing slashes rather than producing a double-slash URL', () => {
    expect(resolveKeepAliveUrl({ RENDER_EXTERNAL_URL: 'https://kairo.onrender.com//' }))
      .toBe('https://kairo.onrender.com/api/health');
  });

  it('lets an explicit KEEPALIVE_URL override the platform variable', () => {
    expect(resolveKeepAliveUrl({
      KEEPALIVE_URL: 'https://elsewhere.example/health',
      RENDER_EXTERNAL_URL: 'https://kairo.onrender.com'
    })).toBe('https://elsewhere.example/health');
  });

  // RENDER_EXTERNAL_URL is absent at build time and on non-web services, so "no URL" is a
  // routine state and must not be treated as a misconfiguration to throw over.
  it('returns null when neither variable is set', () => {
    expect(resolveKeepAliveUrl({})).toBeNull();
  });
});

describe('isSelfPingUseless', () => {
  it.each(['http://localhost:3001/api/health', 'http://127.0.0.1:3001/api/health'])(
    'rejects loopback (%s), which no idle timer would ever see',
    (url) => expect(isSelfPingUseless(url)).toBe(true)
  );

  it('refuses an unparseable URL rather than pinging something unintended', () => {
    expect(isSelfPingUseless('not-a-url')).toBe(true);
  });

  it('accepts a real public host', () => {
    expect(isSelfPingUseless('https://kairo.onrender.com/api/health')).toBe(false);
  });
});

describe('pingOnce', () => {
  it('reports success on a 2xx', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    await expect(pingOnce('https://x/y', { fetchImpl })).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports failure on a non-2xx without throwing', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    await expect(pingOnce('https://x/y', { fetchImpl })).resolves.toBe(false);
  });

  /*
    The point of the whole module is to keep the process alive. A rejected ping escaping as
    an unhandled rejection would kill it — the precise failure this is meant to prevent.
  */
  it('swallows a thrown network error', async () => {
    const fetchImpl = async () => { throw new Error('ECONNRESET'); };
    await expect(pingOnce('https://x/y', { fetchImpl })).resolves.toBe(false);
  });

  it('aborts a hanging request instead of stalling the interval', async () => {
    const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
    await expect(pingOnce('https://x/y', { fetchImpl, timeoutMs: 20 })).resolves.toBe(false);
  });
});

describe('startKeepAlive', () => {
  it('stays off unless explicitly enabled', () => {
    expect(startKeepAlive({ env: {} })).toBeNull();
  });

  it('declines to start when enabled with no resolvable URL', () => {
    expect(startKeepAlive({ env: { KEEPALIVE_ENABLED: 'true' } })).toBeNull();
  });

  it('declines to start against loopback', () => {
    expect(startKeepAlive({
      env: { KEEPALIVE_ENABLED: 'true', KEEPALIVE_URL: 'http://localhost:3001/api/health' }
    })).toBeNull();
  });

  it('starts against a real host and pings on the interval', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const timer = startKeepAlive({
      env: {
        KEEPALIVE_ENABLED: 'true',
        KEEPALIVE_URL: 'https://kairo.onrender.com/api/health',
        KEEPALIVE_INTERVAL_MS: '60000'
      },
      fetchImpl
    });

    expect(timer).not.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    clearInterval(timer);
    vi.useRealTimers();
  });

  // A sub-minute interval would burn instance-hours and requests for no extra protection:
  // Render's idle window is ~15 minutes wide.
  it('floors the interval at one minute', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }));
    const timer = startKeepAlive({
      env: {
        KEEPALIVE_ENABLED: 'true',
        KEEPALIVE_URL: 'https://kairo.onrender.com/api/health',
        KEEPALIVE_INTERVAL_MS: '100'
      },
      fetchImpl
    });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(fetchImpl).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clearInterval(timer);
    vi.useRealTimers();
  });
});
