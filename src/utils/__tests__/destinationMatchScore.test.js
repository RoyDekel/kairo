import { describe, test, expect } from 'vitest';
import {
  scoreDestination,
  fareRankPercentiles,
  savingsAgainstTypical,
  assessConfidence,
  MATCH_WEIGHTS,
  MIN_HISTORY_OBSERVATIONS
} from '../destinationMatchScore';

/**
 * The score this file guards replaced one that could return exactly two values.
 *
 * The old formula benchmarked a fare against `fare * 1.35`, so its price term was fixed at
 * 31.2 for every fare in existence, and awarded an "interest bonus" for events that had
 * already been filtered to those interests. What survived was a step on event count: 81
 * for two or more events, 66 for one. Every test here exists to make that class of defect
 * — a number that cannot respond to its inputs — fail loudly.
 */

const day = (d) => `2026-09-${String(d).padStart(2, '0')}`;

const events = (specs) =>
  specs.map(([category, d], i) => ({ id: `e${i}`, title: `Event ${i}`, category, date: day(d) }));

const base = {
  fareRank: 50,
  historicalPercentile: null,
  historicalSampleSize: 0,
  events: events([['music', 12]]),
  interests: ['music'],
  departureDate: '2026-09-11',
  returnDate: '2026-09-18',
  priceSource: 'estimate',
  coverage: 'ticketed-only'
};

const score = (overrides) => scoreDestination({ ...base, ...overrides }).score;

describe('scoreDestination responds to its inputs', () => {
  /*
    THE regression test. Sweep the realistic input space and count distinct outputs; the
    old implementation would produce 2 here.
  */
  test('produces a wide spread of scores across realistic inputs, not a constant', () => {
    const seen = new Set();

    for (const fareRank of [0, 25, 50, 75, 100]) {
      for (const count of [1, 2, 3, 5, 9]) {
        for (const spreadDays of [1, 2, 4]) {
          for (const interests of [['music'], ['music', 'sports'], ['music', 'sports', 'festivals']]) {
            const evts = Array.from({ length: count }, (_, i) => ({
              id: `e${i}`,
              title: `E${i}`,
              category: ['music', 'sports', 'festivals'][i % 3],
              date: day(12 + (i % spreadDays))
            }));
            seen.add(score({ fareRank, events: evts, interests }));
          }
        }
      }
    }

    expect(seen.size).toBeGreaterThan(20);
  });

  test('a cheaper destination outranks an identical dearer one', () => {
    expect(score({ fareRank: 100 })).toBeGreaterThan(score({ fareRank: 0 }));
  });

  test('the fare component is worth exactly its weight, no more', () => {
    const spread = score({ fareRank: 100 }) - score({ fareRank: 0 });
    expect(spread).toBe(MATCH_WEIGHTS.fare);
  });
});

describe('the fare component uses real history when there is enough of it', () => {
  const cheapForTheRoute = { historicalPercentile: 5, historicalSampleSize: 40 };
  const dearForTheRoute = { historicalPercentile: 95, historicalSampleSize: 40 };

  test('a fare cheap for its own route beats one that is dear for its route', () => {
    expect(score(cheapForTheRoute)).toBeGreaterThan(score(dearForTheRoute));
  });

  /*
    A percentile drawn from four observations describes the sample, not the market. Acting
    on it would reintroduce a confident number with nothing behind it.
  */
  test('a percentile from too few observations is ignored', () => {
    const thin = { historicalPercentile: 5, historicalSampleSize: MIN_HISTORY_OBSERVATIONS - 1 };
    expect(score(thin)).toBe(score({ historicalPercentile: null, historicalSampleSize: 0 }));
  });

  test('history outweighs, but does not erase, the in-search ranking', () => {
    const cheapHereDearThere = score({ fareRank: 100, ...dearForTheRoute });
    const dearHereCheapThere = score({ fareRank: 0, ...cheapForTheRoute });

    expect(dearHereCheapThere).toBeGreaterThan(cheapHereDearThere);
    expect(score({ fareRank: 100, ...cheapForTheRoute })).toBeGreaterThan(dearHereCheapThere);
  });

  test('the detail line names the evidence rather than asserting a saving', () => {
    const withHistory = scoreDestination({ ...base, historicalPercentile: 20, historicalSampleSize: 30 });
    const without = scoreDestination(base);

    expect(withHistory.components[0].detail).toContain('30 fares');
    expect(without.components[0].detail).toContain('no route history yet');
  });
});

describe('interests are measured as coverage, not as a bonus for existing', () => {
  /*
    The old interestBonus asked "do any matched events match an interest?" — after the list
    had been filtered to matching events. It could only answer yes.
  */
  test('covering three of three interests beats covering one of three', () => {
    const allThree = events([['music', 12], ['sports', 13], ['festivals', 14]]);
    const onlyMusic = events([['music', 12], ['music', 13], ['music', 14]]);
    const interests = ['music', 'sports', 'festivals'];

    expect(score({ events: allThree, interests })).toBeGreaterThan(score({ events: onlyMusic, interests }));
  });

  test('with no interests selected it falls back to breadth of categories', () => {
    const broad = events([['music', 12], ['sports', 13], ['festivals', 14], ['culture', 15]]);
    const narrow = events([['music', 12], ['music', 13], ['music', 14], ['music', 15]]);

    expect(score({ events: broad, interests: [] })).toBeGreaterThan(score({ events: narrow, interests: [] }));
  });
});

describe('depth and spread are separate questions', () => {
  test('more events on the same day still beat a single event', () => {
    const one = events([['music', 12]]);
    const five = events([['music', 12], ['music', 12], ['music', 12], ['music', 12], ['music', 12]]);

    expect(score({ events: five })).toBeGreaterThan(score({ events: one }));
  });

  /*
    Four things to do on four evenings is a better trip than four things on one evening,
    and a score that cannot tell them apart is not describing the trip.
  */
  test('the same number of events spread across the trip beats them all on one night', () => {
    const oneNight = events([['music', 12], ['music', 12], ['music', 12], ['music', 12]]);
    const fourNights = events([['music', 12], ['music', 13], ['music', 14], ['music', 15]]);

    expect(score({ events: fourNights })).toBeGreaterThan(score({ events: oneNight }));
  });
});

describe('confidence is reported beside the score, not blended into it', () => {
  test('a live fare with full coverage and real history is high confidence', () => {
    expect(assessConfidence({ priceSource: 'live', coverage: 'full', hasHistory: true }).level).toBe('high');
  });

  test('each missing piece of evidence is named', () => {
    const { level, gaps } = assessConfidence({ priceSource: 'estimate', coverage: 'ticketed-only', hasHistory: false });

    expect(level).toBe('low');
    expect(gaps).toHaveLength(3);
    expect(gaps.join(' ')).toContain('modelled');
  });

  test('thin evidence does not silently deflate the score', () => {
    const strong = scoreDestination({ ...base, priceSource: 'live', coverage: 'full' });
    const weak = scoreDestination({ ...base, priceSource: 'estimate', coverage: 'ticketed-only' });

    expect(strong.score).toBe(weak.score);
    expect(strong.confidence.level).not.toBe(weak.confidence.level);
  });
});

describe('fareRankPercentiles', () => {
  test('the cheapest scores 100 and the dearest 0', () => {
    const ranks = fareRankPercentiles([300, 500, 900]);
    expect(ranks.get(300)).toBe(100);
    expect(ranks.get(900)).toBe(0);
  });

  test('identical fares share a rank rather than being split by array order', () => {
    const ranks = fareRankPercentiles([400, 400, 800]);
    expect(ranks.get(400)).toBe(100);
  });

  /*
    When every route costs the same the ranking carries no information. Awarding everyone
    100 would dress that absence up as universal good news.
  */
  test('an entirely flat price list scores neutral, not perfect', () => {
    expect(fareRankPercentiles([500, 500, 500]).get(500)).toBe(50);
  });
});

describe('savingsAgainstTypical', () => {
  test('is null without enough recorded fares to have a baseline', () => {
    expect(savingsAgainstTypical(400, 600, MIN_HISTORY_OBSERVATIONS - 1)).toBeNull();
  });

  test('is null when the fare is not actually below the typical price', () => {
    expect(savingsAgainstTypical(700, 600, 30)).toBeNull();
  });

  test('reports the real gap when there is one', () => {
    expect(savingsAgainstTypical(450, 600, 30)).toMatchObject({
      typicalPrice: 600,
      savingsAmount: 150,
      savingsPercent: 25
    });
  });
});
