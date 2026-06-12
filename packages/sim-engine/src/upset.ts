import type { TeamFatigueInfo, UpsetAssessment, UpsetTier } from '@fifa/shared';
import { clamp, round } from '@fifa/shared';
import { styleMatchupFactor } from './managers';
import type { EffectiveLineup } from './lineup';
import type { H2HRecord, SimTeam } from './types';

/**
 * Upset detection engine — a dedicated model asking one question: what would
 * make the weaker side win THIS match? It scores structural upset enablers
 * (tactical counters, fatigue imbalance, availability, rating-model
 * divergence, pressure asymmetry) on top of the raw underdog probability.
 */

export interface UpsetInputs {
  home: SimTeam;
  away: SimTeam;
  pHome: number;
  pDraw: number;
  pAway: number;
  homeLineup: EffectiveLineup;
  awayLineup: EffectiveLineup;
  homeFatigue?: TeamFatigueInfo | null;
  awayFatigue?: TeamFatigueInfo | null;
  knockout: boolean;
  h2h: H2HRecord | null;
}

export function assessUpset(inputs: UpsetInputs): UpsetAssessment {
  const { home, away, pHome, pAway } = inputs;
  const homeIsFavorite = pHome >= pAway;
  const favorite = homeIsFavorite ? home : away;
  const underdog = homeIsFavorite ? away : home;
  const favLineup = homeIsFavorite ? inputs.homeLineup : inputs.awayLineup;
  const dogLineup = homeIsFavorite ? inputs.awayLineup : inputs.homeLineup;
  const favFatigue = homeIsFavorite ? inputs.homeFatigue : inputs.awayFatigue;
  const dogFatigue = homeIsFavorite ? inputs.awayFatigue : inputs.homeFatigue;
  const pUnderdog = homeIsFavorite ? pAway : pHome;
  const favProb = homeIsFavorite ? pHome : pAway;

  const drivers: string[] = [];
  // Base risk: the model's own underdog probability (0..~45 → 0..55 points).
  let score = pUnderdog * 120;

  // Close match to begin with?
  if (favProb < 0.5) {
    score += 8;
    drivers.push('No side clears 50% — "upset" barely applies in a coin-flip');
  }

  // Tactical counter: underdog's style troubles the favourite's.
  const dogStyleEdge = styleMatchupFactor(underdog.manager.preferredStyle, favorite.manager.preferredStyle);
  if (dogStyleEdge > 1.02) {
    score += 12;
    drivers.push(
      `${underdog.name}'s ${underdog.manager.preferredStyle.replace(/_/g, ' ')} is a stylistic counter to ${favorite.name}'s approach`,
    );
  }

  // Fatigue imbalance favouring the underdog.
  if (favFatigue && dogFatigue && dogFatigue.freshness - favFatigue.freshness >= 12) {
    score += 10;
    drivers.push(
      `Freshness gap: ${underdog.name} (${dogFatigue.freshness}) vs ${favorite.name} (${favFatigue.freshness}) — tired favourites get punished`,
    );
  }

  // Availability imbalance: favourites missing key XI players.
  const missing = (team: SimTeam, lineup: EffectiveLineup) => {
    const unavailable = team.squad.filter((p) => p.injured || p.fitness < 75).length;
    const xiDip = team.squad.length ? unavailable / team.squad.length : 0;
    const strengthDip = lineup.strength; // already fitness-weighted
    return { unavailable, xiDip, strengthDip };
  };
  const favMissing = missing(favorite, favLineup);
  const dogMissing = missing(underdog, dogLineup);
  if (favMissing.unavailable - dogMissing.unavailable >= 2) {
    score += 9;
    drivers.push(`${favorite.name} carry ${favMissing.unavailable} fitness/injury concerns to ${underdog.name}'s ${dogMissing.unavailable}`);
  }

  // Rating-model divergence: FIFA rank says mismatch but Elo disagrees (or
  // vice versa) — uncertainty in the true gap is upset fuel.
  const rankGapNorm = clamp((underdog.fifaRanking - favorite.fifaRanking) / 50, 0, 1);
  const eloGapNorm = clamp((favorite.elo - underdog.elo) / 300, 0, 1);
  const divergence = Math.abs(rankGapNorm - eloGapNorm);
  if (divergence > 0.3) {
    score += 8;
    drivers.push('Ranking and Elo disagree about the real gap — the market may be mispricing this one');
  }

  // Underdog's historical hold over the favourite.
  if (inputs.h2h && inputs.h2h.played >= 4) {
    const [c1] = [home.code, away.code].sort();
    const dogIsC1 = c1 === underdog.code;
    const dogWins = dogIsC1 ? inputs.h2h.wins1 : inputs.h2h.wins2;
    const dogRate = (dogWins + inputs.h2h.draws * 0.5) / inputs.h2h.played;
    if (dogRate >= 0.5) {
      score += 9;
      drivers.push(`History sides with the underdog: ${underdog.name} hold their own across ${inputs.h2h.played} meetings`);
    }
  }

  // Knockout one-off variance.
  if (inputs.knockout) {
    score += 5;
    drivers.push('One-off knockout: variance is structurally higher, and penalties are a lottery');
  }

  // In-form underdog.
  if (underdog.form.score - favorite.form.score > 0.25) {
    score += 7;
    drivers.push(`${underdog.name} arrive in distinctly better form (${underdog.form.results.slice(0, 5)} vs ${favorite.form.results.slice(0, 5)})`);
  }

  score = clamp(score, 0, 100);
  const tier: UpsetTier = score < 25 ? 'low' : score < 45 ? 'medium' : score < 65 ? 'high' : 'extreme';

  if (!drivers.length) {
    drivers.push(`${favorite.name} are clear favourites with no structural upset enablers detected`);
  }

  return {
    score: round(score, 1),
    tier,
    favorite: favorite.code,
    underdog: underdog.code,
    underdogWinProbability: round(pUnderdog, 4),
    drivers: drivers.slice(0, 5),
  };
}
