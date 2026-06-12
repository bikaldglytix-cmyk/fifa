import { clamp, type TeamFatigueInfo } from '@fifa/shared';
import { managerImpact, h2hView, type ManagerImpactBreakdown } from './managers';
import { lineupFor, squadBaseline, type EffectiveLineup } from './lineup';
import { fatigueLambdaFactor } from './fatigue';
import type { ConditionsAssessment } from './conditions';
import type { PsychAssessmentResult } from './psychology';
import type { EngineConfig, H2HRecord, MatchContext, PlayerTournamentState, SimTeam } from './types';

const HOST_OF: Record<string, 'USA' | 'MEX' | 'CAN'> = { USA: 'USA', MEX: 'MEX', CAN: 'CAN' };

export interface LambdaBreakdown {
  lambda: number;
  effectiveElo: number;
  eloComponent: number;
  formFactor: number;
  lineupFactor: number;
  managerFactor: ManagerImpactBreakdown;
  formationAttack: number;
  opponentFormationDefense: number;
  hostBonusApplied: boolean;
  conditionsFactor: number;
  fatigueFactor: number;
  psychFactor: number;
}

/**
 * Pre-assessed environmental/situational factors (venue conditions, squad
 * fatigue from the real itinerary, psychology). Assembled by the API layer
 * or `assembleExtras`; the strength model folds them in multiplicatively.
 */
export interface MatchExtras {
  conditions?: ConditionsAssessment | null;
  homeFatigue?: TeamFatigueInfo | null;
  awayFatigue?: TeamFatigueInfo | null;
  homePsych?: PsychAssessmentResult | null;
  awayPsych?: PsychAssessmentResult | null;
}

export interface MatchInputs {
  home: SimTeam;
  away: SimTeam;
  ctx: MatchContext;
  h2h: H2HRecord | null; // record keyed [c1,c2] sorted — wins1 belongs to lexicographically first code
  homeStates?: Map<number, PlayerTournamentState>;
  awayStates?: Map<number, PlayerTournamentState>;
  extras?: MatchExtras;
}

export interface ComputedStrength {
  lambdaHome: LambdaBreakdown;
  lambdaAway: LambdaBreakdown;
  homeLineup: EffectiveLineup;
  awayLineup: EffectiveLineup;
}

/**
 * Expected-goals model (Dixon-Coles flavored):
 *   λ_side = base · 10^(ΔEloEff / scale) · form · lineup · manager · formation
 * ΔEloEff includes the host-nation bonus when a host plays in its own country.
 */
export function computeStrength(inputs: MatchInputs, cfg: EngineConfig): ComputedStrength {
  const { home, away, ctx } = inputs;

  const homeLineup = lineupFor(home, inputs.homeStates);
  const awayLineup = lineupFor(away, inputs.awayStates);

  const homeHost = home.isHostNation && HOST_OF[home.code] === ctx.venueCountry;
  const awayHost = away.isHostNation && HOST_OF[away.code] === ctx.venueCountry;

  const eloHome = home.elo + (homeHost ? cfg.hostEloBonus : 0);
  const eloAway = away.elo + (awayHost ? cfg.hostEloBonus : 0);
  const dr = eloHome - eloAway;

  // form: weighted recent results mapped to ±10%
  const formHome = 1 + clamp(home.form.score, -1, 1) * 0.1;
  const formAway = 1 + clamp(away.form.score, -1, 1) * 0.1;

  // lineup quality vs own squad baseline mapped to ±10%
  const lineupFactor = (lineup: EffectiveLineup, team: SimTeam) =>
    clamp(1 + ((lineup.strength - squadBaseline(team)) / 100) * 0.9, 0.88, 1.12);
  const lfHome = lineupFactor(homeLineup, home);
  const lfAway = lineupFactor(awayLineup, away);

  // manager intelligence
  const [c1] = [home.code, away.code].sort();
  const homeIsC1 = c1 === home.code;
  const miHome = managerImpact(home.manager, away.manager, ctx, h2hView(inputs.h2h, homeIsC1));
  const miAway = managerImpact(away.manager, home.manager, ctx, h2hView(inputs.h2h, !homeIsC1));

  // environmental & situational extras (assessed from real schedule/venue data)
  const ex = inputs.extras;
  const condHome = ex?.conditions?.lambdaFactorHome ?? 1;
  const condAway = ex?.conditions?.lambdaFactorAway ?? 1;
  const fatHome = ex?.homeFatigue ? fatigueLambdaFactor(ex.homeFatigue) : 1;
  const fatAway = ex?.awayFatigue ? fatigueLambdaFactor(ex.awayFatigue) : 1;
  const psyHome = ex?.homePsych?.lambdaFactor ?? 1;
  const psyAway = ex?.awayPsych?.lambdaFactor ?? 1;

  const mk = (
    drSigned: number,
    form: number,
    lf: number,
    mi: ManagerImpactBreakdown,
    myFormationAttack: number,
    theirFormationDefense: number,
    hostApplied: boolean,
    effectiveElo: number,
    conditionsFactor: number,
    fatigueFactor: number,
    psychFactor: number,
  ): LambdaBreakdown => {
    const eloComponent = Math.pow(10, drSigned / cfg.eloGoalScale);
    const raw =
      cfg.baseGoals * eloComponent * form * lf * mi.total * myFormationAttack * (2 - theirFormationDefense) *
      conditionsFactor * fatigueFactor * psychFactor;
    return {
      lambda: clamp(raw, cfg.minLambda, cfg.maxLambda),
      effectiveElo,
      eloComponent,
      formFactor: form,
      lineupFactor: lf,
      managerFactor: mi,
      formationAttack: myFormationAttack,
      opponentFormationDefense: theirFormationDefense,
      hostBonusApplied: hostApplied,
      conditionsFactor,
      fatigueFactor,
      psychFactor,
    };
  };

  return {
    lambdaHome: mk(
      dr, formHome, lfHome, miHome,
      homeLineup.formation.attackModifier, awayLineup.formation.defenseModifier,
      homeHost, eloHome, condHome, fatHome, psyHome,
    ),
    lambdaAway: mk(
      -dr, formAway, lfAway, miAway,
      awayLineup.formation.attackModifier, homeLineup.formation.defenseModifier,
      awayHost, eloAway, condAway, fatAway, psyAway,
    ),
    homeLineup,
    awayLineup,
  };
}

/** Weighted recent-form score from a "WWDL..." string (newest first) -> -1..+1. */
export function formScore(results: string): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < results.length; i++) {
    const w = Math.pow(0.85, i);
    den += w;
    if (results[i] === 'W') num += w;
    else if (results[i] === 'D') num += w * 0.45;
  }
  if (den === 0) return 0;
  return clamp((num / den - 0.5) * 2, -1, 1);
}
