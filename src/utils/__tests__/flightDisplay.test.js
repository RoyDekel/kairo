import { describe, test, expect } from 'vitest';
import { formatStopsLabel } from '../flightDisplay';

describe('formatStopsLabel — connections say where the stop is', () => {
  test('appends a single layover airport to the stops label', () => {
    expect(formatStopsLabel('1 stop', ['MAD'])).toBe('1 stop · MAD');
  });

  test('lists multiple layover airports in order', () => {
    expect(formatStopsLabel('2 stops', ['MAD', 'LIS'])).toBe('2 stops · MAD, LIS');
  });

  test('returns the bare label when there are no layovers', () => {
    expect(formatStopsLabel('Direct', [])).toBe('Direct');
    expect(formatStopsLabel('Direct', undefined)).toBe('Direct');
    expect(formatStopsLabel('Direct', null)).toBe('Direct');
  });

  test('ignores empty/falsy airport codes rather than printing a dangling separator', () => {
    expect(formatStopsLabel('1 stop', [''])).toBe('1 stop');
    expect(formatStopsLabel('1 stop', [null, 'MAD'])).toBe('1 stop · MAD');
  });

  test('tolerates a missing stops string', () => {
    expect(formatStopsLabel(undefined, ['MAD'])).toBe(' · MAD');
    expect(formatStopsLabel('', [])).toBe('');
  });
});
