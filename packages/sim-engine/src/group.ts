import { FAIR_PLAY_DEDUCTIONS, type GroupStandingRow, type SimMatchResult } from '@fifa/shared';
import type { Rng } from './rng';

export interface GroupMatchRecord {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  /** fair-play deduction points accumulated in this match (negative values) */
  fairPlayHome: number;
  fairPlayAway: number;
}

export function fairPlayPoints(result: SimMatchResult, side: 'home' | 'away'): number {
  const stats = result.stats[side];
  // second yellows are counted inside yellowCards+redCards by the match sim;
  // approximate per FIFA scale: yellows -1, reds -4 (covers both red types)
  return stats.yellowCards * FAIR_PLAY_DEDUCTIONS.yellow + stats.redCards * (FAIR_PLAY_DEDUCTIONS.directRed + 1);
}

interface TallyRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  fairPlayPoints: number;
}

/**
 * FIFA 2026 group ranking (regulations art. 13):
 * 1. points  2. goal difference  3. goals scored
 * 4. head-to-head points among tied teams  5. h2h GD  6. h2h GF
 * 7. fair play points  8. drawing of lots.
 */
export function computeStandings(
  teams: string[],
  matches: GroupMatchRecord[],
  rng: Rng,
): GroupStandingRow[] {
  const tally = new Map<string, TallyRow>(
    teams.map((t) => [t, {
      team: t, played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, points: 0, fairPlayPoints: 0,
    }]),
  );

  for (const m of matches) {
    const h = tally.get(m.home)!;
    const a = tally.get(m.away)!;
    h.played++; a.played++;
    h.goalsFor += m.homeScore; h.goalsAgainst += m.awayScore;
    a.goalsFor += m.awayScore; a.goalsAgainst += m.homeScore;
    h.fairPlayPoints += m.fairPlayHome;
    a.fairPlayPoints += m.fairPlayAway;
    if (m.homeScore > m.awayScore) { h.won++; a.lost++; h.points += 3; }
    else if (m.homeScore < m.awayScore) { a.won++; h.lost++; a.points += 3; }
    else { h.drawn++; a.drawn++; h.points++; a.points++; }
  }

  const rows = [...tally.values()];

  const compareGlobal = (x: TallyRow, y: TallyRow): number =>
    y.points - x.points ||
    (y.goalsFor - y.goalsAgainst) - (x.goalsFor - x.goalsAgainst) ||
    y.goalsFor - x.goalsFor;

  // group by (points, GD, GF) signature, resolve ties via mini-table
  rows.sort(compareGlobal);
  const ordered: TallyRow[] = [];
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && compareGlobal(rows[i], rows[j]) === 0) j++;
    const tied = rows.slice(i, j);
    if (tied.length > 1) {
      ordered.push(...resolveTie(tied, matches, rng));
    } else {
      ordered.push(tied[0]);
    }
    i = j;
  }

  return ordered.map((r, idx) => ({
    team: r.team,
    played: r.played,
    won: r.won,
    drawn: r.drawn,
    lost: r.lost,
    goalsFor: r.goalsFor,
    goalsAgainst: r.goalsAgainst,
    goalDifference: r.goalsFor - r.goalsAgainst,
    points: r.points,
    fairPlayPoints: r.fairPlayPoints,
    position: idx + 1,
  }));
}

function resolveTie(tied: TallyRow[], matches: GroupMatchRecord[], rng: Rng): TallyRow[] {
  const codes = new Set(tied.map((t) => t.team));
  const mini = new Map<string, { pts: number; gf: number; ga: number }>(
    [...codes].map((c) => [c, { pts: 0, gf: 0, ga: 0 }]),
  );
  for (const m of matches) {
    if (!codes.has(m.home) || !codes.has(m.away)) continue;
    const h = mini.get(m.home)!;
    const a = mini.get(m.away)!;
    h.gf += m.homeScore; h.ga += m.awayScore;
    a.gf += m.awayScore; a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) h.pts += 3;
    else if (m.homeScore < m.awayScore) a.pts += 3;
    else { h.pts++; a.pts++; }
  }
  return [...tied].sort((x, y) => {
    const mx = mini.get(x.team)!;
    const my = mini.get(y.team)!;
    return (
      my.pts - mx.pts ||
      (my.gf - my.ga) - (mx.gf - mx.ga) ||
      my.gf - mx.gf ||
      y.fairPlayPoints - x.fairPlayPoints || // fair play: closer to zero is better (less negative)
      rng() - 0.5 // drawing of lots (seeded => reproducible)
    );
  });
}

/**
 * Ranking of third-placed teams (regulations art. 13.4):
 * points → GD → GF → fair play → drawing of lots.
 */
export function rankThirdPlacedTeams(thirds: GroupStandingRow[], rng: Rng): GroupStandingRow[] {
  return [...thirds].sort(
    (x, y) =>
      y.points - x.points ||
      y.goalDifference - x.goalDifference ||
      y.goalsFor - x.goalsFor ||
      y.fairPlayPoints - x.fairPlayPoints ||
      rng() - 0.5,
  );
}
