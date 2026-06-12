import { describe, expect, it } from 'vitest';
import type { SimMatchResult } from '@fifa/shared';
import { scoreFantasyLineup } from '../fantasy';
import { computeChemistry, computeTacticalFit } from '../chemistry';
import { teamPair } from './fixtures';

const baseStats = {
  goals: 0, possession: 50, shots: 10, shotsOnTarget: 4, xG: 1, corners: 4,
  fouls: 10, yellowCards: 0, redCards: 0, passAccuracy: 80, saves: 0,
};

const mkResult = (over: Partial<SimMatchResult>): SimMatchResult => ({
  home: 'AAA',
  away: 'BBB',
  homeScore: 2,
  awayScore: 0,
  wentToExtraTime: false,
  wentToPenalties: false,
  winner: 'AAA',
  events: [],
  stats: { home: { ...baseStats, goals: 2 }, away: { ...baseStats } },
  manOfTheMatch: null,
  ...over,
});

describe('fantasy scoring', () => {
  it('scores a striker brace with captain doubling', () => {
    const result = mkResult({
      events: [
        { minute: 10, type: 'goal', team: 'AAA', playerId: 9, playerName: 'Nine', assistPlayerId: 10, assistPlayerName: 'Ten' },
        { minute: 60, type: 'goal', team: 'AAA', playerId: 9, playerName: 'Nine' },
      ],
      manOfTheMatch: { playerId: 9, name: 'Nine', team: 'AAA' },
    });
    const { total, lines } = scoreFantasyLineup(result, [
      { playerId: 9, position: 'FW', isStarter: true, isCaptain: true, isViceCaptain: false, team: 'AAA' },
      { playerId: 10, position: 'MF', isStarter: true, isCaptain: false, isViceCaptain: true, team: 'AAA' },
    ]);
    // FW: appearance 2 + 2 goals (4*2=8) + MOTM 3 = 13 → captain x2 = 26
    const striker = lines.find((l) => l.playerId === 9)!;
    expect(striker.points).toBe(26);
    // MF: appearance 2 + assist 3 + clean sheet 1 = 6 (vice not multiplied — captain played)
    const mid = lines.find((l) => l.playerId === 10)!;
    expect(mid.points).toBe(6);
    expect(total).toBe(32);
  });

  it('applies defensive penalties and card deductions', () => {
    const result = mkResult({
      home: 'AAA', away: 'BBB', homeScore: 0, awayScore: 4, winner: 'BBB',
      stats: { home: { ...baseStats, saves: 6 }, away: { ...baseStats, goals: 4 } },
      events: [
        { minute: 30, type: 'yellow_card', team: 'AAA', playerId: 5, playerName: 'Def' },
      ],
    });
    const { lines } = scoreFantasyLineup(result, [
      { playerId: 5, position: 'DF', isStarter: true, isCaptain: false, isViceCaptain: false, team: 'AAA' },
      { playerId: 1, position: 'GK', isStarter: true, isCaptain: false, isViceCaptain: false, team: 'AAA' },
    ]);
    // DF: 2 appearance - 2 (4 conceded) - 1 yellow = -1
    expect(lines.find((l) => l.playerId === 5)!.points).toBe(-1);
    // GK: 2 appearance - 2 conceded + 2 (6 saves / 3) = 2
    expect(lines.find((l) => l.playerId === 1)!.points).toBe(2);
  });

  it('vice-captain multiplier activates only when captain misses', () => {
    const result = mkResult({
      events: [{ minute: 20, type: 'goal', team: 'AAA', playerId: 7, playerName: 'Seven' }],
    });
    const { lines } = scoreFantasyLineup(result, [
      { playerId: 99, position: 'FW', isStarter: false, isCaptain: true, isViceCaptain: false, team: 'AAA' },
      { playerId: 7, position: 'MF', isStarter: true, isCaptain: false, isViceCaptain: true, team: 'AAA' },
    ]);
    // MF: 2 + 5 (goal) + 1 (CS) = 8 → vice x1.5 = 12
    expect(lines.find((l) => l.playerId === 7)!.points).toBe(12);
  });
});

describe('chemistry & tactical fit (real Argentina squad)', () => {
  const { home: arg } = teamPair('ARG', 'FRA');

  it('chemistry lands in 0..100 with sane components', () => {
    const starters = arg.squad.slice(0, 11);
    const captain = arg.squad.find((p) => p.captain)!;
    const chem = computeChemistry(starters, captain.id);
    expect(chem.total).toBeGreaterThan(20);
    expect(chem.total).toBeLessThanOrEqual(100);
    expect(chem.captainBonus).toBeGreaterThanOrEqual(11);
  });

  it('tactical fit flags out-of-position picks', () => {
    const squadById = new Map(arg.squad.map((p) => [p.id, p]));
    const gk = arg.squad.find((p) => p.position === 'GK')!;
    const fws = arg.squad.filter((p) => p.position === 'FW');
    const dfs = arg.squad.filter((p) => p.position === 'DF');
    const mfs = arg.squad.filter((p) => p.position === 'MF');
    const xi = [
      { slotId: 'GK', role: 'GK' as const, playerId: gk.id },
      { slotId: 'LB', role: 'LB' as const, playerId: dfs[0].id },
      { slotId: 'CB1', role: 'CB' as const, playerId: dfs[1].id },
      { slotId: 'CB2', role: 'CB' as const, playerId: dfs[2].id },
      { slotId: 'RB', role: 'RB' as const, playerId: fws[0].id }, // striker at right back!
      { slotId: 'CDM', role: 'CDM' as const, playerId: mfs[0].id },
      { slotId: 'CM1', role: 'CM' as const, playerId: mfs[1].id },
      { slotId: 'CM2', role: 'CM' as const, playerId: mfs[2].id },
      { slotId: 'LW', role: 'LW' as const, playerId: fws[1].id },
      { slotId: 'ST', role: 'ST' as const, playerId: fws[2].id },
      { slotId: 'RW', role: 'RW' as const, playerId: fws[3].id },
    ];
    const fit = computeTacticalFit('4-3-3', xi, squadById, 'possession');
    expect(fit.warnings.join(' ')).toContain('out of position');
    expect(fit.positionFit).toBeLessThan(60); // one of eleven slots is unnatural
    expect(fit.total).toBeLessThan(100);
    expect(fit.total).toBeGreaterThan(40);
  });
});
