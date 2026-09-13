import { describe, test, expect } from 'vitest';
import { departureDateError } from '../../../server/services/searchDateValidation.js';

/*
  /api/flights accepted any departure date. Past dates still reached the provider, came
  back empty, and were cached as though "no flights" were the answer.
*/

// 2026-09-13 18:30 UTC — an evening search, like the ones found in flight_search_cache.
const NOW = Date.UTC(2026, 8, 13, 18, 30);

describe('departureDateError', () => {
  test('accepts today and future dates', () => {
    expect(departureDateError('2026-09-13', NOW)).toBeNull();
    expect(departureDateError('2026-09-29', NOW)).toBeNull();
    expect(departureDateError('2027-07-30', NOW)).toBeNull();
  });

  // West of UTC the user's local today can be the server's yesterday.
  test("accepts UTC yesterday, which is still today for users west of UTC", () => {
    expect(departureDateError('2026-09-12', NOW)).toBeNull();
  });

  test('rejects dates before that with a readable reason', () => {
    expect(departureDateError('2026-09-11', NOW)).toMatch(/2026-09-11 has already passed/);
    expect(departureDateError('2026-08-20', NOW)).toMatch(/already passed/);
  });

  test('rejects malformed and impossible dates', () => {
    for (const bad of ['', 'tomorrow', '13/09/2026', '2026-9-13', '2026-02-30', '2026-13-01']) {
      expect(departureDateError(bad, NOW)).toMatch(/YYYY-MM-DD/);
    }
    expect(departureDateError(undefined, NOW)).toMatch(/YYYY-MM-DD/);
  });
});
