import { describe, test, expect, vi, afterEach } from 'vitest';
import {
  DEFAULT_DEPARTURE_OFFSET_DAYS,
  getDefaultDepartureDate,
  getDefaultReturnDate,
  createDefaultSearchParams,
  formatDateToYYYYMMDD
} from '../searchDefaults';
import { computeEventDrivenInsights } from '../../../server/services/insightsEngine.js';

/*
  The seed search used to depart TODAY and return tomorrow, as constants frozen at import.
  Late in the day that search found no outbound flights and the dashboard silently kept its
  simulated bundle; a tab left open past midnight searched dates that had already passed.
*/

const localDate = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm);

describe('default search dates', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('depart 16 days out and return the day after', () => {
    const now = localDate(2026, 9, 13);

    expect(getDefaultDepartureDate(now)).toBe('2026-09-29');
    expect(getDefaultReturnDate(now)).toBe('2026-09-30');
  });

  test('roll over month and year boundaries on the local calendar', () => {
    expect(getDefaultDepartureDate(localDate(2026, 12, 20))).toBe('2027-01-05');
    expect(getDefaultReturnDate(localDate(2026, 12, 20))).toBe('2027-01-06');
  });

  test('are computed at call time, not frozen when the module loads', () => {
    vi.useFakeTimers({ toFake: ['Date'] });

    vi.setSystemTime(localDate(2026, 9, 13));
    const first = getDefaultDepartureDate();
    vi.setSystemTime(localDate(2026, 9, 14));
    const nextDay = getDefaultDepartureDate();

    expect(first).toBe('2026-09-29');
    expect(nextDay).toBe('2026-09-30');
  });

  // One `now` for both dates, so a call straddling midnight can't split them by two days.
  test('createDefaultSearchParams builds both dates from the clock it is given', () => {
    const params = createDefaultSearchParams(localDate(2026, 9, 13, 23, 59));

    expect(params.departureDate).toBe('2026-09-29');
    expect(params.returnDate).toBe('2026-09-30');
  });

  /*
    The offset exists to keep the default search out of the server's "≤14 days → BUY_NOW"
    rule. Checked at the worst moment for this timezone — one minute before local midnight,
    when the gap to the departure is smallest — through the engine's own day count.
  */
  test('stays clear of the 14-day BUY_NOW rule even just before midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(localDate(2026, 9, 13, 23, 59));

    const insights = computeEventDrivenInsights(
      { id: 'FL-KRK-1', price: 650, destination: 'KRK' },
      { departureDate: getDefaultDepartureDate() },
      []
    );

    expect(DEFAULT_DEPARTURE_OFFSET_DAYS).toBeGreaterThan(14);
    expect(insights.daysToDeparture).toBeGreaterThan(14);
    expect(insights.recommendation).toBe('WAIT');
  });

  test('formatDateToYYYYMMDD still formats in local time', () => {
    expect(formatDateToYYYYMMDD(localDate(2026, 1, 5, 0, 30))).toBe('2026-01-05');
  });
});
