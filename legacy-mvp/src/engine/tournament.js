// Tournament simulation: 8 groups of 4 -> Round of 16 -> QF -> SF -> Final.
//
// Two entry points:
//  - simulateTournamentOnce(): one full run, returns a populated bracket for display.
//  - simulateTournamentMonteCarlo(): many runs, returns per-team stage probabilities.

import { GROUPS, COUNTRY_BY_CODE } from '../data/countries.js';
import { expectedGoals, simulateOneMatch } from './simulation.js';

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

// Cache expected-goals per ordered pair within a run to avoid recompute.
function egCache() {
  const m = new Map();
  return (a, b) => {
    const key = a + b;
    let v = m.get(key);
    if (!v) {
      v = expectedGoals(a, b);
      m.set(key, v);
    }
    return v;
  };
}

function playMatch(a, b, getEg, rng, knockout) {
  const { goalsA, goalsB } = simulateOneMatch(a, b, { _eg: getEg(a, b) }, rng);
  let winner = null;
  let pens = null;
  if (goalsA > goalsB) winner = a;
  else if (goalsB > goalsA) winner = b;
  else if (knockout) {
    // Penalty shootout: weight by team Elo.
    const ea = COUNTRY_BY_CODE[a].elo;
    const eb = COUNTRY_BY_CODE[b].elo;
    const pa = 0.75 + (ea - eb) / 4000;
    let sa = 0;
    let sb = 0;
    for (let i = 0; i < 5; i++) {
      if (rng() < pa) sa++;
      if (rng() < 1 - (pa - 0.75)) sb++; // symmetric-ish
    }
    while (sa === sb) {
      sa += rng() < pa ? 1 : 0;
      sb += rng() < 1 - (pa - 0.75) ? 1 : 0;
    }
    winner = sa > sb ? a : b;
    pens = { a: sa, b: sb };
  }
  return { a, b, goalsA, goalsB, winner, pens };
}

// Simulate the group stage; return standings + top-2 qualifiers per group.
function simulateGroupStage(getEg, rng) {
  const standings = {};
  const qualifiers = {};

  for (const [letter, teams] of Object.entries(GROUPS)) {
    const table = Object.fromEntries(
      teams.map((t) => [t, { code: t, pts: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0 }])
    );
    // Round-robin: every pair plays once.
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        const a = teams[i];
        const b = teams[j];
        const r = playMatch(a, b, getEg, rng, false);
        table[a].gf += r.goalsA; table[a].ga += r.goalsB;
        table[b].gf += r.goalsB; table[b].ga += r.goalsA;
        if (r.goalsA > r.goalsB) { table[a].pts += 3; table[a].w++; table[b].l++; }
        else if (r.goalsB > r.goalsA) { table[b].pts += 3; table[b].w++; table[a].l++; }
        else { table[a].pts++; table[b].pts++; table[a].d++; table[b].d++; }
      }
    }
    const ranked = Object.values(table)
      .map((row) => ({ ...row, gd: row.gf - row.ga }))
      .sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || (rng() - 0.5));
    standings[letter] = ranked;
    qualifiers[letter] = [ranked[0].code, ranked[1].code];
  }
  return { standings, qualifiers };
}

// Standard World Cup R16 cross-bracket pairings.
function buildRound16(qualifiers) {
  const w = (g) => qualifiers[g][0];
  const r = (g) => qualifiers[g][1];
  return [
    [w('A'), r('B')], [w('C'), r('D')], [w('E'), r('F')], [w('G'), r('H')],
    [w('B'), r('A')], [w('D'), r('C')], [w('F'), r('E')], [w('H'), r('G')],
  ];
}

function playRound(pairs, getEg, rng) {
  const results = pairs.map(([a, b]) => playMatch(a, b, getEg, rng, true));
  const winners = results.map((m) => m.winner);
  const nextPairs = [];
  for (let i = 0; i < winners.length; i += 2) nextPairs.push([winners[i], winners[i + 1]]);
  return { results, winners, nextPairs };
}

export function simulateTournamentOnce(seed) {
  const rng = makeRng(seed);
  const getEg = egCache();
  const { standings, qualifiers } = simulateGroupStage(getEg, rng);

  const r16pairs = buildRound16(qualifiers);
  const r16 = playRound(r16pairs, getEg, rng);
  const qf = playRound(r16.nextPairs, getEg, rng);
  const sf = playRound(qf.nextPairs, getEg, rng);
  const finalMatch = playMatch(sf.winners[0], sf.winners[1], getEg, rng, true);

  // Third place playoff between the two semi-final losers.
  const sfLosers = sf.results.map((m) => (m.winner === m.a ? m.b : m.a));
  const thirdPlace = playMatch(sfLosers[0], sfLosers[1], getEg, rng, true);

  return {
    standings,
    qualifiers,
    rounds: {
      round16: r16.results,
      quarterfinal: qf.results,
      semifinal: sf.results,
      final: finalMatch,
      thirdPlace,
    },
    champion: finalMatch.winner,
    runnerUp: finalMatch.winner === finalMatch.a ? finalMatch.b : finalMatch.a,
    thirdPlaceTeam: thirdPlace.winner,
  };
}

// Run many tournaments and aggregate how often each team reaches each stage.
export function simulateTournamentMonteCarlo(runs = 2000, onProgress) {
  const codes = Object.values(GROUPS).flat();
  const stats = Object.fromEntries(
    codes.map((c) => [c, { code: c, r16: 0, qf: 0, sf: 0, final: 0, champion: 0 }])
  );

  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    const result = simulateTournamentOnce((Math.random() * 1e9) | 0);
    // Round of 16 reached = any qualifier.
    for (const [a, b] of Object.values(result.qualifiers)) {
      stats[a].r16++;
      stats[b].r16++;
    }
    for (const m of result.rounds.quarterfinal) { stats[m.a].qf++; stats[m.b].qf++; }
    for (const m of result.rounds.semifinal) { stats[m.a].sf++; stats[m.b].sf++; }
    stats[result.rounds.final.a].final++;
    stats[result.rounds.final.b].final++;
    stats[result.champion].champion++;

    if (onProgress && i % 100 === 0) onProgress(i, runs);
  }
  const duration = performance.now() - t0;

  const pct = (n) => Math.round((n / runs) * 1000) / 10;
  const table = Object.values(stats)
    .map((s) => ({
      code: s.code,
      r16: pct(s.r16),
      qf: pct(s.qf),
      sf: pct(s.sf),
      final: pct(s.final),
      champion: pct(s.champion),
    }))
    .sort((a, b) => b.champion - a.champion || b.final - a.final);

  return { runs, durationMs: Math.round(duration), table };
}
