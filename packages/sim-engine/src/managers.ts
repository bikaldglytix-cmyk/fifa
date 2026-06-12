import type { MatchStage, TacticalStyle } from '@fifa/shared';
import { clamp } from '@fifa/shared';
import type { H2HRecord, ManagerProfile, MatchContext } from './types';

/**
 * Manager Intelligence Engine (PRD §14).
 * Produces a bounded multiplier (0.88..1.12) applied to a side's expected
 * goals, combining tactical quality, style matchup, tournament pressure and
 * historical head-to-head between the nations.
 */

/** PRD tactical style advantage matrix. */
const STYLE_MATCHUP: Record<string, number> = {
  'possession>high_press': 1.06,
  'high_press>counter_attack': 1.08,
  'counter_attack>possession': 1.05,
  'direct>defensive_block': 1.06,
  'defensive_block>possession': 1.04,
  // mild inverses
  'high_press>possession': 0.96,
  'counter_attack>high_press': 0.94,
  'possession>counter_attack': 0.97,
  'defensive_block>direct': 0.95,
  'possession>defensive_block': 0.97,
};

export function styleMatchupFactor(mine: TacticalStyle, theirs: TacticalStyle): number {
  return STYLE_MATCHUP[`${mine}>${theirs}`] ?? 1.0;
}

const STAGE_PRESSURE: Record<MatchStage, number> = {
  group: 0.25,
  round32: 0.45,
  round16: 0.55,
  quarterfinal: 0.7,
  semifinal: 0.85,
  third_place: 0.4,
  final: 1.0,
};

export interface ManagerImpactBreakdown {
  total: number;
  tactical: number;
  styleMatchup: number;
  pressure: number;
  h2h: number;
}

export function managerImpact(
  mine: ManagerProfile,
  theirs: ManagerProfile,
  ctx: MatchContext,
  h2h: { myWinRate: number; sample: number } | null,
): ManagerImpactBreakdown {
  // tactical quality differential (±5%)
  const tactical = 1 + ((mine.tacticalRating - theirs.tacticalRating) / 100) * 0.1;

  const style = styleMatchupFactor(mine.preferredStyle, theirs.preferredStyle);

  // pressure handling matters more in later rounds (±4% at final)
  const pressureWeight = STAGE_PRESSURE[ctx.stage];
  const pressureSkill = ctx.knockout ? mine.knockoutRating : mine.pressureHandling;
  const pressure = 1 + ((pressureSkill - 60) / 100) * 0.08 * pressureWeight;

  // nation-level head-to-head, shrunk by sample size (max ±3%)
  let h2hFactor = 1;
  if (h2h && h2h.sample >= 3) {
    const shrink = Math.min(1, h2h.sample / 10);
    h2hFactor = 1 + (h2h.myWinRate - 0.5) * 0.06 * shrink;
  }

  const total = clamp(tactical * style * pressure * h2hFactor, 0.88, 1.12);
  return { total, tactical, styleMatchup: style, pressure, h2h: h2hFactor };
}

/** Late-game substitution swing: applied to scoring intensity after 70'. */
export function substitutionSwing(mine: ManagerProfile): number {
  return 1 + ((mine.substitutionRating - 55) / 100) * 0.2;
}

export function h2hView(record: H2HRecord | null, iAmCountry1: boolean): { myWinRate: number; sample: number } | null {
  if (!record || record.played === 0) return null;
  const wins = iAmCountry1 ? record.wins1 : record.wins2;
  return { myWinRate: (wins + record.draws * 0.5) / record.played, sample: record.played };
}
