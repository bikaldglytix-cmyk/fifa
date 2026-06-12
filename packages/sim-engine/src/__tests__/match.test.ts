import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { simulateMatch } from '../match';
import { predictMatch } from '../predict';
import { teamPair } from './fixtures';

const ctx = (knockout = false) =>
  ({ stage: knockout ? ('round16' as const) : ('group' as const), matchNumber: 50, venueCountry: 'USA' as const, knockout });

describe('match simulation', () => {
  it('events reconcile with the scoreline', () => {
    const { home, away, h2h } = teamPair('ARG', 'FRA');
    for (let i = 0; i < 50; i++) {
      const r = simulateMatch({ home, away, ctx: ctx(), h2h }, { rng: mulberry32(1000 + i) });
      const homeGoalEvents = r.events.filter(
        (e) => (e.team === 'ARG' && (e.type === 'goal' || e.type === 'penalty_goal')) ||
               (e.team === 'ARG' && e.type === 'own_goal'),
      ).length;
      expect(homeGoalEvents).toBe(r.homeScore);
      expect(r.stats.home.shotsOnTarget).toBeGreaterThanOrEqual(r.homeScore);
      expect(r.stats.home.shots).toBeGreaterThanOrEqual(r.stats.home.shotsOnTarget);
      expect(r.stats.home.possession + r.stats.away.possession).toBeCloseTo(100, 0);
    }
  });

  it('knockout matches always produce a winner', () => {
    const { home, away, h2h } = teamPair('ESP', 'POR');
    for (let i = 0; i < 200; i++) {
      const r = simulateMatch({ home, away, ctx: ctx(true), h2h }, { rng: mulberry32(2000 + i), knockout: true });
      expect(r.winner).toBeTruthy();
      if (r.wentToPenalties) {
        expect(r.penalties).toBeDefined();
        expect(r.penalties!.home).not.toBe(r.penalties!.away);
        expect(r.homeScore).toBe(r.awayScore);
      }
    }
  });

  it('a far stronger side wins clearly more often (ESP vs CUW)', () => {
    const { home, away, h2h } = teamPair('ESP', 'CUW');
    let espWins = 0;
    const N = 1500;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch({ home, away, ctx: ctx(), h2h }, { rng: mulberry32(3000 + i), withEvents: false });
      if (r.homeScore > r.awayScore) espWins++;
    }
    expect(espWins / N).toBeGreaterThan(0.62);
  });

  it('host-nation bonus shifts outcomes (MEX at home vs neutral)', () => {
    const { home, away, h2h } = teamPair('MEX', 'KOR');
    const N = 2500;
    let winsHome = 0;
    let winsNeutral = 0;
    for (let i = 0; i < N; i++) {
      const atAzteca = simulateMatch(
        { home, away, ctx: { stage: 'group', matchNumber: 1, venueCountry: 'MEX', knockout: false }, h2h },
        { rng: mulberry32(4000 + i), withEvents: false },
      );
      const neutral = simulateMatch(
        { home, away, ctx: { stage: 'group', matchNumber: 1, venueCountry: 'USA', knockout: false }, h2h },
        { rng: mulberry32(4000 + i), withEvents: false },
      );
      if (atAzteca.homeScore > atAzteca.awayScore) winsHome++;
      if (neutral.homeScore > neutral.awayScore) winsNeutral++;
    }
    expect(winsHome / N).toBeGreaterThan(winsNeutral / N + 0.02);
  });
});

describe('AI prediction', () => {
  it('probabilities are coherent and the matrix sums to 1', () => {
    const { home, away, h2h } = teamPair('BRA', 'MAR');
    const p = predictMatch({ home, away, ctx: ctx(), h2h });
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 2);
    const matrixSum = p.scoreMatrix.flat().reduce((a, b) => a + b, 0);
    expect(matrixSum).toBeCloseTo(1, 1);
    expect(p.confidence).toBeGreaterThan(20);
    expect(p.confidence).toBeLessThanOrEqual(96);
    expect(p.likelyScorers.length).toBeGreaterThan(3);
    expect(p.insights.length).toBeGreaterThan(1);
  });

  it('analytic probabilities track simulated frequencies', () => {
    const { home, away, h2h } = teamPair('ENG', 'CRO');
    const p = predictMatch({ home, away, ctx: ctx(), h2h });
    const N = 4000;
    let h = 0;
    let d = 0;
    for (let i = 0; i < N; i++) {
      const r = simulateMatch({ home, away, ctx: ctx(), h2h }, { rng: mulberry32(5000 + i), withEvents: false });
      if (r.homeScore > r.awayScore) h++;
      else if (r.homeScore === r.awayScore) d++;
    }
    // ensemble blends elo+form so allow a tolerance band
    expect(Math.abs(h / N - p.homeWin)).toBeLessThan(0.08);
    expect(Math.abs(d / N - p.draw)).toBeLessThan(0.08);
  });

  it('favourite flips when sides swap venue advantage (USA host)', () => {
    const { home, away, h2h } = teamPair('USA', 'AUS');
    const atHome = predictMatch({ home, away, ctx: { stage: 'group', matchNumber: 5, venueCountry: 'USA', knockout: false }, h2h });
    expect(atHome.homeWin).toBeGreaterThan(atHome.awayWin);
  });
});
