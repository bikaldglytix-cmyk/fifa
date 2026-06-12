import { round } from '@fifa/shared';
import type { SimPlayer } from './types';

/**
 * Player-vs-player matchup analysis (PRD player card: "MATCHUP vs Walker").
 * No public per-duel dataset exists for internationals, so this produces a
 * model-based comparison from the rating components — clearly labeled as such.
 */
export interface MatchupAnalysis {
  player1: { id: number; name: string };
  player2: { id: number; name: string };
  edge: 'player1' | 'player2' | 'even';
  winRateP1: number; // modeled duel-win share
  factors: Array<{ label: string; p1: number; p2: number; advantage: 'player1' | 'player2' | 'even' }>;
  summary: string;
}

export function analyzeMatchup(p1: SimPlayer, p2: SimPlayer): MatchupAnalysis {
  const gpg = (p: SimPlayer) => p.internationalGoals / Math.max(8, p.caps);
  const experience = (p: SimPlayer) => Math.min(100, (p.caps / 150) * 100);
  const peakAge = (p: SimPlayer) => (p.position === 'GK' ? 30 : 27);
  const freshness = (p: SimPlayer) => Math.max(0, 100 - Math.abs(p.age - peakAge(p)) * 7);

  const factors = [
    mkFactor('Overall rating', p1.rating, p2.rating),
    mkFactor('Scoring threat', gpg(p1) * 100, gpg(p2) * 100),
    mkFactor('Experience', experience(p1), experience(p2)),
    mkFactor('Age profile', freshness(p1), freshness(p2)),
    mkFactor('Fitness', p1.fitness, p2.fitness),
  ];

  const score1 = p1.rating * 0.5 + gpg(p1) * 40 + experience(p1) * 0.15 + freshness(p1) * 0.1 + p1.fitness * 0.1;
  const score2 = p2.rating * 0.5 + gpg(p2) * 40 + experience(p2) * 0.15 + freshness(p2) * 0.1 + p2.fitness * 0.1;
  const winRateP1 = round(1 / (1 + Math.exp(-(score1 - score2) / 6)), 3);

  const edge = winRateP1 > 0.55 ? 'player1' : winRateP1 < 0.45 ? 'player2' : 'even';
  const lead = edge === 'player1' ? p1 : p2;
  const leadFactors = factors
    .filter((f) => f.advantage === edge)
    .map((f) => f.label.toLowerCase());

  return {
    player1: { id: p1.id, name: p1.name },
    player2: { id: p2.id, name: p2.name },
    edge,
    winRateP1,
    factors,
    summary:
      edge === 'even'
        ? `Dead-even duel: ${p1.name} and ${p2.name} grade within a whisker on every axis.`
        : `${lead.name} takes this duel ${(Math.max(winRateP1, 1 - winRateP1) * 100).toFixed(0)}% of the time on modeled ${leadFactors.slice(0, 2).join(' and ') || 'overall quality'}.`,
  };
}

function mkFactor(label: string, v1: number, v2: number) {
  const advantage = v1 > v2 * 1.08 ? ('player1' as const) : v2 > v1 * 1.08 ? ('player2' as const) : ('even' as const);
  return { label, p1: round(v1, 1), p2: round(v2, 1), advantage };
}
