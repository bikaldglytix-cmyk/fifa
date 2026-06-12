import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { computeStandings, rankThirdPlacedTeams } from '../group';

const m = (home: string, away: string, hs: number, as: number, fpH = 0, fpA = 0) => ({
  home, away, homeScore: hs, awayScore: as, fairPlayHome: fpH, fairPlayAway: fpA,
});

describe('group standings (FIFA art. 13 tiebreakers)', () => {
  it('orders by points, GD, GF', () => {
    const rows = computeStandings(
      ['AAA', 'BBB', 'CCC', 'DDD'],
      [
        m('AAA', 'BBB', 3, 0),
        m('CCC', 'DDD', 1, 0),
        m('AAA', 'CCC', 1, 1),
        m('BBB', 'DDD', 2, 0),
        m('AAA', 'DDD', 2, 0),
        m('BBB', 'CCC', 0, 1),
      ],
      mulberry32(1),
    );
    expect(rows.map((r) => r.team)).toEqual(['AAA', 'CCC', 'BBB', 'DDD']);
    expect(rows[0].points).toBe(7);
    expect(rows[1].points).toBe(7);
    // AAA GD +5 vs CCC GD +1
    expect(rows[0].goalDifference).toBeGreaterThan(rows[1].goalDifference);
  });

  it('uses head-to-head before fair play when points/GD/GF all level', () => {
    // X and Y both finish 6 pts, GF 3, GA 2, GD +1 — X beat Y directly
    const rows = computeStandings(
      ['XXX', 'YYY', 'ZZZ', 'WWW'],
      [
        m('XXX', 'YYY', 1, 0),
        m('XXX', 'ZZZ', 0, 2),
        m('XXX', 'WWW', 2, 0),
        m('YYY', 'ZZZ', 2, 1),
        m('YYY', 'WWW', 1, 0),
        m('ZZZ', 'WWW', 0, 0),
      ],
      mulberry32(2),
    );
    const x = rows.find((r) => r.team === 'XXX')!;
    const y = rows.find((r) => r.team === 'YYY')!;
    expect(x.points).toBe(y.points);
    expect(x.goalDifference).toBe(y.goalDifference);
    expect(x.goalsFor).toBe(y.goalsFor);
    expect(x.position).toBeLessThan(y.position); // head-to-head: X beat Y
  });

  it('falls back to fair play when h2h is level', () => {
    // P and Q drew their meeting, identical records; P has cleaner card record
    const rows = computeStandings(
      ['PPP', 'QQQ', 'RRR', 'SSS'],
      [
        m('PPP', 'QQQ', 1, 1, -1, -4),
        m('RRR', 'SSS', 1, 0),
        m('PPP', 'RRR', 2, 0),
        m('QQQ', 'SSS', 2, 0),
        m('PPP', 'SSS', 0, 1),
        m('QQQ', 'RRR', 0, 1),
      ],
      mulberry32(3),
    );
    const p = rows.find((r) => r.team === 'PPP')!;
    const q = rows.find((r) => r.team === 'QQQ')!;
    expect(p.points).toBe(q.points);
    expect(p.position).toBeLessThan(q.position);
  });

  it('ranks third-placed teams by points/GD/GF/fair play', () => {
    const thirds = [
      { team: 'AAA', played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 4, goalsAgainst: 3, goalDifference: 1, points: 4, fairPlayPoints: -3, position: 3 },
      { team: 'BBB', played: 3, won: 1, drawn: 1, lost: 1, goalsFor: 3, goalsAgainst: 2, goalDifference: 1, points: 4, fairPlayPoints: -1, position: 3 },
      { team: 'CCC', played: 3, won: 1, drawn: 0, lost: 2, goalsFor: 2, goalsAgainst: 4, goalDifference: -2, points: 3, fairPlayPoints: 0, position: 3 },
    ];
    const ranked = rankThirdPlacedTeams(thirds, mulberry32(4));
    expect(ranked[0].team).toBe('AAA'); // GF 4 > 3
    expect(ranked[1].team).toBe('BBB');
    expect(ranked[2].team).toBe('CCC');
  });
});
