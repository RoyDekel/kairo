import { describe, it, expect } from 'vitest';
import {
  destinationFareVerdict,
  BUY_PERCENTILE_CEILING,
  VERDICT_BUY,
  VERDICT_WAIT
} from '../destinationFareVerdict';
import { MIN_HISTORY_OBSERVATIONS } from '../destinationMatchScore';

const wellObserved = { historicalSampleSize: 40, roundtripPrice: 743 };

describe('destinationFareVerdict', () => {
  /*
    The regression that started this. The card called the flight engine with an object
    carrying no `insights`, got the "no history" stub back, and `null === 'WAIT'` made
    every card on the page read "Buy now" forever. These two tests would have caught it.
  */
  it('does not default to Buy when there is nothing to go on', () => {
    const verdict = destinationFareVerdict({});
    expect(verdict.verdict).toBeNull();
    expect(verdict.tone).toBe('neutral');
    expect(verdict.label).not.toMatch(/buy/i);
  });

  it('can actually return Wait', () => {
    const verdict = destinationFareVerdict({ ...wellObserved, historicalPercentile: 88 });
    expect(verdict.verdict).toBe(VERDICT_WAIT);
    expect(verdict.tone).toBe('wait');
  });

  it('calls a fare in the bottom of its own range a Buy', () => {
    const verdict = destinationFareVerdict({ ...wellObserved, historicalPercentile: 8 });
    expect(verdict.verdict).toBe(VERDICT_BUY);
    expect(verdict.tone).toBe('buy');
    expect(verdict.detail).toContain('92%');
    expect(verdict.detail).toContain('40');
  });

  it('treats the ceiling as inclusive and one point past it as Wait', () => {
    expect(
      destinationFareVerdict({ ...wellObserved, historicalPercentile: BUY_PERCENTILE_CEILING }).verdict
    ).toBe(VERDICT_BUY);
    expect(
      destinationFareVerdict({ ...wellObserved, historicalPercentile: BUY_PERCENTILE_CEILING + 1 }).verdict
    ).toBe(VERDICT_WAIT);
  });

  describe('the history gate', () => {
    it('withholds a verdict below the observation threshold, however cheap the fare looks', () => {
      const verdict = destinationFareVerdict({
        roundtripPrice: 743,
        historicalPercentile: 1,
        historicalSampleSize: MIN_HISTORY_OBSERVATIONS - 1
      });
      expect(verdict.verdict).toBeNull();
      expect(verdict.detail).toBe(`${MIN_HISTORY_OBSERVATIONS - 1} of ${MIN_HISTORY_OBSERVATIONS} fares recorded for this route`);
    });

    it('gives a verdict exactly at the threshold', () => {
      const verdict = destinationFareVerdict({
        roundtripPrice: 743,
        historicalPercentile: 10,
        historicalSampleSize: MIN_HISTORY_OBSERVATIONS
      });
      expect(verdict.verdict).toBe(VERDICT_BUY);
    });

    it('withholds a verdict when the sample is large but the percentile is unknown', () => {
      expect(
        destinationFareVerdict({ roundtripPrice: 743, historicalPercentile: null, historicalSampleSize: 200 }).verdict
      ).toBeNull();
    });
  });

  describe('no rendered value is ever empty or undefined', () => {
    /*
      The visible half of the bug: the JSX read `${verdict}` as a literal "$" followed by
      an expression, so an undefined number rendered as "near the 90-day low of $" — a
      sentence that stops mid-claim. Every string this function returns must survive being
      dropped into the DOM as-is.
    */
    const cases = [
      ['nothing at all', {}],
      ['thin history', { roundtripPrice: 500, historicalPercentile: 4, historicalSampleSize: 2 }],
      ['buy', { ...wellObserved, historicalPercentile: 5 }],
      ['wait with a baseline', { ...wellObserved, historicalPercentile: 90, typicalPrice: 600 }],
      ['wait with no baseline', { ...wellObserved, historicalPercentile: 90, typicalPrice: null }],
      ['undefined price', { historicalPercentile: 90, historicalSampleSize: 12 }]
    ];

    it.each(cases)('%s', (_name, input) => {
      const verdict = destinationFareVerdict(input);
      for (const field of ['label', 'detail', 'tooltip']) {
        expect(typeof verdict[field]).toBe('string');
        expect(verdict[field].length).toBeGreaterThan(0);
        expect(verdict[field]).not.toMatch(/undefined|null|NaN/);
        // No "$" left dangling before a space, a comma, or the end of the string.
        expect(verdict[field]).not.toMatch(/\$(?=\s|,|\.|$)/);
      }
    });
  });

  describe('the wait detail', () => {
    it('quotes the gap to the usual fare when the fare is above it', () => {
      const verdict = destinationFareVerdict({
        roundtripPrice: 800,
        historicalPercentile: 90,
        historicalSampleSize: 30,
        typicalPrice: 600
      });
      expect(verdict.detail).toBe('$200 above the $600 usual for this route');
    });

    it('falls back to the percentile rather than inventing a gap', () => {
      const verdict = destinationFareVerdict({
        roundtripPrice: 800,
        historicalPercentile: 90,
        historicalSampleSize: 30,
        typicalPrice: 900 // above the fare, so there is no gap to report
      });
      expect(verdict.detail).toBe('pricier than 90% of the 30 fares recorded here');
    });

    it('never promises a drop by a date it cannot forecast', () => {
      const verdict = destinationFareVerdict({ ...wellObserved, historicalPercentile: 95, typicalPrice: 600 });
      expect(verdict.detail).not.toMatch(/day|week|expected|forecast/i);
      expect(verdict.tooltip).not.toMatch(/\bdays\b/i);
    });
  });

  describe('estimated fares', () => {
    it('discloses that the input was an estimate', () => {
      const verdict = destinationFareVerdict({
        ...wellObserved,
        historicalPercentile: 5,
        priceSource: 'estimate'
      });
      expect(verdict.tooltip).toMatch(/estimated fare/i);
    });

    it('says nothing about estimates for a live quote', () => {
      const verdict = destinationFareVerdict({
        ...wellObserved,
        historicalPercentile: 5,
        priceSource: 'live'
      });
      expect(verdict.tooltip).not.toMatch(/estimated fare/i);
    });
  });

  it('reports the evidence it used, so the caller can show its work', () => {
    const verdict = destinationFareVerdict({ ...wellObserved, historicalPercentile: 12 });
    expect(verdict.sampleSize).toBe(40);
    expect(verdict.percentile).toBe(12);
  });
});
