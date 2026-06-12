// Match simulation engine (pure JavaScript).
//
// Approach:
//  - Convert each team's Elo + lineup strength into an expected goals value (lambda)
//    using a logistic strength differential blended with a league-average baseline.
//  - Draw goals from a Poisson distribution per simulation.
//  - Aggregate thousands of runs (Monte Carlo) into win/draw/loss probabilities,
//    a scoreline distribution, and the most likely result.

import { COUNTRY_BY_CODE } from '../data/countries.js';
import { teamStrength, getSquad } from '../data/squads.js';

const LEAGUE_AVG_GOALS = 1.35; // baseline expected goals per side in a neutral match

// Sample from a Poisson distribution (Knuth's algorithm) using a supplied rng.
function poisson(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

// Compute expected goals (lambda) for both teams.
// `lineupStrengthA/B` (optional) override the squad-derived strength, letting the
// fantasy lineup builder influence a team's attack.
export function expectedGoals(codeA, codeB, opts = {}) {
  const a = COUNTRY_BY_CODE[codeA];
  const b = COUNTRY_BY_CODE[codeB];
  const strengthA = opts.lineupStrengthA ?? teamStrength(codeA);
  const strengthB = opts.lineupStrengthB ?? teamStrength(codeB);

  // Blend Elo and squad rating into a single power score.
  const powerA = a.elo + (strengthA - 78) * 8;
  const powerB = b.elo + (strengthB - 78) * 8;
  const diff = powerA - powerB;

  // Home/neutral advantage. World Cup matches are mostly neutral venues.
  const homeAdv = opts.homeAdvantage ?? 0;

  // Map the rating differential to an attacking multiplier via a soft logistic.
  const edge = 1 / (1 + Math.exp(-(diff + homeAdv * 60) / 220));
  // edge in (0,1); 0.5 == even. Scale into expected goals around the baseline.
  const lambdaA = LEAGUE_AVG_GOALS * (0.55 + edge);
  const lambdaB = LEAGUE_AVG_GOALS * (0.55 + (1 - edge));

  return {
    lambdaA: clampLambda(lambdaA),
    lambdaB: clampLambda(lambdaB),
    powerA,
    powerB,
  };
}

function clampLambda(v) {
  return Math.max(0.25, Math.min(4.0, v));
}

// mulberry32 PRNG for reproducible-yet-varied simulations.
function makeRng(seed) {
  let a = (seed ?? (Date.now() & 0xffffffff)) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Simulate a single match, returning goals for each side.
export function simulateOneMatch(codeA, codeB, opts = {}, rng = Math.random) {
  const { lambdaA, lambdaB } = opts._eg || expectedGoals(codeA, codeB, opts);
  const goalsA = poisson(lambdaA, rng);
  const goalsB = poisson(lambdaB, rng);
  return { goalsA, goalsB };
}

// Run a Monte Carlo simulation of a single fixture.
export function simulateMatch(codeA, codeB, opts = {}) {
  const runs = opts.simulations ?? 10000;
  const eg = expectedGoals(codeA, codeB, opts);
  const rng = makeRng(opts.seed);

  let winA = 0;
  let winB = 0;
  let draw = 0;
  let totalA = 0;
  let totalB = 0;
  const scoreCounts = new Map();

  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    const { goalsA, goalsB } = simulateOneMatch(codeA, codeB, { _eg: eg }, rng);
    totalA += goalsA;
    totalB += goalsB;
    if (goalsA > goalsB) winA++;
    else if (goalsB > goalsA) winB++;
    else draw++;
    const key = `${goalsA}-${goalsB}`;
    scoreCounts.set(key, (scoreCounts.get(key) || 0) + 1);
  }
  const duration = performance.now() - t0;

  // Most likely scoreline.
  let topScore = '0-0';
  let topCount = 0;
  for (const [k, v] of scoreCounts) {
    if (v > topCount) {
      topCount = v;
      topScore = k;
    }
  }

  const pct = (n) => Math.round((n / runs) * 1000) / 10;
  const [pa, pb] = topScore.split('-').map(Number);

  return {
    codeA,
    codeB,
    simulations: runs,
    homeWin: pct(winA),
    awayWin: pct(winB),
    draw: pct(draw),
    expectedScore: {
      a: Math.round((totalA / runs) * 100) / 100,
      b: Math.round((totalB / runs) * 100) / 100,
    },
    mostLikelyScore: { a: pa, b: pb, probability: pct(topCount) },
    lambdaA: Math.round(eg.lambdaA * 100) / 100,
    lambdaB: Math.round(eg.lambdaB * 100) / 100,
    confidence: confidenceFrom(pct(winA), pct(winB), pct(draw)),
    durationMs: Math.round(duration),
    scoreDistribution: topScores(scoreCounts, runs, 6),
  };
}

function topScores(map, runs, n) {
  return [...map.entries()]
    .map(([k, v]) => ({ score: k, probability: Math.round((v / runs) * 1000) / 10 }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, n);
}

// Confidence = how dominant the most likely outcome is (0..100).
function confidenceFrom(a, b, d) {
  const max = Math.max(a, b, d);
  return Math.round(max);
}

// Pick a plausible goalscorer from a squad weighted by attacking position + rating.
export function pickGoalscorer(code, rng = Math.random) {
  const squad = getSquad(code);
  const weights = squad.map((p) => {
    const posW = { ST: 10, CF: 9, RW: 7, LW: 7, CAM: 6, CM: 4, CDM: 2, RB: 1.5, LB: 1.5, RWB: 1.5, LWB: 1.5, CB: 1, GK: 0.05 };
    return (posW[p.position] || 1) * (p.rating / 80);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  for (let i = 0; i < squad.length; i++) {
    r -= weights[i];
    if (r <= 0) return squad[i];
  }
  return squad[squad.length - 1];
}

// Generate a minute-by-minute goal timeline for a finished scoreline (for flavour).
export function buildGoalTimeline(codeA, codeB, goalsA, goalsB, seed) {
  const rng = makeRng(seed);
  const events = [];
  for (let i = 0; i < goalsA; i++) events.push({ team: codeA, minute: 1 + Math.floor(rng() * 90), scorer: pickGoalscorer(codeA, rng).name });
  for (let i = 0; i < goalsB; i++) events.push({ team: codeB, minute: 1 + Math.floor(rng() * 90), scorer: pickGoalscorer(codeB, rng).name });
  return events.sort((x, y) => x.minute - y.minute);
}
