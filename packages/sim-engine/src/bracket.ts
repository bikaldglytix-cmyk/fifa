import type { GroupLetter, MatchSlot, ScheduledMatch } from '@fifa/shared';

/**
 * Round-of-32 slot resolution.
 *
 * The eight best third-placed teams are assigned to the bracket using the
 * OFFICIAL allocation table from Annex C of the FIFA World Cup 26 regulations
 * (all 495 combinations of 8-from-12 groups), parsed verbatim from the
 * published table. Key = the 8 qualifying groups' letters sorted
 * ascending (e.g. "ABDEFHIK"); value = map from the group-winner slot
 * (groups A,B,D,E,G,I,K,L host a third-placed side) to the third's group.
 */
export type ThirdPlaceTable = Record<string, Record<string, string>>;

export interface GroupOutcome {
  winner: string;
  runnerUp: string;
  third: string;
}

export interface ResolvedSlots {
  /** matchNumber -> { home, away } country codes for matches 73–88 */
  r32: Map<number, { home: string; away: string }>;
  qualifiedThirds: string[]; // country codes in ranking order
  thirdAssignments: Record<string, string>; // winnerGroup -> thirdGroup
}

export function resolveRoundOf32(
  schedule: ScheduledMatch[],
  outcomes: Record<GroupLetter, GroupOutcome>,
  rankedThirdGroups: GroupLetter[], // best-first group letters of the ranked thirds
  table: ThirdPlaceTable,
): ResolvedSlots {
  const qualifyingGroups = [...rankedThirdGroups.slice(0, 8)].sort();
  const key = qualifyingGroups.join('');
  const assignments = table[key];
  if (!assignments) throw new Error(`no Annex C combination for ${key}`);

  const r32 = new Map<number, { home: string; away: string }>();
  for (const m of schedule.filter((x) => x.stage === 'round32')) {
    const resolve = (slot: MatchSlot): string => {
      switch (slot.type) {
        case 'groupWinner':
          return outcomes[slot.group].winner;
        case 'groupRunnerUp':
          return outcomes[slot.group].runnerUp;
        case 'thirdPlace': {
          // the third's group is determined by the match's group-winner side
          const homeSlot = m.home as MatchSlot;
          if (homeSlot.type !== 'groupWinner') throw new Error(`match ${m.matchNumber}: third-place slot without winner host`);
          const thirdGroup = assignments[homeSlot.group] as GroupLetter;
          return outcomes[thirdGroup].third;
        }
        case 'team':
          return slot.code;
        default:
          throw new Error(`match ${m.matchNumber}: unresolvable slot ${slot.type} in round of 32`);
      }
    };
    r32.set(m.matchNumber, { home: resolve(m.home), away: resolve(m.away) });
  }

  return {
    r32,
    qualifiedThirds: rankedThirdGroups.slice(0, 8).map((g) => outcomes[g].third),
    thirdAssignments: assignments,
  };
}

/** Knockout progression map: stage matches -> which earlier matches feed them. */
export function knockoutFeeders(schedule: ScheduledMatch[]): Map<number, { home: MatchSlot; away: MatchSlot }> {
  const map = new Map<number, { home: MatchSlot; away: MatchSlot }>();
  for (const m of schedule) {
    if (m.stage === 'group' || m.stage === 'round32') continue;
    map.set(m.matchNumber, { home: m.home, away: m.away });
  }
  return map;
}
