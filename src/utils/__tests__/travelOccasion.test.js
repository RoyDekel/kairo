import { describe, test, expect } from 'vitest';
import {
  detectTravelOccasion,
  isMarqueeFixture,
  isDecider,
  matchSignatureEvent
} from '../../../shared/travelOccasion.js';
import { SIGNATURE_EVENTS, MARQUEE_PAIRS, FIXTURE_ALIASES } from '../../../shared/fixtures.js';

/**
 * The travel occasion badge.
 *
 * Two constraints drive these tests:
 *
 * 1. It is a BADGE, not a score. Ordinary trips must produce null, because the value comes
 *    entirely from how rarely it appears. The card already shows a match score and the
 *    verdict shows a confidence percentage; a third number would be noise.
 *
 * 2. Nothing is inferred from a calendar. Every signal must come from an event a provider
 *    actually returned, so KAIRO can never announce a festival it has no evidence for.
 *    The honest failure mode is a missed badge, never a false one.
 */

const evt = (over = {}) => ({
  id: 'e1',
  title: 'Some Concert',
  venue: 'A Venue',
  date: '2026-08-12',
  category: 'music',
  ...over
});

describe('signal detection', () => {
  test('recognises marquee rivalries from explicit teams', () => {
    expect(isMarqueeFixture(evt({ homeTeam: 'FC Barcelona', awayTeam: 'Real Madrid' }))).toBe(true);
    expect(isMarqueeFixture(evt({ homeTeam: 'Bayern Munich', awayTeam: 'Borussia Dortmund' }))).toBe(true);
  });

  test('recognises a marquee rivalry from a nickname title', () => {
    expect(isMarqueeFixture(evt({ title: 'El Clásico' }))).toBe(true);
  });

  test('an ordinary fixture is not marquee', () => {
    expect(isMarqueeFixture(evt({ homeTeam: 'Getafe', awayTeam: 'Cadiz', title: 'Getafe vs Cadiz' }))).toBe(false);
  });

  test('recognises deciders by title', () => {
    expect(isDecider(evt({ title: 'Champions League Final' }))).toBe(true);
    expect(isDecider(evt({ title: 'Monaco Grand Prix' }))).toBe(true);
    expect(isDecider(evt({ title: 'Tuesday Jazz Night' }))).toBe(false);
  });

  test('recognises signature events', () => {
    expect(matchSignatureEvent(evt({ title: 'Oktoberfest 2026' }))).toBe('oktoberfest');
    expect(matchSignatureEvent(evt({ title: 'Primavera Sound Barcelona' }))).toBe('primavera sound');
    expect(matchSignatureEvent(evt({ title: 'Open Mic Night' }))).toBeNull();
  });

  test('the shared tables are well formed', () => {
    expect(SIGNATURE_EVENTS.length).toBeGreaterThan(10);
    expect(MARQUEE_PAIRS.length).toBe(Object.keys(FIXTURE_ALIASES).length);
    for (const pair of MARQUEE_PAIRS) expect(pair).toHaveLength(2);
  });
});

describe('detectTravelOccasion', () => {
  test('returns null for an ordinary trip', () => {
    const result = detectTravelOccasion({
      city: 'Prague',
      events: [evt({ title: 'Jazz Trio at the Cellar' }), evt({ id: 'e2', title: 'Museum Late Opening' })]
    });

    // Most destinations must get nothing at all. That is the point.
    expect(result).toBeNull();
  });

  test('returns null with no events', () => {
    expect(detectTravelOccasion({ city: 'Prague', events: [] })).toBeNull();
    expect(detectTravelOccasion({ city: 'Prague' })).toBeNull();
    expect(detectTravelOccasion({})).toBeNull();
  });

  test('flags an El Clásico weekend as rare, naming the city', () => {
    const result = detectTravelOccasion({
      city: 'Madrid',
      events: [evt({ title: 'El Clásico', category: 'sports' })]
    });

    expect(result.tier).toBe('rare');
    expect(result.reasons).toContain('marquee-fixture');
    expect(result.headline).toContain('Madrid');
    expect(result.headline).toContain('El Clásico');
  });

  test('flags a signature festival as rare', () => {
    const result = detectTravelOccasion({
      city: 'Munich',
      events: [evt({ title: 'Oktoberfest 2026', category: 'festivals' })]
    });

    expect(result.tier).toBe('rare');
    expect(result.reasons).toContain('signature-event');
    expect(result.headline).toContain('Munich');
  });

  /* Roy's own example: a festival and a home match landing in the same trip. */
  test('names two stacked events in one sentence', () => {
    const result = detectTravelOccasion({
      city: 'Munich',
      events: [
        evt({ title: 'Oktoberfest 2026', category: 'festivals' }),
        evt({ id: 'e2', title: 'Bayern Munich vs Borussia Dortmund', homeTeam: 'Bayern Munich', awayTeam: 'Borussia Dortmund', category: 'sports' })
      ]
    });

    expect(result.tier).toBe('rare');
    expect(result.reasons).toContain('stacked');
    expect(result.headline).toContain('Oktoberfest');
    expect(result.headline).toContain('Bayern');
  });

  test('a single decider is notable rather than rare', () => {
    const result = detectTravelOccasion({
      city: 'Monaco',
      events: [evt({ title: 'Monaco Grand Prix', category: 'sports' })]
    });

    expect(result.tier).toBe('notable');
    expect(result.reasons).toContain('decider');
  });

  test('a sold-out major is notable', () => {
    const result = detectTravelOccasion({
      city: 'London',
      events: [evt({ title: 'Stadium Show', isSoldOut: true, eventImpactScore: 96 })]
    });

    expect(result.tier).toBe('notable');
    expect(result.reasons).toContain('sold-out-major');
  });

  test('a sold-out minor event is not flagged', () => {
    const result = detectTravelOccasion({
      city: 'London',
      events: [evt({ title: 'Small Gig', isSoldOut: true, eventImpactScore: 60 })]
    });

    expect(result).toBeNull();
  });

  test('summarises the remainder rather than listing everything', () => {
    const result = detectTravelOccasion({
      city: 'Barcelona',
      events: [
        evt({ title: 'El Clásico', category: 'sports' }),
        evt({ id: 'e2', title: 'Primavera Sound', category: 'music' }),
        evt({ id: 'e3', title: 'Copa del Rey Final', category: 'sports' })
      ]
    });

    expect(result.headline).toMatch(/plus 1 more/);
  });

  test('truncates a very long title instead of overflowing the badge', () => {
    const longTitle = `Oktoberfest ${'x'.repeat(80)}`;
    const result = detectTravelOccasion({ city: 'Munich', events: [evt({ title: longTitle })] });

    expect(result.headline.length).toBeLessThan(120);
    expect(result.headline).toContain('…');
  });

  /*
    The integrity guarantee. Nothing may be claimed without a returned event backing it —
    there is no date table saying "Oktoberfest runs late September", because using one
    would let KAIRO assert a festival it has no evidence is happening.
  */
  test('claims nothing when no event supports it', () => {
    // A trip squarely inside the real Oktoberfest window, but no provider returned it.
    const result = detectTravelOccasion({
      city: 'Munich',
      events: [evt({ title: 'Chamber Music Recital', date: '2026-09-25' })]
    });

    expect(result).toBeNull();
  });

  test('every returned occasion cites the events behind it', () => {
    const result = detectTravelOccasion({
      city: 'Madrid',
      events: [evt({ title: 'El Clásico', category: 'sports' }), evt({ id: 'e2', title: 'Random Talk' })]
    });

    expect(result.events.length).toBeGreaterThan(0);
    // Only the notable ones are cited, not the filler.
    expect(result.events.every((e) => e.title !== 'Random Talk')).toBe(true);
  });
});
