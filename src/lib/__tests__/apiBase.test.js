import { describe, test, expect, afterEach, vi } from 'vitest';
import { getApiBase } from '../apiBase.js';

/**
 * getApiBase() picking `http://localhost:3001` unconditionally as its final fallback was
 * a real production incident: the GitHub Actions build ran without the `VITE_API_URL`
 * secret set, so on the deployed roydekel.github.io site every fetch went to
 * `http://localhost:3001` — the VISITOR's own machine, not the Render backend. It only
 * ever looked like it worked when a developer happened to have a local dev server
 * running at the same time, which is exactly what let this ship unnoticed. These tests
 * lock in the fix: a non-localhost hostname must never fall back to localhost.
 */

const setHostname = (hostname) => {
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: { hostname }
  });
};

describe('getApiBase', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('prefers VITE_API_URL when the build was given one', () => {
    vi.stubEnv('VITE_API_URL', 'https://flight-tracker-backend-8bxt.onrender.com');
    setHostname('roydekel.github.io');

    expect(getApiBase()).toBe('https://flight-tracker-backend-8bxt.onrender.com');
  });

  test('uses the local dev server on localhost, even without VITE_API_URL', () => {
    vi.stubEnv('VITE_API_URL', '');
    setHostname('localhost');

    expect(getApiBase()).toBe('http://localhost:3001');
  });

  test('uses the local dev server on 127.0.0.1, even without VITE_API_URL', () => {
    vi.stubEnv('VITE_API_URL', '');
    setHostname('127.0.0.1');

    expect(getApiBase()).toBe('http://localhost:3001');
  });

  test('REGRESSION: a real deployed host with no VITE_API_URL must not fall back to localhost', () => {
    vi.stubEnv('VITE_API_URL', '');
    setHostname('roydekel.github.io');

    const base = getApiBase();

    expect(base).not.toContain('localhost');
    expect(base).not.toContain('127.0.0.1');
    expect(base).toBe('https://flight-tracker-backend-8bxt.onrender.com');
  });

  test('VITE_API_URL wins even on localhost, so a developer can still point dev at production', () => {
    vi.stubEnv('VITE_API_URL', 'https://flight-tracker-backend-8bxt.onrender.com');
    setHostname('localhost');

    expect(getApiBase()).toBe('https://flight-tracker-backend-8bxt.onrender.com');
  });
});
