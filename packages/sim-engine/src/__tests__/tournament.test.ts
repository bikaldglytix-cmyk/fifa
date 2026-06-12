import { describe, expect, it } from 'vitest';
import { runTournament } from '../tournament';
import { runMonteCarlo } from '../monte-carlo';
import { realTournamentInputs } from './fixtures';

describe('full tournament run (real 2026 data)', () => {
  const inputs = realTournamentInputs();

  it('runs the complete bracket: 12 groups, 32 knockout matches, one champion', () => {
    const run = runTournament(inputs, { seed: 20260611 });

    expect(Object.keys(run.groupStandings)).toHaveLength(12);
    for (const standings of Object.values(run.groupStandings)) {
      expect(standings).toHaveLength(4);
      const totalPoints = standings.reduce((a, r) => a + r.points, 0);
      expect(totalPoints).toBeGreaterThanOrEqual(12); // 6 matches, ≥2 pts per match
      expect(totalPoints).toBeLessThanOrEqual(18);
      for (const row of standings) expect(row.played).toBe(3);
    }

    expect(run.knockoutResults).toHaveLength(32);
    expect(run.qualifiedThirds).toHaveLength(8);
    expect(inputs.teams.has(run.champion)).toBe(true);
    expect(run.runnerUp).not.toBe(run.champion);
    expect(run.goldenBoot).toBeTruthy();
    expect(run.goldenBoot!.goals).toBeGreaterThanOrEqual(3);

    // champion must have won the final
    const final = run.knockoutResults.find((m) => m.stage === 'final')!;
    expect(final.winner).toBe(run.champion);
    // third place winner from match 103
    const bronze = run.knockoutResults.find((m) => m.stage === 'third_place')!;
    expect(bronze.winner).toBe(run.thirdPlace);
  });

  it('is reproducible for the same seed and differs across seeds', () => {
    const a = runTournament(inputs, { seed: 777 });
    const b = runTournament(inputs, { seed: 777 });
    const c = runTournament(inputs, { seed: 778 });
    expect(a.champion).toBe(b.champion);
    expect(JSON.stringify(a.knockoutResults)).toBe(JSON.stringify(b.knockoutResults));
    expect(JSON.stringify(a.knockoutResults)).not.toBe(JSON.stringify(c.knockoutResults));
  });

  it('Monte Carlo aggregation is statistically coherent (300 runs)', async () => {
    const mc = await runMonteCarlo(inputs, { runs: 300, seed: 1234 });

    const championTotal = Object.values(mc.champion).reduce((a, b) => a + b, 0);
    expect(championTotal).toBeCloseTo(1, 1);

    for (const sp of mc.stageProbabilities) {
      expect(sp.reachR32).toBeGreaterThanOrEqual(sp.reachR16);
      expect(sp.reachR16).toBeGreaterThanOrEqual(sp.reachQF);
      expect(sp.reachQF).toBeGreaterThanOrEqual(sp.reachSF);
      expect(sp.reachSF).toBeGreaterThanOrEqual(sp.reachFinal);
      expect(sp.reachFinal).toBeGreaterThanOrEqual(sp.champion);
    }

    // elite sides should clear minnows comfortably
    const get = (code: string) => mc.stageProbabilities.find((s) => s.team === code)!;
    expect(get('ESP').reachQF).toBeGreaterThan(get('CUW').reachQF);
    expect(get('FRA').champion + get('ESP').champion + get('ARG').champion + get('ENG').champion)
      .toBeGreaterThan(0.25);

    expect(mc.goldenBoot.length).toBeGreaterThan(5);
    expect(mc.mostLikelyFinal.probability).toBeGreaterThan(0);
  }, 120_000);
});
