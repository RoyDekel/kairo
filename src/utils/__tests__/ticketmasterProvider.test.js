import { describe, test, expect, vi } from 'vitest';
import { TicketmasterProvider } from '../../../server/providers/ticketmasterProvider.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';
import { computeEventDrivenInsights } from '../../../server/services/insightsEngine.js';

/**
 * Provider-level tests with an explicit credential state.
 *
 * The suite once constructed the event service bare, which read TICKETMASTER_API_KEY via
 * dotenv. That made results depend on the machine: with a key and network it hit the live
 * API (499ms, 10 real events); without, it returned simulated events (25ms). The test
 * asserted only "some events came back", so it passed either way — while being named after
 * the offline path it often wasn't exercising.
 */
const instantLimiter = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'instant' });

const serviceWithKey = (apiKey) => new TicketmasterProvider({ apiKey, limiter: instantLimiter() });

const BCN = { city: 'Barcelona', country: 'Spain', countryCode: 'ES', lat: 41.29, lon: 2.08 };
const WINDOW = { startDate: '2026-08-10', endDate: '2026-08-20' };

describe('TicketmasterProvider', () => {
  /*
    Simulation is no longer this provider's job. It reports whether it can be called, and
    EventSearchService substitutes SimulatedEventProvider when nothing live is configured —
    covered in eventLocationMapping.test.js. Keeping the concerns separate is what stops a
    live provider's failure from quietly producing fabricated listings.
  */
  test('reports itself unconfigured without a credential', () => {
    expect(serviceWithKey('').isConfigured()).toBe(false);
    expect(serviceWithKey('test-key').isConfigured()).toBe(true);
  });

  test('declares the published Ticketmaster rate limit', () => {
    expect(TicketmasterProvider.rateLimit).toMatchObject({ limit: 5, windowMs: 1000 });
    expect(TicketmasterProvider.key).toBe('ticketmaster');
  });

  test('tags every event with its source provider', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'e1',
              name: 'Some Gig',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'A Venue' }] },
              dates: { start: { localDate: '2026-08-12' } }
            }
          ]
        }
      })
    });

    const { events } = await serviceWithKey('test-key').fetchEvents(BCN, WINDOW, 'BCN');
    expect(events[0].source).toBe('ticketmaster');
    expect(events[0].destination).toBe('BCN');
  });

  /*
    Deliberate change of behaviour.

    An unreachable API used to return simulated events, which meant users saw fabricated
    listings — "El Clásico", "Primavera Sound" — presented exactly like real ones, with no
    indication anything had gone wrong. Reporting UNAVAILABLE lets the UI say it couldn't
    check. The simulated engine is now reserved for a missing credential, i.e. local
    development without a key, where nobody is being misled.
  */
  test('reports unavailable rather than fabricating events when the API is unreachable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));

    const service = serviceWithKey('test-key');
    const result = await service.fetchEvents(BCN, WINDOW, 'BCN');

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
  });

  test('formats live API results and marks them as live', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          events: [
            {
              id: 'tm-live-1',
              name: 'Primavera Sound',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'Parc del Fòrum' }] },
              dates: { start: { localDate: '2026-08-12' }, status: { code: 'soldout' } },
              priceRanges: [{ min: 85, max: 240 }]
            },
            // Duplicate title must collapse to one entry.
            {
              id: 'tm-live-2',
              name: 'Primavera Sound',
              classifications: [{ segment: { name: 'Music' } }],
              _embedded: { venues: [{ name: 'Parc del Fòrum' }] },
              dates: { start: { localDate: '2026-08-13' } },
              priceRanges: [{ min: 85, max: 240 }]
            }
          ]
        }
      })
    });

    const service = serviceWithKey('test-key');
    const events = (await service.fetchEvents(BCN, WINDOW, 'BCN')).events;

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Primavera Sound');
    expect(events[0].venue).toBe('Parc del Fòrum');
    expect(events[0].isLiveApi).toBe(true);
    expect(events[0].isSoldOut).toBe(true);
    expect(events[0].priceEstimate).toBe('$85 - $240');
  });

  /*
    Renamed from "high impact event surge".

    It used to assert that a 96-impact sold-out event produced BUY_NOW, which was the
    fabricated-score override removed in KAI-006 — see the guardrail block in
    insightsEngine.test.js. The event is now context: it is carried through to topEvent and
    named in the summary, while the verdict comes from the fare and the departure window.
    The departure date below is deliberately inside two weeks, so the BUY_NOW asserted here
    is the days-to-departure heuristic's doing, not the event's.
  */
  test('carries a live event through to the insight without letting it set the verdict', () => {
    const soon = new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0];
    const mockFlight = { id: 'FL-BCN-101', price: 520, destination: 'BCN' };
    const mockEvents = [
      {
        id: 'tm-bcn-1',
        destination: 'BCN',
        title: 'El Clásico Match',
        venue: 'Camp Nou',
        categoryLabel: 'Sports ⚽',
        eventImpactScore: 96,
        isSoldOut: true
      }
    ];

    const insights = computeEventDrivenInsights(mockFlight, { departureDate: soon }, mockEvents);

    expect(insights).toBeDefined();
    expect(insights.recommendation).toBe('BUY_NOW');
    expect(insights.riskLevel).toBe('High (Last Minute Spikes)');
    expect(insights.isHighImpactEvent).toBe(true);
    expect(insights.eventImpactScore).toBe(96);
    expect(insights.summary).toContain('El Clásico Match');
    expect(insights.summary).not.toContain('due to event ticket pressure');
  });

  test('recommends WAIT when no event conflict and price is above low 90-day benchmark', () => {
    const mockFlight = { id: 'FL-LHR-202', price: 650, destination: 'LHR' };
    const mockEvents = [
      {
        id: 'tm-lhr-1',
        destination: 'LHR',
        title: 'Small Theater Play',
        venue: 'West End Theater',
        categoryLabel: 'Culture 🎭',
        eventImpactScore: 60,
        isSoldOut: false
      }
    ];

    const insights = computeEventDrivenInsights(mockFlight, { departureDate: '2026-09-20' }, mockEvents);

    expect(insights).toBeDefined();
    expect(insights.recommendation).toBe('WAIT');
    expect(insights.isHighImpactEvent).toBe(false);
  });
});
