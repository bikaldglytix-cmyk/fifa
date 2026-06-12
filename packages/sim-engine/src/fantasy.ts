import {
  FANTASY_SCORING,
  type SimMatchResult,
  type SquadPosition,
} from '@fifa/shared';

export interface FantasyPlayerContext {
  playerId: number;
  position: SquadPosition;
  isStarter: boolean;
  isCaptain: boolean;
  isViceCaptain: boolean;
  team: string; // country code
}

export interface FantasyPointsLine {
  playerId: number;
  points: number;
  breakdown: Record<string, number>;
}

/**
 * Computes fantasy points for a user's selected players from a completed
 * (real or simulated) match result. Pure function — rules in @fifa/shared.
 */
export function scoreFantasyLineup(
  result: SimMatchResult,
  selections: FantasyPlayerContext[],
  opts?: { knockout?: boolean },
): { total: number; lines: FantasyPointsLine[] } {
  const S = FANTASY_SCORING;
  const lines: FantasyPointsLine[] = [];

  const goalsBy = new Map<number, number>();
  const assistsBy = new Map<number, number>();
  const yellowBy = new Map<number, number>();
  const secondYellowBy = new Set<number>();
  const redBy = new Set<number>();
  const ownGoalBy = new Map<number, number>();
  const penMissBy = new Map<number, number>();

  for (const ev of result.events) {
    if (!ev.playerId) continue;
    switch (ev.type) {
      case 'goal':
      case 'penalty_goal':
        goalsBy.set(ev.playerId, (goalsBy.get(ev.playerId) ?? 0) + 1);
        if (ev.assistPlayerId) assistsBy.set(ev.assistPlayerId, (assistsBy.get(ev.assistPlayerId) ?? 0) + 1);
        break;
      case 'own_goal':
        ownGoalBy.set(ev.playerId, (ownGoalBy.get(ev.playerId) ?? 0) + 1);
        break;
      case 'yellow_card':
        yellowBy.set(ev.playerId, (yellowBy.get(ev.playerId) ?? 0) + 1);
        break;
      case 'second_yellow':
        secondYellowBy.add(ev.playerId);
        break;
      case 'red_card':
        redBy.add(ev.playerId);
        break;
      case 'penalty_missed':
        penMissBy.set(ev.playerId, (penMissBy.get(ev.playerId) ?? 0) + 1);
        break;
      default:
        break;
    }
  }

  const concededOf = (team: string) => (team === result.home ? result.awayScore : result.homeScore);
  const teamWonKnockout = (team: string) => result.winner === team;

  const captainPlayed = selections.some((s) => s.isCaptain && s.isStarter);

  let total = 0;
  for (const sel of selections) {
    if (!sel.isStarter) continue;
    const b: Record<string, number> = {};
    b.appearance = S.appearance;

    const goals = goalsBy.get(sel.playerId) ?? 0;
    if (goals) b.goals = goals * S.goal[sel.position];

    const assists = assistsBy.get(sel.playerId) ?? 0;
    if (assists) b.assists = assists * S.assist;

    const conceded = concededOf(sel.team);
    if (conceded === 0 && S.cleanSheet[sel.position] > 0) b.cleanSheet = S.cleanSheet[sel.position];
    if ((sel.position === 'GK' || sel.position === 'DF') && conceded >= 2) {
      b.concededPenalty = Math.floor(conceded / 2) * S.concededPenaltyPer2;
    }

    if (sel.position === 'GK') {
      const saves = sel.team === result.home ? result.stats.home.saves : result.stats.away.saves;
      if (saves >= 3) b.saves = Math.floor(saves / 3) * S.savesPer3;
    }

    const y = yellowBy.get(sel.playerId) ?? 0;
    if (y) b.yellow = y * S.yellowCard;
    if (secondYellowBy.has(sel.playerId)) b.secondYellow = S.secondYellow;
    if (redBy.has(sel.playerId)) b.red = S.redCard;

    const og = ownGoalBy.get(sel.playerId) ?? 0;
    if (og) b.ownGoals = og * S.ownGoal;

    const pm = penMissBy.get(sel.playerId) ?? 0;
    if (pm) b.penaltyMiss = pm * S.penaltyMiss;

    if (result.manOfTheMatch?.playerId === sel.playerId) b.manOfTheMatch = S.manOfTheMatch;

    if (opts?.knockout && teamWonKnockout(sel.team)) b.knockoutWin = S.knockoutWinBonus;

    let points = Object.values(b).reduce((a, v) => a + v, 0);
    if (sel.isCaptain) {
      b.captainMultiplier = points * (S.captainMultiplier - 1);
      points *= S.captainMultiplier;
    } else if (sel.isViceCaptain && !captainPlayed) {
      b.viceCaptainMultiplier = points * (S.viceCaptainMultiplier - 1);
      points = Math.round(points * S.viceCaptainMultiplier);
    }

    points = Math.round(points);
    total += points;
    lines.push({ playerId: sel.playerId, points, breakdown: b });
  }

  return { total, lines };
}
