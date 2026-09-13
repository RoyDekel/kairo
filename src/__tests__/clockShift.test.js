/**
 * @vitest-environment node
 */
import { describe, test, expect, inject } from 'vitest';

/*
  Proves the clock-shift job actually shifts the clock.

  If src/setupClockShift.js ever stopped taking effect — a Vitest change, a setup-order
  change, something reinstalling Date — every test would simply run on the real date, and
  the job would stay green forever while checking nothing. This measures Date against
  performance.timeOrigin + performance.now(), a real-time source the shim does not touch.

  Under a plain `npm test` nothing is provided, so the same assertions pin the opposite:
  the everyday suite runs on the real clock.
*/
const days = inject('clockShiftDays') ?? 0;
const expectedOffset = days * 86400000;
const realNow = () => performance.timeOrigin + performance.now();
const TOLERANCE_MS = 60_000;

describe('clock shift', () => {
  test('Date.now() is offset by exactly the configured number of days', () => {
    expect(Math.abs(Date.now() - realNow() - expectedOffset)).toBeLessThan(TOLERANCE_MS);
  });

  test('new Date() is shifted the same way', () => {
    expect(Math.abs(new Date().getTime() - realNow() - expectedOffset)).toBeLessThan(TOLERANCE_MS);
  });

  test('explicit dates are left alone', () => {
    expect(new Date('2026-09-20T00:00:00Z').toISOString()).toBe('2026-09-20T00:00:00.000Z');
    expect(new Date(0).getTime()).toBe(0);
  });

  test('Date keeps behaving like the built-in', () => {
    expect(typeof Date()).toBe('string');
    expect(new Date()).toBeInstanceOf(Date);
    expect(Date.name).toBe('Date');
    expect(Date.UTC(2026, 0, 1)).toBe(1767225600000);
  });
});
