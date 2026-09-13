import { render, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import App from '../App';

vi.mock('../contexts/authContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123', email: 'test@example.com' },
    isAuthenticated: true,
    signOut: vi.fn(),
  }),
}));

/*
  The search App runs on sign-in used today → tomorrow, from constants frozen when the
  module was imported. flight_search_cache showed what that did: evening sign-ins found
  no outbound flights left that day, and a tab left open searched departures that had
  already passed.

  The clock is moved AFTER App was imported, so dates frozen at import time would be
  caught here: they would still describe the real today, not the clock below.
*/
describe('sign-in search dates', () => {
  let searchUrls;

  beforeEach(() => {
    searchUrls = [];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2031, 2, 10, 21, 30)); // 10 Mar 2031, 21:30 local

    vi.stubGlobal('fetch', vi.fn((url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname.endsWith('/api/flights')) searchUrls.push(parsed);
      return Promise.reject(new Error('offline in test'));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('departs 16 days from the current clock and returns the day after', async () => {
    render(<App />);

    await waitFor(() => expect(searchUrls.length).toBeGreaterThan(0));
    const [search] = searchUrls;

    expect(search.searchParams.get('origin')).toBe('TLV');
    expect(search.searchParams.get('destination')).toBe('KRK');
    expect(search.searchParams.get('departureDate')).toBe('2031-03-26');
    expect(search.searchParams.get('returnDate')).toBe('2031-03-27');
  });
});
