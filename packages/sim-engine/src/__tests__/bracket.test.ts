import { describe, expect, it } from 'vitest';
import type { GroupLetter } from '@fifa/shared';
import { resolveRoundOf32 } from '../bracket';
import { realTournamentInputs } from './fixtures';
import { mulberry32, shuffled } from '../rng';

const GROUPS = 'ABCDEFGHIJKL'.split('') as GroupLetter[];

describe('round-of-32 allocation (official Annex C, 495 combinations)', () => {
  const inputs = realTournamentInputs();

  const outcomesFor = (): Record<GroupLetter, { winner: string; runnerUp: string; third: string }> => {
    const o = {} as Record<GroupLetter, { winner: string; runnerUp: string; third: string }>;
    for (const g of GROUPS) {
      const teams = [...inputs.teams.values()].filter((t) => t.group === g);
      o[g] = { winner: teams[0].code, runnerUp: teams[1].code, third: teams[2].code };
    }
    return o;
  };

  it('table covers all 495 combinations', () => {
    expect(Object.keys(inputs.thirdPlaceTable)).toHaveLength(495);
  });

  it('every combination yields a complete, constraint-respecting bracket', () => {
    const rng = mulberry32(99);
    const outcomes = outcomesFor();
    const combos = Object.keys(inputs.thirdPlaceTable);
    // exhaustive: all 495
    for (const key of combos) {
      const rankedGroups = shuffled(rng, key.split('') as GroupLetter[]);
      const remaining = GROUPS.filter((g) => !key.includes(g));
      const { r32, qualifiedThirds, thirdAssignments } = resolveRoundOf32(
        inputs.schedule,
        outcomes,
        [...rankedGroups, ...remaining],
        inputs.thirdPlaceTable,
      );

      expect(r32.size).toBe(16);
      expect(qualifiedThirds).toHaveLength(8);

      // 32 distinct teams, no team twice
      const all = [...r32.values()].flatMap((p) => [p.home, p.away]);
      expect(new Set(all).size).toBe(32);

      // a group winner never faces the third from its own group
      for (const [winnerGroup, thirdGroup] of Object.entries(thirdAssignments)) {
        expect(winnerGroup).not.toBe(thirdGroup);
        expect(key.includes(thirdGroup)).toBe(true);
      }

      // assignments use 8 distinct third groups
      expect(new Set(Object.values(thirdAssignments)).size).toBe(8);
    }
  });

  it('matches the published slot constraints (e.g. M79: 1A vs 3rd of C/E/F/H/I)', () => {
    const m79 = inputs.schedule.find((m) => m.matchNumber === 79)!;
    expect(m79.home).toEqual({ type: 'groupWinner', group: 'A' });
    expect(m79.away.type).toBe('thirdPlace');
    if (m79.away.type === 'thirdPlace') {
      expect(m79.away.allowedGroups).toEqual(['C', 'E', 'F', 'H', 'I']);
    }
    // every Annex C row must respect the published per-slot constraints
    const allowedBySlot: Record<string, string[]> = {};
    for (const m of inputs.schedule.filter((x) => x.stage === 'round32')) {
      if (m.home.type === 'groupWinner' && m.away.type === 'thirdPlace') {
        allowedBySlot[m.home.group] = m.away.allowedGroups;
      }
    }
    expect(Object.keys(allowedBySlot).sort().join('')).toBe('ABDEGIKL');
    for (const assignments of Object.values(inputs.thirdPlaceTable)) {
      for (const [slot, third] of Object.entries(assignments)) {
        expect(allowedBySlot[slot]).toContain(third);
      }
    }
  });
});
