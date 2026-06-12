import {
  ROLE_GOAL_MULTIPLIER,
  STAGE_LABELS,
  clamp,
  round,
  type AiPrediction,
  type AiPredictionV2,
  type FactorContribution,
  type MatchProbabilities,
  type OutcomeUncertainty,
} from '@fifa/shared';
import { poissonPmf } from './rng';
import { computeStrength, type LambdaBreakdown, type MatchInputs } from './strength';
import { styleMatchupFactor } from './managers';
import { compareTactics, keyBattles } from './tactics';
import { assessUpset } from './upset';
import { buildExplanation } from './explain';
import { DEFAULT_CONFIG, type EngineConfig } from './types';

/** Bumped whenever factor weights or model structure change. */
export const MODEL_VERSION = 2;

const MAX_GOALS = 8;

/** Dixon-Coles low-score adjustment factor τ. */
function tau(x: number, y: number, lambdaX: number, lambdaY: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambdaX * lambdaY * rho;
  if (x === 0 && y === 1) return 1 + lambdaX * rho;
  if (x === 1 && y === 0) return 1 + lambdaY * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Analytic match probabilities from the same strength model the simulator
 * samples from — Dixon-Coles corrected score matrix + Elo win expectation,
 * blended into a calibrated ensemble.
 */
export function predictMatch(inputs: MatchInputs, config?: Partial<EngineConfig>): AiPredictionV2 {
  const cfg: EngineConfig = { ...DEFAULT_CONFIG, ...config };
  const { lambdaHome, lambdaAway, homeLineup, awayLineup } = computeStrength(inputs, cfg);
  const lh = lambdaHome.lambda;
  const la = lambdaAway.lambda;

  // --- Dixon-Coles score matrix ----------------------------------------------
  const matrix: number[][] = [];
  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    matrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(h, lh) * poissonPmf(a, la) * tau(h, a, lh, la, cfg.dixonColesRho);
      matrix[h][a] = Math.max(0, p);
      total += matrix[h][a];
    }
  }
  for (let h = 0; h <= MAX_GOALS; h++) for (let a = 0; a <= MAX_GOALS; a++) matrix[h][a] /= total;

  let dcHome = 0;
  let dcDraw = 0;
  let dcAway = 0;
  let btts = 0;
  let over25 = 0;
  let bestH = 0;
  let bestA = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = matrix[h][a];
      if (h > a) dcHome += p;
      else if (h === a) dcDraw += p;
      else dcAway += p;
      if (h >= 1 && a >= 1) btts += p;
      if (h + a >= 3) over25 += p;
      if (p > matrix[bestH][bestA]) {
        bestH = h;
        bestA = a;
      }
    }
  }

  // --- Elo model -------------------------------------------------------------
  const dr = lambdaHome.effectiveElo - lambdaAway.effectiveElo;
  const eloHomeNoDraw = 1 / (1 + Math.pow(10, -dr / 400));
  // empirical draw rate in internationals ~25%, shrinking with |dr|
  const drawRate = 0.27 * Math.exp(-Math.abs(dr) / 500);
  const eloHome = eloHomeNoDraw * (1 - drawRate);
  const eloAway = (1 - eloHomeNoDraw) * (1 - drawRate);

  // --- form micro-model --------------------------------------------------------
  const formEdge = clamp((inputs.home.form.score - inputs.away.form.score) * 0.5, -0.2, 0.2);
  const formHome = clamp(dcHome + formEdge * 0.3, 0.02, 0.96);
  const formAway = clamp(dcAway - formEdge * 0.3, 0.02, 0.96);
  const formDraw = Math.max(0.02, 1 - formHome - formAway);

  // --- ensemble (weights per PRD: ensemble of models) ---------------------------
  const W = { dc: 0.55, elo: 0.3, form: 0.15 };
  let pHome = W.dc * dcHome + W.elo * eloHome + W.form * formHome;
  let pDraw = W.dc * dcDraw + W.elo * drawRate + W.form * formDraw;
  let pAway = W.dc * dcAway + W.elo * eloAway + W.form * formAway;
  const norm = pHome + pDraw + pAway;
  pHome /= norm;
  pDraw /= norm;
  pAway /= norm;

  // model agreement drives confidence
  const spread =
    Math.abs(dcHome - eloHome) + Math.abs(dcAway - eloAway) + Math.abs(formHome - dcHome);
  const edge = Math.max(pHome, pDraw, pAway);
  const confidence = round(clamp(34 + edge * 62 - spread * 40, 20, 96), 1);

  // --- likely scorers --------------------------------------------------------------
  const likelyScorers = [
    ...homeLineup.assignments.map((a) => ({ a, team: inputs.home.code, teamLambda: lh, lineup: homeLineup })),
    ...awayLineup.assignments.map((a) => ({ a, team: inputs.away.code, teamLambda: la, lineup: awayLineup })),
  ]
    .map(({ a, team, teamLambda, lineup }) => {
      const weightTotal = lineup.assignments.reduce(
        (acc, x) =>
          acc +
          ROLE_GOAL_MULTIPLIER[x.slot.role] *
            (0.5 + x.player.rating / 100) *
            (0.5 + 4 * (x.player.internationalGoals / Math.max(8, x.player.caps))),
        0,
      );
      const w =
        ROLE_GOAL_MULTIPLIER[a.slot.role] *
        (0.5 + a.player.rating / 100) *
        (0.5 + 4 * (a.player.internationalGoals / Math.max(8, a.player.caps)));
      const expGoals = (w / weightTotal) * teamLambda;
      return {
        playerId: a.player.id,
        name: a.player.name,
        team,
        probability: round(1 - Math.exp(-expGoals), 4), // P(scores ≥ 1)
      };
    })
    .sort((x, y) => y.probability - x.probability)
    .slice(0, 6);

  const probabilities: MatchProbabilities = {
    homeWin: round(pHome, 4),
    draw: round(pDraw, 4),
    awayWin: round(pAway, 4),
    expectedHomeGoals: round(lh, 2),
    expectedAwayGoals: round(la, 2),
    mostLikelyScore: { home: bestH, away: bestA, probability: round(matrix[bestH][bestA], 4) },
    scoreMatrix: matrix.map((row) => row.map((p) => round(p, 5))),
    bttsProbability: round(btts, 4),
    over25Probability: round(over25, 4),
    confidence,
  };

  // --- v2 intelligence ---------------------------------------------------------
  const ledger = buildFactorLedger(inputs, lambdaHome, lambdaAway);
  const tactics = compareTactics(inputs.home, homeLineup, inputs.away, awayLineup);
  const battles = keyBattles(inputs.home, homeLineup, inputs.away, awayLineup);
  const upset = assessUpset({
    home: inputs.home,
    away: inputs.away,
    pHome,
    pDraw,
    pAway,
    homeLineup,
    awayLineup,
    homeFatigue: inputs.extras?.homeFatigue ?? null,
    awayFatigue: inputs.extras?.awayFatigue ?? null,
    knockout: inputs.ctx.knockout,
    h2h: inputs.h2h,
  });
  const fatigue =
    inputs.extras?.homeFatigue && inputs.extras?.awayFatigue
      ? { home: inputs.extras.homeFatigue, away: inputs.extras.awayFatigue }
      : null;
  const explanation = buildExplanation({ inputs, probabilities, ledger, upset, fatigue });

  // Uncertainty: ensemble disagreement + Monte Carlo sampling error (n=10k).
  const mcN = 10_000;
  const ci = (p: number, members: number[]): [number, number] => {
    const spread = Math.max(...members.map((m) => Math.abs(m - p)));
    const half = spread * 0.8 + 1.96 * Math.sqrt((p * (1 - p)) / mcN);
    return [round(clamp(p - half, 0, 1), 4), round(clamp(p + half, 0, 1), 4)];
  };
  const uncertainty: OutcomeUncertainty = {
    homeWin: ci(pHome, [dcHome, eloHome, formHome]),
    draw: ci(pDraw, [dcDraw, drawRate, formDraw]),
    awayWin: ci(pAway, [dcAway, eloAway, formAway]),
    method: 'ensemble model spread + binomial sampling error',
    samples: mcN,
  };

  return {
    ...probabilities,
    predictedScore: { home: bestH, away: bestA },
    likelyScorers,
    insights: buildInsights(inputs, probabilities, { dcHome, eloHome, formEdge }),
    modelBreakdown: { elo: round(eloHome, 4), dixonColes: round(dcHome, 4), form: round(formHome, 4) },
    modelVersion: MODEL_VERSION,
    conditions: inputs.extras?.conditions?.info ?? null,
    fatigue,
    tactics,
    keyBattles: battles,
    psychology:
      inputs.extras?.homePsych && inputs.extras?.awayPsych
        ? { home: inputs.extras.homePsych.assessment, away: inputs.extras.awayPsych.assessment }
        : null,
    upset,
    explanation,
    uncertainty,
  };
}

/**
 * Factor ledger: each model component expressed as how far it tilts the
 * home:away expected-goal ratio, in percent. Transparent inputs for the
 * explainability engine.
 */
function buildFactorLedger(
  inputs: MatchInputs,
  home: LambdaBreakdown,
  away: LambdaBreakdown,
): FactorContribution[] {
  const { home: h, away: a } = inputs;
  const entry = (factor: string, ratio: number, note: (lean: 'home' | 'away', pct: number) => string): FactorContribution => {
    const impactPct = (ratio - 1) * 100;
    const leans = impactPct > 0.5 ? 'home' : impactPct < -0.5 ? 'away' : 'neutral';
    const pct = Math.abs(round(impactPct, 1));
    return {
      factor,
      leans,
      impactPct: round(impactPct, 2),
      note: leans === 'neutral' ? `${factor}: effectively even between these sides` : note(leans, pct),
    };
  };
  const name = (lean: 'home' | 'away') => (lean === 'home' ? h.name : a.name);

  return [
    entry('Elo rating gap', home.eloComponent / away.eloComponent, (l, p) =>
      `${name(l)} carry a ${Math.abs(h.elo - a.elo)}-point Elo edge (${l === 'home' ? h.elo : a.elo} vs ${l === 'home' ? a.elo : h.elo}) — worth ~${p}% on expected goals`),
    entry('Recent form', home.formFactor / away.formFactor, (l, p) =>
      `${name(l)} are in better form (${(l === 'home' ? h : a).form.results.slice(0, 5)}…) — ${p}% tilt`),
    entry('Starting XI quality', home.lineupFactor / away.lineupFactor, (l, p) =>
      `${name(l)}'s available XI rates stronger relative to squad baseline (+${p}%)`),
    entry('Coaching matchup', home.managerFactor.total / away.managerFactor.total, (l, p) =>
      `${name(l)}'s bench wins the tactical chess match (style, pressure record, h2h) — ${p}%`),
    entry('Venue conditions', home.conditionsFactor / away.conditionsFactor, (l, p) =>
      `Conditions (altitude/heat) favour ${name(l)} by ~${p}%`),
    entry('Squad freshness', home.fatigueFactor / away.fatigueFactor, (l, p) =>
      `${name(l)} are the fresher squad (rest, travel, congestion) — ${p}%`),
    entry('Psychology', home.psychFactor / away.psychFactor, (l, p) =>
      `Mental edge (momentum, pressure, stakes) leans ${name(l)} (+${p}%)`),
    entry('Host advantage', (home.hostBonusApplied ? 1.04 : 1) / (away.hostBonusApplied ? 1.04 : 1), (l) =>
      `${name(l)} play this one on home soil — crowd and familiarity priced in`),
  ].filter((f) => f.leans !== 'neutral' || Math.abs(f.impactPct) > 0.2);
}

function buildInsights(
  inputs: MatchInputs,
  p: MatchProbabilities,
  models: { dcHome: number; eloHome: number; formEdge: number },
): string[] {
  const { home, away, ctx, h2h } = inputs;
  const out: string[] = [];
  const fav = p.homeWin >= p.awayWin ? home : away;
  const dog = fav === home ? away : home;
  const favP = Math.max(p.homeWin, p.awayWin);

  out.push(
    favP > 0.62
      ? `${fav.name} are strong favourites (${(favP * 100).toFixed(0)}%) — the model expects ${p.expectedHomeGoals.toFixed(1)}–${p.expectedAwayGoals.toFixed(1)} expected goals.`
      : favP > 0.45
        ? `${fav.name} hold a meaningful edge (${(favP * 100).toFixed(0)}% vs ${((fav === home ? p.awayWin : p.homeWin) * 100).toFixed(0)}%), but this is far from decided.`
        : `Coin-flip territory: no side clears 45% — a classic ${STAGE_LABELS[ctx.stage].toLowerCase()} knife-edge.`,
  );

  const rankGap = Math.abs(home.fifaRanking - away.fifaRanking);
  if (rankGap >= 25) {
    out.push(
      `Ranking mismatch: ${fav.name} (#${fav.fifaRanking} FIFA) face #${dog.fifaRanking} ${dog.name} — but World Cups have seen bigger shocks; the upset lands ${((1 - favP - p.draw) * 100).toFixed(0)}% of the time here.`,
    );
  }

  if (h2h && h2h.played >= 3) {
    const [c1] = [home.code, away.code].sort();
    const homeWins = c1 === home.code ? h2h.wins1 : h2h.wins2;
    const awayWins = c1 === home.code ? h2h.wins2 : h2h.wins1;
    out.push(
      `Head-to-head: ${h2h.played} meetings — ${home.name} ${homeWins}W, ${away.name} ${awayWins}W, ${h2h.draws} drawn${h2h.lastMeeting ? ` (last: ${h2h.lastMeeting.score} in ${h2h.lastMeeting.date.slice(0, 4)})` : ''}.${h2h.wcMeetings > 0 ? ` ${h2h.wcMeetings} of those came at World Cups.` : ''}`,
    );
  }

  const styleEdgeHome = styleMatchupFactor(home.manager.preferredStyle, away.manager.preferredStyle);
  if (styleEdgeHome > 1.02) {
    out.push(
      `Tactical matchup favours ${home.name}: ${home.manager.name}'s ${home.manager.preferredStyle.replace('_', ' ')} historically troubles ${away.manager.preferredStyle.replace('_', ' ')} setups.`,
    );
  } else if (styleMatchupFactor(away.manager.preferredStyle, home.manager.preferredStyle) > 1.02) {
    out.push(
      `Tactical matchup favours ${away.name}: ${away.manager.name}'s ${away.manager.preferredStyle.replace('_', ' ')} is a bad stylistic draw for ${home.name}.`,
    );
  }

  if (Math.abs(models.formEdge) > 0.05) {
    const inForm = models.formEdge > 0 ? home : away;
    out.push(`${inForm.name} arrive in better form (last 10: ${inForm.form.results}).`);
  }

  if (p.bttsProbability > 0.55) {
    out.push(`Goals expected at both ends — both teams score in ${(p.bttsProbability * 100).toFixed(0)}% of model outcomes.`);
  } else if (p.over25Probability < 0.4) {
    out.push(`A tight, low-scoring contest is the base case (under 2.5 goals ${(100 - p.over25Probability * 100).toFixed(0)}%).`);
  }

  if (ctx.knockout) {
    const pens = home.shootouts.taken + away.shootouts.taken;
    if (p.draw > 0.27) {
      out.push(
        `High draw risk after 90' (${(p.draw * 100).toFixed(0)}%) — extra time and penalties are live scenarios${pens >= 6 ? `; both sides carry real shootout history` : ''}.`,
      );
    }
  }

  return out.slice(0, 5);
}
