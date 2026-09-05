// @vitest-environment node

import { describe, test, expect, beforeEach } from 'vitest';
import { EventUsageMeter, LookupSource } from '../../../server/services/eventUsageMeter.js';
import { ttlTierFor } from '../../../server/services/eventCache.js';
import { EventSearchService } from '../../../server/services/eventSearchService.js';

/**
 * The meter exists to replace an assumption with a measurement.
 *
 * The TTL ladder was sized against a modelled traveller mix that predicted between 1.1x
 * and 2.1x fewer provider calls, and predicted that the `imminent` tier would then account
 * for ~65% of what remained. Both claims drive the next decision — loosen that tier, or
 * pre-warm from the watchlist — so the numbers this reports have to be trustworthy.
 *
 * Which makes the attribution logic the thing worth testing, not the counting.
 */
describe('EventUsageMeter', () => {
  let clock;
  let meter;
  let lines;

  beforeEach(() => {
    clock = Date.parse('2026-08-01T09:00:00Z');
    lines = [];
    meter = new EventUsageMeter({
      now: () => clock,
      reportEvery: 3,
      logger: { log: (line) => lines.push(line) }
    });
  });

  test('an empty meter reports no hit rate rather than a misleading zero', () => {
    const s = meter.snapshot();
    expect(s.lookups).toBe(0);
    // 0% would read as "the cache never helped", which is a different claim from "nothing
    // has happened yet".
    expect(s.cacheHitRate).toBeNull();
  });

  test('hit rate counts provider calls against total lookups', () => {
    meter.record('far', LookupSource.CACHED);
    meter.record('far', LookupSource.CACHED);
    meter.record('far', LookupSource.CACHED);
    meter.record('far', LookupSource.PROVIDER);

    const s = meter.snapshot();
    expect(s.lookups).toBe(4);
    expect(s.provider).toBe(1);
    expect(s.cacheHitRate).toBe(75);
  });

  /*
    The decision-relevant column. A tier can dominate lookups while costing nothing —
    that is exactly what a working cache looks like — so share must be computed against
    provider calls, never against lookups.
  */
  test('tier share is measured against spend, not against traffic', () => {
    // A busy, fully-cached tier.
    for (let i = 0; i < 20; i++) meter.record('far', LookupSource.CACHED);
    // A quiet tier that actually costs money.
    meter.record('imminent', LookupSource.PROVIDER);
    meter.record('imminent', LookupSource.PROVIDER);
    meter.record('mid', LookupSource.PROVIDER);

    const s = meter.snapshot();
    expect(s.tiers.far.lookups).toBe(20);
    expect(s.tiers.far.shareOfProviderCalls).toBe(0);
    expect(s.tiers.imminent.shareOfProviderCalls).toBeCloseTo(66.7, 1);
    expect(s.tiers.mid.shareOfProviderCalls).toBeCloseTo(33.3, 1);
  });

  test('durable promotions are tracked separately from lookups', () => {
    /*
      They must not inflate the lookup count: warmCache promotes rows BEFORE the lookups
      that read them, so counting a promotion as a lookup would double-count the same
      destination and quietly overstate the hit rate.
    */
    meter.recordDurablePromotions(31);
    meter.record('mid', LookupSource.CACHED);

    const s = meter.snapshot();
    expect(s.durablePromotions).toBe(31);
    expect(s.lookups).toBe(1);
  });

  test('promotions ignore nonsense rather than corrupting the count', () => {
    meter.recordDurablePromotions(0);
    meter.recordDurablePromotions(-5);
    meter.recordDurablePromotions(undefined);
    expect(meter.snapshot().durablePromotions).toBe(0);
  });

  test('an unknown source is ignored, not counted as a lookup', () => {
    meter.record('far', 'guessed');
    expect(meter.snapshot().lookups).toBe(0);
  });

  test('reporting is driven by provider calls, so an idle instance stays silent', () => {
    for (let i = 0; i < 10; i++) meter.record('far', LookupSource.CACHED);
    expect(lines).toHaveLength(0);

    meter.record('mid', LookupSource.PROVIDER);
    meter.record('mid', LookupSource.PROVIDER);
    expect(lines).toHaveLength(0);

    meter.record('mid', LookupSource.PROVIDER); // third — reportEvery is 3 here
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('provider calls');
  });

  /*
    Counters reset on the provider's clock, not the server's. A meter rolling on a
    different boundary than the quota it explains would attribute the morning's calls to
    yesterday's ceiling.
  */
  test('counters roll at the UTC day boundary', () => {
    meter.record('far', LookupSource.PROVIDER);
    expect(meter.snapshot().provider).toBe(1);

    clock = Date.parse('2026-08-02T00:30:00Z');

    const s = meter.snapshot();
    expect(s.day).toBe('2026-08-02');
    expect(s.provider).toBe(0);
    expect(s.lookups).toBe(0);
  });
});

/*
  Wiring. The counters above are only worth anything if the service feeds them the truth,
  and the failure mode is silent: a lookup attributed to the wrong column still produces a
  confident-looking percentage.
*/
describe('EventSearchService attribution', () => {
  /*
    Offset from the real clock, not a fixed calendar date: `EventSearchService.fetchEvents`
    classifies the tier via `ttlTierFor(startDate)` using the real `Date.now()` (it has no
    injectable clock, unlike the meter below), so a hardcoded date drifts across tier
    boundaries as real time passes and the test breaks on a lag, not on a code change. 60
    days out is comfortably past the `far` tier's >=30-day threshold for as long as this
    suite exists.
  */
  const daysFromNow = (offsetDays) =>
    new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const window = { start: daysFromNow(60), end: daysFromNow(64) }; // far tier
  let meter;

  const makeService = (cache) => new EventSearchService({
    providers: [{
      isConfigured: () => true,
      fetchEvents: async () => ({ status: 'ok', events: [{ title: 'Clasico' }] })
    }],
    cache,
    mergeEvents: (lists) => lists.flat(),
    usageMeter: meter
  });

  beforeEach(() => {
    meter = new EventUsageMeter({ now: () => Date.parse('2026-08-01T00:00:00Z'), reportEvery: 1000 });
  });

  test('a cache miss is charged to the provider column, on the right tier', async () => {
    const service = makeService({ get: async () => null, set: async (_k, v) => v });

    await service.fetchEvents('BCN', window.start, window.end);

    const s = meter.snapshot();
    expect(s.provider).toBe(1);
    expect(s.cached).toBe(0);
    expect(s.tiers.far.provider).toBe(1);
  });

  test('a cache hit is never charged to the provider column', async () => {
    const service = makeService({
      get: async () => ({ status: 'ok', events: [] }),
      set: async (_k, v) => v
    });

    await service.fetchEvents('BCN', window.start, window.end);

    const s = meter.snapshot();
    expect(s.provider).toBe(0);
    expect(s.cached).toBe(1);
    expect(s.cacheHitRate).toBe(100);
  });

  /*
    An airport with no catalog entry returns early, before any cache or provider work. It
    must not appear as a lookup at all — counting it as a cache hit would inflate the hit
    rate with requests that never had anything to hit.
  */
  test('an unmapped airport is not counted as a lookup', async () => {
    const service = makeService({ get: async () => null, set: async (_k, v) => v });

    await service.fetchEvents('ZZZZ', window.start, window.end);

    expect(meter.snapshot().lookups).toBe(0);
  });

  test('warmCache credits the durable tier for what it promoted', async () => {
    const service = makeService({
      get: async () => null,
      set: async (_k, v) => v,
      prefetch: async (keys) => keys.length
    });

    await service.warmCache(['BCN', 'FCO', 'ATH'], window.start, window.end);

    expect(meter.snapshot().durablePromotions).toBe(3);
  });
});

/*
  The meter names tiers using ttlTierFor, so a boundary change moves the TTL and the
  attribution together. If these two ever drift, the measurement keeps reporting against
  thresholds the cache no longer uses — and reports it convincingly.
*/
describe('tier attribution tracks the TTL ladder', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');

  test.each([
    ['2026-08-02', 'imminent'],
    ['2026-08-04', 'near'],
    ['2026-08-15', 'mid'],
    ['2026-10-01', 'far'],
    [undefined, 'unknown']
  ])('%s falls on the %s tier', (startDate, expected) => {
    expect(ttlTierFor(startDate, { now })).toBe(expected);
  });
});
