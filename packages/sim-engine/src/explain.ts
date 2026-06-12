import type {
  ConfidenceLevel,
  FactorContribution,
  MatchProbabilities,
  PredictionExplanation,
  TeamFatigueInfo,
  UpsetAssessment,
} from '@fifa/shared';
import { round } from '@fifa/shared';
import type { MatchInputs } from './strength';

/**
 * Explainability engine: turns the factor ledger collected during prediction
 * into a transparent, structured account — why the favourite is favoured, the
 * underdog's path, the biggest risks, and exactly which data each factor ran
 * on (measured vs proxy vs unavailable). Honesty over theatre.
 */

export function confidenceLevelOf(confidence: number): ConfidenceLevel {
  if (confidence < 35) return 'very_low';
  if (confidence < 50) return 'low';
  if (confidence < 68) return 'moderate';
  if (confidence < 84) return 'high';
  return 'very_high';
}

export interface ExplainInputs {
  inputs: MatchInputs;
  probabilities: MatchProbabilities;
  ledger: FactorContribution[];
  upset: UpsetAssessment;
  fatigue: { home: TeamFatigueInfo; away: TeamFatigueInfo } | null;
}

export function buildExplanation(x: ExplainInputs): PredictionExplanation {
  const { inputs, probabilities: p, ledger, upset, fatigue } = x;
  const homeIsFavorite = p.homeWin >= p.awayWin;
  const fav = homeIsFavorite ? inputs.home : inputs.away;
  const dog = homeIsFavorite ? inputs.away : inputs.home;
  const favSide = homeIsFavorite ? 'home' : 'away';
  const favP = Math.max(p.homeWin, p.awayWin);

  const sorted = [...ledger].sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
  const forFav = sorted.filter((f) => f.leans === favSide);
  const forDog = sorted.filter((f) => f.leans !== favSide && f.leans !== 'neutral');

  const whyFavored: string[] = [
    `The model gives ${fav.name} ${(favP * 100).toFixed(1)}% — expected goals ${homeIsFavorite ? p.expectedHomeGoals.toFixed(2) : p.expectedAwayGoals.toFixed(2)} to ${homeIsFavorite ? p.expectedAwayGoals.toFixed(2) : p.expectedHomeGoals.toFixed(2)}.`,
    ...forFav.slice(0, 4).map((f) => f.note),
  ];

  const whyUnderdogCanWin: string[] = [
    `${dog.name} win ${(Math.min(p.homeWin, p.awayWin) * 100).toFixed(1)}% of simulated matches — that is roughly 1 in ${Math.max(2, Math.round(1 / Math.max(0.01, Math.min(p.homeWin, p.awayWin))))}.`,
    ...forDog.slice(0, 3).map((f) => f.note),
    ...upset.drivers.filter((d) => !forDog.some((f) => f.note === d)).slice(0, 2),
  ];

  const biggestRisks: string[] = [];
  if (p.draw >= 0.26) biggestRisks.push(`Draw probability is elevated at ${(p.draw * 100).toFixed(0)}% — a cagey stalemate is a live outcome.`);
  if (upset.tier === 'high' || upset.tier === 'extreme') {
    biggestRisks.push(`Upset risk is ${upset.tier.toUpperCase()} (${upset.score}/100): ${upset.drivers[0] ?? ''}`);
  }
  if (fatigue) {
    const tired = [fatigue.home, fatigue.away].filter((f) => f.label === 'tired' || f.label === 'exhausted');
    for (const t of tired) biggestRisks.push(`${t.team} are ${t.label} (freshness ${t.freshness}/100) — late-game collapse risk.`);
  }
  const favScoreP = homeIsFavorite ? p.expectedHomeGoals : p.expectedAwayGoals;
  if (favScoreP < 1.2) biggestRisks.push(`The favourite's expected output is modest (${favScoreP.toFixed(2)} xG) — one defensive error could flip a tight game.`);
  if (!biggestRisks.length) biggestRisks.push('No elevated structural risks detected — the main risk is ordinary match variance.');

  return {
    whyFavored: whyFavored.slice(0, 5),
    whyUnderdogCanWin: whyUnderdogCanWin.slice(0, 5),
    biggestRisks: biggestRisks.slice(0, 4),
    keyVariables: sorted.slice(0, 8).map((f) => ({ ...f, impactPct: round(f.impactPct, 2) })),
    confidenceLevel: confidenceLevelOf(p.confidence),
    dataCoverage: [
      { factor: 'Elo & FIFA rankings', status: 'measured', source: 'eloratings.net / FIFA (Apr 2026)' },
      { factor: 'Head-to-head & recent form', status: 'measured', source: '47k historical internationals' },
      { factor: 'Squads, caps, goals, age', status: 'measured', source: 'official FIFA squad lists' },
      { factor: 'Injuries & fitness', status: 'measured', source: 'platform availability records' },
      { factor: 'Travel, rest, time zones', status: 'measured', source: 'official schedule + venue geography' },
      { factor: 'Venue altitude & climate', status: 'measured', source: 'venue reference data (climatology, not forecast)' },
      { factor: 'Tactical styles', status: 'proxy', source: 'manager style model derived from team profiles' },
      { factor: 'Club-season xG/xA', status: 'unavailable', source: 'no licensed club data feed configured — international scoring rates used instead' },
      { factor: 'Live team news', status: 'unavailable', source: 'no external news feed configured — only verified platform records used' },
    ],
  };
}
