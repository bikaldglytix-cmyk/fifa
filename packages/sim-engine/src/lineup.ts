import {
  FORMATIONS,
  type FormationDef,
  type FormationId,
  type FormationSlot,
  type LineupSlotAssignment,
  type TacticalStyle,
} from '@fifa/shared';
import type { PlayerTournamentState, SimPlayer, SimTeam } from './types';

/** Manager style -> default formation when no user lineup is pinned. */
export const STYLE_FORMATION: Record<TacticalStyle, FormationId> = {
  possession: '4-3-3',
  high_press: '4-3-3',
  counter_attack: '4-2-3-1',
  direct: '4-4-2',
  defensive_block: '5-3-2',
};

export interface EffectiveLineup {
  formation: FormationDef;
  /** slotId -> player */
  assignments: Array<{ slot: FormationSlot; player: SimPlayer }>;
  /** mean rating of the XI weighted by fitness/fatigue */
  strength: number;
  gk: SimPlayer;
  captain: SimPlayer;
}

const slotScore = (p: SimPlayer, slot: FormationSlot): number => {
  const natural = slot.natural.includes(p.position);
  // out-of-group penalty mirrors chemistry rules
  const positionFactor = natural ? 1 : p.position === 'MF' || slot.natural.includes('MF') ? 0.88 : 0.78;
  return p.rating * positionFactor * (p.fitness / 100);
};

/**
 * Picks the best available XI for a formation (greedy by slot scarcity —
 * GK first, then slots with fewest natural candidates).
 */
export function autoSelectLineup(
  team: SimTeam,
  formationId: FormationId,
  states?: Map<number, PlayerTournamentState>,
): EffectiveLineup {
  const formation = FORMATIONS[formationId];
  const available = team.squad.filter((p) => {
    if (p.injured) return false;
    const st = states?.get(p.id);
    return !(st?.suspendedForNext);
  });

  const pool = new Set(available);
  const ordered = [...formation.slots].sort((a, b) => {
    const candA = available.filter((p) => a.natural.includes(p.position)).length;
    const candB = available.filter((p) => b.natural.includes(p.position)).length;
    return candA - candB;
  });

  const picks = new Map<string, SimPlayer>();
  for (const slot of ordered) {
    let best: SimPlayer | null = null;
    let bestScore = -1;
    for (const p of pool) {
      const fatigue = states?.get(p.id)?.fatigue ?? 0;
      const score = slotScore(p, slot) * (1 - Math.min(0.25, fatigue * 0.06));
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) throw new Error(`squad of ${team.code} cannot fill slot ${slot.id}`);
    picks.set(slot.id, best);
    pool.delete(best);
  }

  const assignments = formation.slots.map((slot) => ({ slot, player: picks.get(slot.id)! }));
  return finalize(formation, assignments);
}

/** Builds an EffectiveLineup from a user's pinned XI (already validated by API). */
export function fromPinnedLineup(
  team: SimTeam,
  formationId: FormationId,
  startingXi: LineupSlotAssignment[],
  states?: Map<number, PlayerTournamentState>,
): EffectiveLineup {
  const formation = FORMATIONS[formationId];
  const byId = new Map(team.squad.map((p) => [p.id, p]));
  const assignments = formation.slots.map((slot) => {
    const a = startingXi.find((x) => x.slotId === slot.id);
    const player = a ? byId.get(a.playerId) : undefined;
    if (!player) throw new Error(`pinned lineup missing slot ${slot.id}`);
    return { slot, player };
  });
  // suspended/injured players silently fall back to best replacement
  const pool = new Set(team.squad.filter((p) => !assignments.some((a) => a.player.id === p.id)));
  for (const a of assignments) {
    const st = states?.get(a.player.id);
    if (a.player.injured || st?.suspendedForNext) {
      let best: SimPlayer | null = null;
      let bestScore = -1;
      for (const p of pool) {
        const pst = states?.get(p.id);
        if (p.injured || pst?.suspendedForNext) continue;
        const sc = slotScore(p, a.slot);
        if (sc > bestScore) {
          bestScore = sc;
          best = p;
        }
      }
      if (best) {
        pool.delete(best);
        a.player = best;
      }
    }
  }
  return finalize(formation, assignments);
}

function finalize(formation: FormationDef, assignments: Array<{ slot: FormationSlot; player: SimPlayer }>): EffectiveLineup {
  const ratings = assignments.map(({ slot, player }) => slotScore(player, slot));
  const strength = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  const gk = assignments.find((a) => a.slot.role === 'GK')!.player;
  const captain =
    assignments.find((a) => a.player.captain)?.player ??
    assignments.reduce((best, a) => (a.player.caps > best.caps ? a.player : best), assignments[0].player);
  return { formation, assignments, strength, gk, captain };
}

export function lineupFor(
  team: SimTeam,
  states?: Map<number, PlayerTournamentState>,
): EffectiveLineup {
  if (team.pinnedLineup) {
    try {
      return fromPinnedLineup(team, team.pinnedLineup.formation, team.pinnedLineup.startingXi, states);
    } catch {
      // fall through to auto-pick if the pinned XI is invalid for this squad
    }
  }
  return autoSelectLineup(team, STYLE_FORMATION[team.manager.preferredStyle], states);
}

/** Squad-average benchmark used to convert lineup quality into a goal modifier. */
export function squadBaseline(team: SimTeam): number {
  const sorted = [...team.squad].sort((a, b) => b.rating - a.rating).slice(0, 18);
  return sorted.reduce((acc, p) => acc + p.rating, 0) / sorted.length;
}
