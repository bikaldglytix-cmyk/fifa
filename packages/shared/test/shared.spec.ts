import { describe, expect, it } from 'vitest';
import {
  ageOn,
  clamp,
  fnv1a,
  generateJoinCode,
  mean,
  round,
  stddev,
  wilsonInterval,
} from '../src/utils';
import { computePlayerRating, fantasyPrice, type RatingInput } from '../src/rating';
import { FANTASY_SCORING, PREDICTION_SCORING } from '../src/scoring';

describe('utils', () => {
  it('clamp / round / mean / stddev behave on edges', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(round(1.005, 2)).toBeCloseTo(1.0, 1);
    expect(round(2.345, 1)).toBe(2.3);
    expect(mean([])).toBe(0);
    expect(mean([2, 4])).toBe(3);
    expect(stddev([5])).toBe(0);
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it('ageOn handles birthdays around the boundary', () => {
    expect(ageOn('1998-06-12', '2026-06-11')).toBe(27);
    expect(ageOn('1998-06-12', '2026-06-12')).toBe(28);
  });

  it('wilsonInterval brackets the proportion and tightens with n', () => {
    const small = wilsonInterval(7, 10);
    const large = wilsonInterval(700, 1000);
    expect(small.low).toBeLessThan(0.7);
    expect(small.high).toBeGreaterThan(0.7);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it('fnv1a is deterministic and join codes use the unambiguous alphabet', () => {
    expect(fnv1a('MEX-RSA')).toBe(fnv1a('MEX-RSA'));
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
    let i = 0;
    const seq = [0.0, 0.5, 0.99, 0.25, 0.75, 0.1, 0.9, 0.33];
    const code = generateJoinCode(() => seq[i++ % seq.length]);
    expect(code).toHaveLength(8);
    expect(code).not.toMatch(/[IO01]/); // lookalike characters excluded
  });
});

describe('player rating model', () => {
  // mid-band fixture: leaves headroom below the 94 clamp so deltas are visible
  const base: RatingInput = { position: 'FW', caps: 25, internationalGoals: 5, age: 27, clubCountry: 'MEX' };

  it('stays inside the documented 45–94 band', () => {
    expect(computePlayerRating({ position: 'GK', caps: 0, internationalGoals: 0, age: 16, clubCountry: null })).toBeGreaterThanOrEqual(45);
    expect(
      computePlayerRating({ position: 'FW', caps: 200, internationalGoals: 130, age: 27, clubCountry: 'ENG', captain: true }),
    ).toBeLessThanOrEqual(94);
  });

  it('more caps and elite scoring raise the rating; age decay lowers it', () => {
    const r = computePlayerRating(base);
    expect(computePlayerRating({ ...base, caps: 120, internationalGoals: 60 })).toBeGreaterThan(r);
    expect(computePlayerRating({ ...base, age: 38 })).toBeLessThan(r);
    expect(computePlayerRating({ ...base, captain: true })).toBeGreaterThan(r);
  });

  it('fantasy price maps the rating band to 4.0–13.5', () => {
    expect(fantasyPrice(45)).toBe(4);
    expect(fantasyPrice(94)).toBe(13.5);
    expect(fantasyPrice(70)).toBeGreaterThan(4);
  });
});

describe('scoring constants', () => {
  it('fantasy goal points reward attack-position scarcity', () => {
    expect(FANTASY_SCORING.goal.GK).toBeGreaterThanOrEqual(FANTASY_SCORING.goal.FW);
    expect(FANTASY_SCORING.goal.DF).toBeGreaterThan(FANTASY_SCORING.goal.FW);
  });

  it('exact score outranks outcome-only predictions', () => {
    expect(PREDICTION_SCORING.exactScore).toBeGreaterThan(PREDICTION_SCORING.correctOutcome);
  });
});
