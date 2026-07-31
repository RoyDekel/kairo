import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { TicketmasterProvider } from '../../../server/providers/ticketmasterProvider.js';
import { ApiSportsProvider } from '../../../server/providers/apiSportsProvider.js';
import { EventCache } from '../../../server/services/eventCache.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';
import { buildVerdictEvidence } from '../verdictEvidence.js';

/**
 * Running on Ticketmaster alone.
 *
 * With the API-Sports account suspended, the only active source is a ticketing channel.
 * That is a legitimate degraded mode, but it changes what KAIRO is entitled to claim:
 * Ticketmaster can only see events sold through Ticketmaster, and European club football
 * is sold by the clubs. A sold-out derby is therefore invisible.
 *
 * The danger is not the missing event. It is the app filling the silence with a confident
 * negative — arguing "nothing is competing for seats, so wait" at the exact moment the
 * stadium across town is full.
 */

const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });

const flight = { destination: 'BCN', price: 420, airline: 'LY' };

const insightWith = (extra) => ({
  currentPrice: 420,
  topEvent: { title: 'A club night', venue: 'Sala Apolo', eventImpactScore: 40 },
  ...extra
});

describe('the kill switch is separate from the credential', () => {
  const saved = process.env.APISPORTS_DISABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.APISPORTS_DISABLED;
    else process.env.APISPORTS_DISABLED = saved;
  });

  /*
    The key stays in .env and in Render while the account is suspended, so reinstatement is
    one variable rather than a hunt for a credential deleted weeks earlier.
  */
  test('a valid key is not enough when the provider is switched off', () => {
    process.env.APISPORTS_DISABLED = '1';
    expect(new ApiSportsProvider({ apiKey: 'a-real-key' }).isConfigured()).toBe(false);
  });

  test('clearing the switch brings it straight back', () => {
    delete process.env.APISPORTS_DISABLED;
    expect(new ApiSportsProvider({ apiKey: 'a-real-key' }).isConfigured()).toBe(true);
  });

  test('the switch does not resurrect a provider that has no key', () => {
    delete process.env.APISPORTS_DISABLED;
    expect(new ApiSportsProvider({ apiKey: '' }).isConfigured()).toBe(false);
  });
});

describe('the service reports what it can actually see', () => {
  let warn;
  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  test('Ticketmaster alone is not coverage', () => {
    const service = new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey: 'k', limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    expect(service.hasCoverage).toBe(false);
    expect(warn.mock.calls.flat().join(' ')).toContain('No coverage provider configured');
  });

  test('adding the fixtures provider restores coverage', () => {
    const service = new EventSearchService({
      providers: [
        new TicketmasterProvider({ apiKey: 'k', limiter: instant() }),
        new ApiSportsProvider({ apiKey: 'k', limiter: instant() })
      ],
      cache: new EventCache({ ttlMs: 1000 })
    });

    expect(service.hasCoverage).toBe(true);
  });

  test('simulated events are never mistaken for coverage', () => {
    const service = new EventSearchService({
      providers: [new TicketmasterProvider({ apiKey: '', limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    expect(service.hasCoverage).toBe(false);
  });
});

describe('the verdict does not argue from what it cannot see', () => {
  /*
    THE CASE THIS EXISTS FOR.

    Ticketed-only coverage found nothing big. Previously that produced a 'wait' argument
    headlined "No major event competing for seats" — a confident negative drawn from a
    source that could not have revealed a competitor.
  */
  test('partial coverage never produces a wait argument from absence', () => {
    const evidence = buildVerdictEvidence({
      flight,
      insight: insightWith({ eventCoverage: 'ticketed-only' }),
      departureDate: '2026-09-15'
    });

    const item = evidence.find((e) => e.id.startsWith('event-quiet'));
    expect(item.direction).not.toBe('wait');
    expect(item.direction).toBe('neutral');
  });

  test('the claim is narrowed to what was actually checked', () => {
    const evidence = buildVerdictEvidence({
      flight,
      insight: insightWith({ eventCoverage: 'ticketed-only' }),
      departureDate: '2026-09-15'
    });

    const item = evidence.find((e) => e.id.startsWith('event-quiet'));
    expect(item.headline).toContain('ticketed');
    // And it says so, rather than leaving the reader to infer completeness.
    expect(item.detail).toContain("aren't visible");
  });

  test('with full coverage the original argument is unchanged', () => {
    const evidence = buildVerdictEvidence({
      flight,
      insight: insightWith({ eventCoverage: 'full' }),
      departureDate: '2026-09-15'
    });

    const item = evidence.find((e) => e.id === 'event-quiet');
    expect(item.direction).toBe('wait');
    expect(item.headline).toBe('No major event competing for seats');
  });

  /*
    A high-impact event is a POSITIVE finding: the source did see it, so partial coverage
    does not undermine it. Hedging here would discard a true signal.
  */
  test('a sold-out event still argues to buy, even on partial coverage', () => {
    const evidence = buildVerdictEvidence({
      flight,
      insight: insightWith({
        eventCoverage: 'ticketed-only',
        topEvent: { title: 'A stadium show', venue: 'Camp Nou', eventImpactScore: 95, isSoldOut: true }
      }),
      departureDate: '2026-09-15'
    });

    expect(evidence.find((e) => e.id === 'event-surge').direction).toBe('buy');
  });
});
