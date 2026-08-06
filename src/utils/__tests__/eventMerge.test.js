import { describe, test, expect, vi } from 'vitest';
import {
  compareEvents,
  mergePair,
  mergeEventLists,
  extractTeams,
  normalizeTeam,
  titleOverlap,
  FIXTURE_ALIASES
} from '../../../server/services/eventMerge.js';
import { EventSearchService } from '../../../server/services/eventSearchService.js';
import { EventCache } from '../../../server/services/eventCache.js';
import { RateLimiter } from '../../../server/services/rateLimiter.js';
import { EventProvider } from '../../../server/providers/eventProvider.js';

/**
 * Stage 3: cross-referencing providers.
 *
 * The motivating case: Ticketmaster lists "FC Barcelona vs Real Madrid (El Clásico)" while
 * a fixture database lists home "Barcelona", away "Real Madrid". Those strings share
 * almost nothing. Meanwhile two genuinely different matches in the same city on the same
 * day must not be collapsed.
 *
 * Policy is conservative: a wrong merge deletes a real event and attaches another one's
 * price, whereas a duplicate is merely untidy.
 */

const ticketing = (over = {}) => ({
  id: 'tm-1',
  source: 'ticketmaster',
  title: 'FC Barcelona vs Real Madrid',
  venue: 'Spotify Camp Nou',
  date: '2026-08-12',
  category: 'sports',
  priceEstimate: '$120 - $350',
  url: 'https://ticketmaster.test/e/1',
  isSoldOut: true,
  eventImpactScore: 96,
  isLiveApi: true,
  ...over
});

const fixture = (over = {}) => ({
  id: 'tsdb-1',
  source: 'apisports',
  title: 'Barcelona vs Real Madrid',
  venue: 'Camp Nou',
  date: '2026-08-12',
  category: 'sports',
  league: 'La Liga',
  homeTeam: 'Barcelona',
  awayTeam: 'Real Madrid',
  isLiveApi: true,
  ...over
});

describe('normalisation', () => {
  test('strips accents, punctuation and club noise tokens', () => {
    expect(normalizeTeam('FC Barcelona')).toBe('barcelona');
    expect(normalizeTeam('Atlético Madrid')).toBe('atletico madrid');
    expect(normalizeTeam('A.C. Milan')).toBe('milan');
    // 'Real' is part of the name and must survive.
    expect(normalizeTeam('Real Madrid CF')).toBe('real madrid');
  });

  test('titleOverlap is symmetric and bounded', () => {
    expect(titleOverlap('Barcelona vs Real Madrid', 'Barcelona vs Real Madrid')).toBe(1);
    expect(titleOverlap('a', 'b')).toBe(0);
    expect(titleOverlap('Primavera Sound Festival', 'Primavera Sound')).toBeGreaterThan(0.5);
  });
});

describe('team extraction', () => {
  test('prefers explicit home and away fields', () => {
    expect(extractTeams(fixture())).toEqual(['barcelona', 'real madrid']);
  });

  test('parses a "vs" title', () => {
    expect(extractTeams({ title: 'FC Barcelona vs Real Madrid' })).toEqual(['barcelona', 'real madrid']);
  });

  test('ignores a trailing parenthetical when splitting', () => {
    expect(extractTeams({ title: 'FC Barcelona vs Real Madrid (El Clásico)' })).toEqual([
      'barcelona',
      'real madrid'
    ]);
  });

  /*
    The case Roy raised. A nickname-only title contains no team names, so without the alias
    table it can never match a fixture record.
  */
  test('resolves a nickname-only title through the alias table', () => {
    expect(extractTeams({ title: 'El Clásico' })).toEqual(['barcelona', 'real madrid']);
    expect(extractTeams({ title: 'The North London Derby 2026' })).toEqual(['arsenal', 'tottenham']);
  });

  test('returns nothing for a non-fixture title', () => {
    expect(extractTeams({ title: 'Primavera Sound Festival' })).toEqual([]);
  });

  test('every alias maps to exactly two teams', () => {
    for (const [alias, teams] of Object.entries(FIXTURE_ALIASES)) {
      expect(teams, alias).toHaveLength(2);
    }
  });
});

describe('compareEvents', () => {
  test('a different date never merges, whatever else matches', () => {
    const result = compareEvents(ticketing(), fixture({ date: '2026-08-13' }));
    expect(result.merge).toBe(false);
    expect(result.reason).toBe('different-date');
  });

  test('a missing date never merges', () => {
    expect(compareEvents(ticketing({ date: null }), fixture()).merge).toBe(false);
  });

  test('matching teams on the same date merge with high confidence', () => {
    const result = compareEvents(ticketing(), fixture());
    expect(result).toMatchObject({ merge: true, confidence: 'high', reason: 'both-teams-match' });
  });

  test('El Clásico matches the fixture record', () => {
    const result = compareEvents(ticketing({ title: 'El Clásico' }), fixture());
    expect(result.merge).toBe(true);
    expect(result.reason).toBe('both-teams-match');
  });

  /*
    Two different matches in one city on one day. Merging these would delete a real event
    and show the wrong price for the other — the specific failure the conservative policy
    exists to prevent.
  */
  test('a same-day double-header does NOT collapse', () => {
    const a = ticketing({ title: 'FC Barcelona vs Real Madrid' });
    const b = fixture({ id: 'tsdb-2', homeTeam: 'Espanyol', awayTeam: 'Girona', title: 'Espanyol vs Girona' });

    const result = compareEvents(a, b);
    expect(result.merge).toBe(false);
    expect(result.reason).toBe('teams-differ');
  });

  test('identical titles merge', () => {
    const result = compareEvents(
      { title: 'Primavera Sound', date: '2026-08-12', venue: 'Parc del Fòrum', category: 'music' },
      { title: 'primavera sound', date: '2026-08-12', venue: 'Forum', category: 'music' }
    );
    expect(result).toMatchObject({ merge: true, reason: 'identical-title' });
  });

  test('same venue and category with strong title overlap merges', () => {
    const result = compareEvents(
      { title: 'Primavera Sound Festival Night', date: '2026-08-12', venue: 'Parc del Forum', category: 'music' },
      { title: 'Primavera Sound Festival', date: '2026-08-12', venue: 'Parc del Forum', category: 'music' }
    );
    expect(result.merge).toBe(true);
    expect(result.reason).toBe('venue-category-title');
  });

  test('weak evidence is reported as medium and kept separate', () => {
    const result = compareEvents(
      { title: 'Some Concert', date: '2026-08-12', venue: 'Camp Nou', category: 'music' },
      { title: 'Another Show Entirely', date: '2026-08-12', venue: 'Camp Nou', category: 'music' }
    );
    expect(result.confidence).toBe('medium');
    expect(result.merge).toBe(false);
  });

  test('unrelated events on the same date do not merge', () => {
    const result = compareEvents(
      { title: 'Opera Gala', date: '2026-08-12', venue: 'Liceu', category: 'arts' },
      { title: 'Motocross Grand Prix', date: '2026-08-12', venue: 'Circuit', category: 'sports' }
    );
    expect(result).toMatchObject({ merge: false, confidence: 'none' });
  });
});

describe('mergePair', () => {
  test('the ticketing record wins price, url and sold-out status', () => {
    const merged = mergePair(ticketing(), fixture());

    expect(merged.priceEstimate).toBe('$120 - $350');
    expect(merged.url).toBe('https://ticketmaster.test/e/1');
    expect(merged.isSoldOut).toBe(true);
    expect(merged.eventImpactScore).toBe(96);
  });

  /*
    Order must not matter. If the fixture record were spread last it would blank the
    ticketing fields, silently weakening the buy/wait verdict on exactly the big matches
    that should strengthen it.
  */
  test('argument order does not change the outcome', () => {
    const a = mergePair(ticketing(), fixture());
    const b = mergePair(fixture(), ticketing());

    expect(b.priceEstimate).toBe(a.priceEstimate);
    expect(b.isSoldOut).toBe(a.isSoldOut);
    expect(b.eventImpactScore).toBe(a.eventImpactScore);
    expect(b.league).toBe(a.league);
  });

  test('fixture detail enriches what ticketing cannot describe', () => {
    const merged = mergePair(ticketing(), fixture());

    expect(merged.league).toBe('La Liga');
    expect(merged.homeTeam).toBe('Barcelona');
    expect(merged.awayTeam).toBe('Real Madrid');
  });

  test('records which sources contributed', () => {
    expect(mergePair(ticketing(), fixture()).mergedFrom.sort()).toEqual(['apisports', 'ticketmaster']);
  });

  test('prefers a real venue name over a generic placeholder', () => {
    const merged = mergePair(ticketing({ venue: 'Major Stadium / Arena' }), fixture({ venue: 'Camp Nou' }));
    expect(merged.venue).toBe('Camp Nou');
  });
});

describe('mergeEventLists', () => {
  test('collapses the same match from two providers into one', () => {
    const merged = mergeEventLists([[ticketing()], [fixture()]]);

    expect(merged).toHaveLength(1);
    expect(merged[0].priceEstimate).toBe('$120 - $350');
    expect(merged[0].league).toBe('La Liga');
  });

  test('keeps genuinely different events from both providers', () => {
    const merged = mergeEventLists([
      [ticketing()],
      [fixture({ id: 'tsdb-2', homeTeam: 'Espanyol', awayTeam: 'Girona', title: 'Espanyol vs Girona' })]
    ]);

    expect(merged).toHaveLength(2);
  });

  test('a fixture-only match with no ticketing counterpart survives', () => {
    // The coverage gap this whole integration exists for: club-sold tickets.
    const merged = mergeEventLists([
      [ticketing({ id: 'tm-9', title: 'Some Concert', venue: 'Palau', category: 'music' })],
      [fixture()]
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.some((e) => e.source === 'apisports')).toBe(true);
  });

  test('handles empty input and a single provider', () => {
    expect(mergeEventLists([])).toEqual([]);
    expect(mergeEventLists([[ticketing()]])).toHaveLength(1);
  });

  test('is idempotent when the same list is merged twice', () => {
    const once = mergeEventLists([[ticketing()], [fixture()]]);
    const twice = mergeEventLists([once]);
    expect(twice).toHaveLength(once.length);
  });
});

describe('EventSearchService with two providers', () => {
  const instant = () => new RateLimiter({ limit: 1e9, windowMs: 1, name: 'i' });

  class FakeTicketing extends EventProvider {
    static get key() { return 'ticketmaster'; }
    static get rateLimit() { return { limit: 9, windowMs: 1 }; }
    // Mirrors the real provider: ticketing is enrichment, not coverage.
    static get role() { return 'enrichment'; }
    async fetchEvents() { return this.ok([ticketing()]); }
  }

  class FakeFixtures extends EventProvider {
    static get key() { return 'apisports'; }
    static get rateLimit() { return { limit: 9, windowMs: 1 }; }
    static get role() { return 'coverage'; }
    async fetchEvents() { return this.ok([fixture()]); }
  }

  test('the same match from both providers arrives as one enriched event', async () => {
    const service = new EventSearchService({
      providers: [new FakeTicketing({ limiter: instant() }), new FakeFixtures({ limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    const result = await service.fetchEvents('BCN', '2026-08-11', '2026-08-16');

    expect(result.status).toBe('ok');
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      priceEstimate: '$120 - $350',
      isSoldOut: true,
      league: 'La Liga'
    });
    expect(Object.keys(result.sources).sort()).toEqual(['apisports', 'ticketmaster']);
  });

  /*
    Constructed explicitly rather than from the default provider list.

    The default list reads process.env, so this assertion used to pass or fail depending on
    whether APISPORTS_API_KEY happened to be set on the machine — the same environment
    dependency that once made the Ticketmaster test green for the wrong reason.
  */
  test('warns when only enrichment providers are active', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const service = new EventSearchService({
      providers: [new FakeTicketing({ limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    expect(service.providerKeys).toEqual(['ticketmaster']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No coverage provider'));
    warn.mockRestore();
  });

  test('a coverage provider silences the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new EventSearchService({
      providers: [new FakeFixtures({ limiter: instant() })],
      cache: new EventCache({ ttlMs: 1000 })
    });

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('No coverage provider'));
    warn.mockRestore();
  });
});
