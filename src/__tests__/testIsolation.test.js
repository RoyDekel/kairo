import { describe, test, expect, vi } from 'vitest';
import { supabase } from '../lib/supabaseClient';
import * as dataService from '../lib/dataService';

/**
 * Guards the test environment itself.
 *
 * The suite used to authenticate against the real Supabase project and call the live
 * Ticketmaster API on every run. Nothing failed, so nothing flagged it — the tests were
 * green while writing to production and depending on the machine's network.
 *
 * These assertions exist so that reintroducing production access breaks the build
 * instead of going unnoticed.
 */
describe('test environment isolation', () => {
  test('the Supabase client is stubbed out', () => {
    expect(supabase).toBeNull();
  });

  test('dataService falls back to localStorage instead of the network', async () => {
    const flight = { id: 'ISO-1', price: 100, origin: 'TLV', destination: 'KRK' };

    // A userId is supplied deliberately: before isolation this was the exact path that
    // produced "invalid input syntax for type uuid: test-user-123" against production.
    await dataService.saveWatchlistItem('test-user-123', flight);
    const loaded = await dataService.loadWatchlist('test-user-123');

    expect(loaded.map((f) => f.id)).toContain('ISO-1');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('unstubbed network requests reject instead of reaching the internet', async () => {
    await expect(fetch('https://app.ticketmaster.com/discovery/v2/events.json')).rejects.toThrow(
      /Unmocked network request/
    );
  });

  test('the rejection names the URL so the culprit is identifiable', async () => {
    await expect(fetch('https://xcqtmvmomdbepjuyqnog.supabase.co/rest/v1/watchlist')).rejects.toThrow(
      /xcqtmvmomdbepjuyqnog\.supabase\.co/
    );
  });

  test('a test that stubs fetch itself still controls it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mocked: true }) });

    const res = await fetch('https://example.test/anything');
    await expect(res.json()).resolves.toEqual({ mocked: true });
  });

  test('the network guard is restored between tests', async () => {
    // Proves the previous test's stub did not leak into this one.
    await expect(fetch('https://example.test/anything')).rejects.toThrow(/Unmocked network request/);
  });
});
