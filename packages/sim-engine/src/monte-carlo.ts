import type { StageProbabilities, TournamentSimResult } from '@fifa/shared';
import { round, wilsonInterval } from '@fifa/shared';
import { deriveSeed } from './rng';
import { runTournament, type TournamentInputs } from './tournament';

export interface MonteCarloOptions {
  runs: number;
  seed: number;
  onProgress?: (done: number, total: number) => void;
  /** yields to the event loop every N runs so the API stays responsive */
  yieldEvery?: number;
}

export interface MonteCarloExtras {
  championCI: Record<string, { low: number; high: number }>;
  finalPairs: Array<{ teams: [string, string]; count: number }>;
}

export async function runMonteCarlo(
  inputs: TournamentInputs,
  opts: MonteCarloOptions,
): Promise<TournamentSimResult & { extras: MonteCarloExtras }> {
  const start = Date.now();
  const runs = Math.max(1, opts.runs);
  const codes = [...inputs.teams.keys()];

  const championCount = new Map<string, number>(codes.map((c) => [c, 0]));
  const reachedCounts = new Map<string, number[]>(codes.map((c) => [c, [0, 0, 0, 0, 0, 0, 0]]));
  const groupWinCount = new Map<string, number>(codes.map((c) => [c, 0]));
  const finalPairCount = new Map<string, number>();
  const scorerTotals = new Map<number, { name: string; team: string; goals: number; boots: number }>();
  let sample: ReturnType<typeof runTournament> | null = null;

  // each run is a full 104-match tournament (~tens of ms, slower on small
  // cloud CPUs) — yield after every run or concurrent requests stall
  const yieldEvery = opts.yieldEvery ?? 1;

  for (let i = 0; i < runs; i++) {
    const run = runTournament(inputs, { seed: deriveSeed(opts.seed, i) });
    if (i === 0) sample = run;

    championCount.set(run.champion, (championCount.get(run.champion) ?? 0) + 1);

    for (const [code, level] of run.reached) {
      const arr = reachedCounts.get(code)!;
      for (let l = 0; l <= level; l++) arr[l]++;
    }
    for (const standings of Object.values(run.groupStandings)) {
      groupWinCount.set(standings[0].team, (groupWinCount.get(standings[0].team) ?? 0) + 1);
    }

    const finalists = [run.champion, run.runnerUp].sort() as [string, string];
    const fKey = finalists.join('-');
    finalPairCount.set(fKey, (finalPairCount.get(fKey) ?? 0) + 1);

    let bootGoals = 0;
    let bootId = -1;
    for (const [pid, v] of run.scorerGoals) {
      const cur = scorerTotals.get(pid) ?? { name: v.name, team: v.team, goals: 0, boots: 0 };
      cur.goals += v.goals;
      scorerTotals.set(pid, cur);
      if (v.goals > bootGoals) {
        bootGoals = v.goals;
        bootId = pid;
      }
    }
    if (bootId >= 0) scorerTotals.get(bootId)!.boots++;

    if (opts.onProgress && (i + 1) % Math.max(1, Math.floor(runs / 100)) === 0) {
      opts.onProgress(i + 1, runs);
    }
    if ((i + 1) % yieldEvery === 0) {
      await new Promise((r) => setImmediate(r));
    }
  }

  const stageProbabilities: StageProbabilities[] = codes
    .map((code) => {
      const a = reachedCounts.get(code)!;
      return {
        team: code,
        reachR32: round(a[1] / runs, 4),
        reachR16: round(a[2] / runs, 4),
        reachQF: round(a[3] / runs, 4),
        reachSF: round(a[4] / runs, 4),
        reachFinal: round(a[5] / runs, 4),
        champion: round((championCount.get(code) ?? 0) / runs, 4),
        winGroup: round((groupWinCount.get(code) ?? 0) / runs, 4),
        exitGroupStage: round(1 - a[1] / runs, 4),
      };
    })
    .sort((x, y) => y.champion - x.champion || y.reachFinal - x.reachFinal);

  const champion: Record<string, number> = {};
  const championCI: Record<string, { low: number; high: number }> = {};
  for (const [code, n] of championCount) {
    if (n > 0) {
      champion[code] = round(n / runs, 4);
      championCI[code] = wilsonInterval(n, runs);
    }
  }

  const finalPairs = [...finalPairCount.entries()]
    .map(([k, count]) => ({ teams: k.split('-') as [string, string], count }))
    .sort((a, b) => b.count - a.count);

  const goldenBoot = [...scorerTotals.entries()]
    .map(([playerId, v]) => ({
      playerId,
      name: v.name,
      team: v.team,
      avgGoals: round(v.goals / runs, 2),
      topScorerShare: round(v.boots / runs, 4),
    }))
    .sort((a, b) => b.topScorerShare - a.topScorerShare || b.avgGoals - a.avgGoals)
    .slice(0, 15);

  // Surprise team: biggest overperformance vs Elo-implied expectation
  const eloSorted = codes.map((c) => inputs.teams.get(c)!).sort((a, b) => b.elo - a.elo);
  const eloRank = new Map(eloSorted.map((t, i) => [t.code, i + 1]));
  let surprise: TournamentSimResult['surpriseTeam'] = null;
  let bestDelta = 0;
  for (const code of codes) {
    const rank = eloRank.get(code)!;
    if (rank <= 12) continue;
    const a = reachedCounts.get(code)!;
    const avgLevel = a.reduce((acc, n, lvl) => (lvl >= 1 ? acc + n / runs : acc), 0);
    const expected = Math.max(0.4, 2.6 - rank * 0.05);
    const delta = avgLevel - expected;
    if (delta > bestDelta) {
      bestDelta = delta;
      surprise = { team: code, expectedRoundIndex: round(avgLevel, 2), seedRank: rank };
    }
  }

  const top8 = new Set(eloSorted.slice(0, 8).map((t) => t.code));
  let upsetRuns = 0;
  for (const [code, n] of championCount) {
    if (!top8.has(code)) upsetRuns += n;
  }

  const sampleRun = sample!;
  return {
    runs,
    durationMs: Date.now() - start,
    champion,
    stageProbabilities,
    mostLikelyFinal: finalPairs.length
      ? { teams: finalPairs[0].teams, probability: round(finalPairs[0].count / runs, 4) }
      : { teams: ['', ''], probability: 0 },
    goldenBoot,
    surpriseTeam: surprise,
    upsetProbability: round(upsetRuns / runs, 4),
    sampleRun: {
      groupStandings: sampleRun.groupStandings,
      thirdPlaceRanking: sampleRun.thirdPlaceRanking,
      qualifiedThirds: sampleRun.qualifiedThirds,
      knockoutResults: sampleRun.knockoutResults,
      champion: sampleRun.champion,
      runnerUp: sampleRun.runnerUp,
      thirdPlace: sampleRun.thirdPlace,
      goldenBoot: sampleRun.goldenBoot,
    },
    extras: { championCI, finalPairs: finalPairs.slice(0, 10) },
  };
}
