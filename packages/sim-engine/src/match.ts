import {
  ROLE_GOAL_MULTIPLIER,
  POSITION_GOAL_WEIGHT,
  POSITION_ASSIST_WEIGHT,
  clamp,
  round,
  type SimMatchEvent,
  type SimMatchResult,
  type SimTeamStats,
} from '@fifa/shared';
import { bivariatePoisson, normalSample, poissonSample, weightedPick, type Rng } from './rng';
import { computeStrength, type MatchInputs } from './strength';
import { substitutionSwing } from './managers';
import type { EffectiveLineup } from './lineup';
import { DEFAULT_CONFIG, type EngineConfig } from './types';

/** Minute-bucket weights for goal timing (15' buckets; final bucket includes stoppage). */
const GOAL_MINUTE_WEIGHTS = [11, 12, 14, 15, 17, 21];

function sampleGoalMinute(rng: Rng): number {
  const total = GOAL_MINUTE_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let b = 0; b < 6; b++) {
    r -= GOAL_MINUTE_WEIGHTS[b];
    if (r <= 0) {
      const start = b * 15 + 1;
      const minute = start + Math.floor(rng() * 15);
      // stoppage time
      if (b === 2 && rng() < 0.18) return 45 + 1 + Math.floor(rng() * 4);
      if (b === 5 && rng() < 0.22) return 90 + 1 + Math.floor(rng() * 6);
      return Math.min(minute, 90);
    }
  }
  return 90;
}

function sampleEtMinute(rng: Rng): number {
  return 91 + Math.floor(rng() * 30);
}

interface SideRuntime {
  lineup: EffectiveLineup;
  code: string;
  swing: number;
}

function pickScorer(rng: Rng, side: SideRuntime) {
  return weightedPick(rng, side.lineup.assignments, ({ slot, player }) => {
    const role = ROLE_GOAL_MULTIPLIER[slot.role];
    const gpg = player.internationalGoals / Math.max(8, player.caps);
    return role * (0.5 + player.rating / 100) * (0.5 + 4 * gpg);
  });
}

function pickAssister(rng: Rng, side: SideRuntime, scorerId: number) {
  const candidates = side.lineup.assignments.filter((a) => a.player.id !== scorerId);
  return weightedPick(rng, candidates, ({ slot, player }) => {
    const w = POSITION_ASSIST_WEIGHT[player.position] * (slot.role === 'CAM' || slot.role === 'LW' || slot.role === 'RW' ? 1.6 : 1);
    return w * (0.5 + player.rating / 100);
  });
}

function pickCarded(rng: Rng, side: SideRuntime) {
  return weightedPick(rng, side.lineup.assignments, ({ slot, player }) => {
    const positional =
      slot.role === 'CDM' ? 2.2 :
      player.position === 'DF' ? 1.8 :
      player.position === 'MF' ? 1.3 :
      player.position === 'FW' ? 0.8 : 0.25;
    return positional;
  });
}

export interface SimulateMatchOptions {
  rng: Rng;
  config?: Partial<EngineConfig>;
  /** knockout matches resolve a winner via ET + penalties */
  knockout?: boolean;
  /** include detailed event timeline (off for bulk Monte Carlo runs) */
  withEvents?: boolean;
}

export interface DetailedMatchOutcome extends SimMatchResult {
  lambdas: { home: number; away: number };
  lineups: {
    home: { formation: string; players: Array<{ slotId: string; playerId: number; name: string }> };
    away: { formation: string; players: Array<{ slotId: string; playerId: number; name: string }> };
  };
}

export function simulateMatch(inputs: MatchInputs, opts: SimulateMatchOptions): DetailedMatchOutcome {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const rng = opts.rng;
  const { lambdaHome, lambdaAway, homeLineup, awayLineup } = computeStrength(inputs, cfg);

  const home: SideRuntime = { lineup: homeLineup, code: inputs.home.code, swing: substitutionSwing(inputs.home.manager) };
  const away: SideRuntime = { lineup: awayLineup, code: inputs.away.code, swing: substitutionSwing(inputs.away.manager) };

  const lambda3 = cfg.goalCorrelation * Math.min(lambdaHome.lambda, lambdaAway.lambda);
  let [hGoals, aGoals] = bivariatePoisson(rng, lambdaHome.lambda, lambdaAway.lambda, lambda3);

  const events: SimMatchEvent[] = [];
  const withEvents = opts.withEvents !== false;

  // --- regulation goals -----------------------------------------------------
  const goalRecords: Array<{ minute: number; side: SideRuntime; scorerId: number }> = [];
  const addGoals = (side: SideRuntime, count: number, minuteFn: (rng: Rng) => number) => {
    for (let i = 0; i < count; i++) {
      const minute = minuteFn(rng);
      const isPenalty = rng() < 0.105;
      const isOwnGoal = !isPenalty && rng() < 0.028;
      if (isOwnGoal) {
        const opp = side === home ? away : home;
        const og = weightedPick(rng, opp.lineup.assignments, ({ player }) =>
          player.position === 'DF' ? 3 : player.position === 'GK' ? 0.4 : 1,
        );
        goalRecords.push({ minute, side, scorerId: -1 });
        if (withEvents) {
          events.push({ minute, type: 'own_goal', team: side.code, playerId: og.player.id, playerName: og.player.name });
        }
        continue;
      }
      const scorer = isPenalty
        ? side.lineup.assignments.reduce((best, a) => {
            const w = (x: typeof a) => x.player.rating + (x.player.internationalGoals / Math.max(8, x.player.caps)) * 60 + (x.player.position === 'FW' ? 8 : 0);
            return w(a) > w(best) ? a : best;
          })
        : pickScorer(rng, side);
      goalRecords.push({ minute, side, scorerId: scorer.player.id });
      if (withEvents) {
        const ev: SimMatchEvent = {
          minute,
          type: isPenalty ? 'penalty_goal' : 'goal',
          team: side.code,
          playerId: scorer.player.id,
          playerName: scorer.player.name,
        };
        if (!isPenalty && rng() < 0.7) {
          const assist = pickAssister(rng, side, scorer.player.id);
          ev.assistPlayerId = assist.player.id;
          ev.assistPlayerName = assist.player.name;
        }
        events.push(ev);
      }
    }
  };
  addGoals(home, hGoals, sampleGoalMinute);
  addGoals(away, aGoals, sampleGoalMinute);

  // --- extra time / penalties ------------------------------------------------
  let wentToExtraTime = false;
  let wentToPenalties = false;
  let penalties: SimMatchResult['penalties'];
  const ftScore = { home: hGoals, away: aGoals };

  if (opts.knockout && hGoals === aGoals) {
    wentToExtraTime = true;
    const etH = poissonSample(rng, lambdaHome.lambda * cfg.extraTimeFactor * home.swing);
    const etA = poissonSample(rng, lambdaAway.lambda * cfg.extraTimeFactor * away.swing);
    addGoals(home, etH, sampleEtMinute);
    addGoals(away, etA, sampleEtMinute);
    hGoals += etH;
    aGoals += etA;

    if (hGoals === aGoals) {
      wentToPenalties = true;
      penalties = simulateShootout(rng, inputs, home, away, cfg);
    }
  }

  // --- cards / misc events -----------------------------------------------------
  const cardCounts = { home: { y: 0, r: 0 }, away: { y: 0, r: 0 } };
  if (withEvents) {
    for (const side of [home, away]) {
      const yellows = poissonSample(rng, 1.9);
      const bucket = side === home ? cardCounts.home : cardCounts.away;
      const booked = new Set<number>();
      for (let i = 0; i < yellows; i++) {
        const a = pickCarded(rng, side);
        const minute = 15 + Math.floor(rng() * (wentToExtraTime ? 105 : 75));
        if (booked.has(a.player.id)) {
          bucket.y++;
          bucket.r++;
          events.push({ minute, type: 'second_yellow', team: side.code, playerId: a.player.id, playerName: a.player.name });
        } else {
          booked.add(a.player.id);
          bucket.y++;
          events.push({ minute, type: 'yellow_card', team: side.code, playerId: a.player.id, playerName: a.player.name });
        }
      }
      if (rng() < 0.045) {
        const a = pickCarded(rng, side);
        bucket.r++;
        events.push({ minute: 30 + Math.floor(rng() * 58), type: 'red_card', team: side.code, playerId: a.player.id, playerName: a.player.name });
      }
      if (rng() < 0.06) {
        const a = weightedPick(rng, side.lineup.assignments, () => 1);
        events.push({ minute: 10 + Math.floor(rng() * 70), type: 'injury', team: side.code, playerId: a.player.id, playerName: a.player.name });
      }
    }
    events.sort((a, b) => a.minute - b.minute);
  }

  // --- team stats ----------------------------------------------------------------
  const possessionHome = clamp(
    50 + 14 * Math.tanh((lambdaHome.effectiveElo - lambdaAway.effectiveElo) / 350) + normalSample(rng, 0, 3.5),
    30, 70,
  );
  const mkStats = (
    lambda: number, goals: number, oppGoals: number, possession: number, cards: { y: number; r: number },
  ): SimTeamStats => {
    const xg = Math.max(0.05, lambda * clamp(normalSample(rng, 1, 0.18), 0.5, 1.6));
    const shots = Math.max(goals, Math.round(xg / 0.105 + normalSample(rng, 0, 2)));
    const sot = Math.max(goals, Math.round(shots * clamp(normalSample(rng, 0.38, 0.07), 0.2, 0.6)));
    return {
      goals,
      possession: round(possession, 1),
      shots,
      shotsOnTarget: sot,
      xG: round(xg, 2),
      corners: Math.max(0, Math.round(shots * 0.45 + normalSample(rng, 0, 1.2))),
      fouls: Math.max(2, Math.round(normalSample(rng, 12, 3))),
      yellowCards: cards.y,
      redCards: cards.r,
      passAccuracy: round(clamp(72 + possession * 0.25 + normalSample(rng, 0, 2.5), 60, 94), 1),
      saves: 0, // filled below from opponent SOT
    };
  };
  const statsHome = mkStats(lambdaHome.lambda, hGoals, aGoals, possessionHome, cardCounts.home);
  const statsAway = mkStats(lambdaAway.lambda, aGoals, hGoals, 100 - possessionHome, cardCounts.away);
  statsHome.saves = Math.max(0, statsAway.shotsOnTarget - aGoals);
  statsAway.saves = Math.max(0, statsHome.shotsOnTarget - hGoals);

  // --- man of the match -------------------------------------------------------------
  const involvement = new Map<number, { n: number; name: string; team: string; rating: number }>();
  for (const ev of events) {
    if ((ev.type === 'goal' || ev.type === 'penalty_goal') && ev.playerId) {
      const e = involvement.get(ev.playerId) ?? { n: 0, name: ev.playerName!, team: ev.team, rating: 0 };
      e.n += 2;
      involvement.set(ev.playerId, e);
    }
    if (ev.assistPlayerId) {
      const e = involvement.get(ev.assistPlayerId) ?? { n: 0, name: ev.assistPlayerName!, team: ev.team, rating: 0 };
      e.n += 1;
      involvement.set(ev.assistPlayerId, e);
    }
  }
  let manOfTheMatch: SimMatchResult['manOfTheMatch'] = null;
  const winnerCode = hGoals > aGoals ? home.code : aGoals > hGoals ? away.code : penalties ? (penalties.home > penalties.away ? home.code : away.code) : null;
  if (involvement.size > 0) {
    const best = [...involvement.entries()].sort((a, b) => {
      const winBonus = (x: [number, { team: string }]) => (x[1].team === winnerCode ? 1.5 : 0);
      return b[1].n + winBonus(b as never) - (a[1].n + winBonus(a as never));
    })[0];
    manOfTheMatch = { playerId: best[0], name: best[1].name, team: best[1].team };
  } else {
    const side = winnerCode === away.code ? away : home;
    const gk = side.lineup.gk;
    manOfTheMatch = { playerId: gk.id, name: gk.name, team: side.code };
  }

  return {
    home: home.code,
    away: away.code,
    homeScore: hGoals,
    awayScore: aGoals,
    ftScore: wentToExtraTime ? ftScore : undefined,
    wentToExtraTime,
    wentToPenalties,
    penalties,
    winner: winnerCode,
    events,
    stats: { home: statsHome, away: statsAway },
    manOfTheMatch,
    lambdas: { home: round(lambdaHome.lambda, 3), away: round(lambdaAway.lambda, 3) },
    lineups: {
      home: {
        formation: homeLineup.formation.id,
        players: homeLineup.assignments.map((a) => ({ slotId: a.slot.id, playerId: a.player.id, name: a.player.name })),
      },
      away: {
        formation: awayLineup.formation.id,
        players: awayLineup.assignments.map((a) => ({ slotId: a.slot.id, playerId: a.player.id, name: a.player.name })),
      },
    },
  };
}

function simulateShootout(
  rng: Rng,
  inputs: MatchInputs,
  home: SideRuntime,
  away: SideRuntime,
  cfg: EngineConfig,
): NonNullable<SimMatchResult['penalties']> {
  const takers = (side: SideRuntime) =>
    [...side.lineup.assignments]
      .sort((a, b) => {
        const w = (x: typeof a) =>
          x.player.rating +
          (x.player.internationalGoals / Math.max(8, x.player.caps)) * 50 +
          (x.player.position === 'FW' ? 6 : x.player.position === 'MF' ? 3 : 0);
        return w(b) - w(a);
      })
      .map((a) => a.player);

  const hTakers = takers(home);
  const aTakers = takers(away);
  const hGk = home.lineup.gk;
  const aGk = away.lineup.gk;

  const histBoost = (team: typeof inputs.home) =>
    team.shootouts.taken >= 3 ? (team.shootouts.won / team.shootouts.taken - 0.5) * 0.05 : 0;

  const convProb = (taker: { rating: number }, oppGk: { rating: number }, team: typeof inputs.home) =>
    clamp(
      cfg.penaltyBaseConversion +
        ((taker.rating - 72) / 100) * 0.18 -
        ((oppGk.rating - 72) / 100) * 0.22 +
        ((team.manager.knockoutRating - 60) / 100) * 0.04 +
        histBoost(team),
      0.45, 0.93,
    );

  const sequence: Array<{ team: string; scored: boolean; taker: string }> = [];
  let hScore = 0;
  let aScore = 0;
  let roundN = 0;

  const kick = (side: 'h' | 'a', idx: number): boolean => {
    const taker = side === 'h' ? hTakers[idx % hTakers.length] : aTakers[idx % aTakers.length];
    const scored = rng() < convProb(taker, side === 'h' ? aGk : hGk, side === 'h' ? inputs.home : inputs.away);
    sequence.push({ team: side === 'h' ? home.code : away.code, scored, taker: taker.name });
    return scored;
  };

  // best of 5 with early termination
  for (roundN = 0; roundN < 5; roundN++) {
    if (kick('h', roundN)) hScore++;
    const remainingH = 5 - roundN - 1;
    if (aScore > hScore + remainingH) break;
    if (kick('a', roundN)) aScore++;
    const remainingA = 5 - roundN - 1;
    if (hScore > aScore + remainingA || aScore > hScore + remainingH) {
      roundN++;
      break;
    }
  }
  // sudden death
  let sd = 5;
  while (hScore === aScore) {
    if (kick('h', sd)) hScore++;
    if (kick('a', sd)) aScore++;
    sd++;
    if (sd > 30) {
      // pathological guard: coin flip
      if (rng() < 0.5) hScore++;
      else aScore++;
    }
  }
  return { home: hScore, away: aScore, sequence };
}
