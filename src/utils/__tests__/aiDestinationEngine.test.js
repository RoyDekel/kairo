import { describe, test, expect } from 'vitest';
import { searchAIDestinations, GLOBAL_EVENTS } from '../aiDestinationEngine';
import { AIRPORTS } from '../flightSimulator';

describe('AI Destination Intelligence Engine', () => {
  test('includes global events catalog with destination associations', () => {
    expect(GLOBAL_EVENTS.length).toBeGreaterThan(5);
    const bcnEvents = GLOBAL_EVENTS.filter((e) => e.destination === 'BCN');
    expect(bcnEvents.length).toBeGreaterThan(0);
  });

  test('searches and ranks destinations by AI match score', () => {
    const results = searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 1500,
      interests: ['music', 'sports']
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('matchScore');
    expect(results[0]).toHaveProperty('aiInsight');
    expect(results[0]).toHaveProperty('matchedEvents');

    // Results should be ordered descending by matchScore
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].matchScore).toBeGreaterThanOrEqual(results[i + 1].matchScore);
    }
  });

  test('respects budget constraint', () => {
    const strictBudgetResults = searchAIDestinations({
      origin: 'TLV',
      departureDate: '2026-08-11',
      returnDate: '2026-08-16',
      maxBudget: 250,
      interests: ['sports']
    });

    strictBudgetResults.forEach((res) => {
      expect(res.roundtripPrice).toBeLessThanOrEqual(250);
    });
  });
});
