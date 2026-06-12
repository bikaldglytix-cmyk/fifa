import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { countries, matches, modelState, predictionSnapshots, simulations } from '@fifa/db';
import type { AiPredictionV2, StageProbabilities, TournamentSimResult } from '@fifa/shared';
import { MODEL_VERSION, randomSeed, runMonteCarlo } from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EventBusService } from '../common/event-bus.service';
import { EngineDataService } from '../engine/engine-data.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { LiveGateway } from '../live/live.gateway';

/**
 * Model lifecycle: every verified result automatically retrains the rating
 * state (Elo K=60 World Cup updates, form windows), scores the model's own
 * pre-match prediction (Brier/log-loss calibration history), regenerates
 * affected prediction snapshots, and refreshes the tournament-level forecast
 * (qualification probabilities, power rankings). Retractions reverse every
 * step exactly using the persisted delta ledger.
 */

const ELO_K_WORLD_CUP = 60;

interface CalibrationState {
  /** per-match Elo deltas applied, for exact reversal on retraction */
  eloDeltas: Record<string, { home: string; away: string; deltaHome: number; deltaAway: number }>;
  /** model scoring history */
  history: Array<{ matchNumber: number; brier: number; logLoss: number; predicted: string; actual: string; at: string }>;
  brierMean: number | null;
}

@Injectable()
export class ModelService implements OnModuleInit {
  private readonly logger = new Logger(ModelService.name);
  private forecast: (TournamentSimResult & { computedAt: string }) | null = null;
  private forecastTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly bus: EventBusService,
    private readonly engineData: EngineDataService,
    private readonly intelligence: IntelligenceService,
    private readonly live: LiveGateway,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  onModuleInit(): void {
    this.bus.on('match.completed', (e) => this.onMatchCompleted(e));
    this.bus.on('match.retracted', (e) => this.onMatchRetracted(e));
    if (process.env.DISABLE_SCHEDULER !== 'true') {
      // initial tournament forecast shortly after boot (data is ready by then)
      setTimeout(() => void this.refreshForecast('boot').catch((e) => this.logger.warn(`forecast failed: ${e}`)), 4_000).unref?.();
    }
  }

  // --- calibration state -------------------------------------------------------

  private async loadCalibration(): Promise<CalibrationState> {
    const [row] = await this.db.select().from(modelState).where(eq(modelState.id, 1));
    if (row) return row.calibration as CalibrationState;
    const fresh: CalibrationState = { eloDeltas: {}, history: [], brierMean: null };
    await this.db.insert(modelState).values({ id: 1, modelVersion: MODEL_VERSION, calibration: fresh as never }).onConflictDoNothing();
    return fresh;
  }

  private async saveCalibration(cal: CalibrationState): Promise<void> {
    cal.brierMean = cal.history.length
      ? cal.history.reduce((a, h) => a + h.brier, 0) / cal.history.length
      : null;
    await this.db
      .update(modelState)
      .set({ modelVersion: MODEL_VERSION, calibration: cal as never, updatedAt: new Date() })
      .where(eq(modelState.id, 1));
  }

  async calibration(): Promise<{ modelVersion: number; brierMean: number | null; scored: number; recent: CalibrationState['history'] }> {
    const cal = await this.loadCalibration();
    return { modelVersion: MODEL_VERSION, brierMean: cal.brierMean, scored: cal.history.length, recent: cal.history.slice(-20) };
  }

  // --- completion pipeline --------------------------------------------------------

  private async onMatchCompleted(e: { matchNumber: number; homeCode: string; awayCode: string; homeScore: number; awayScore: number }): Promise<void> {
    const cal = await this.loadCalibration();

    // 1. score our own pre-match prediction (calibration history)
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, e.matchNumber));
    const [snap] = await this.db
      .select()
      .from(predictionSnapshots)
      .where(and(eq(predictionSnapshots.matchId, m.id)))
      .orderBy(desc(predictionSnapshots.computedAt))
      .limit(1);
    if (snap) {
      const p = snap.prediction as AiPredictionV2;
      const outcome = e.homeScore > e.awayScore ? 'home' : e.homeScore < e.awayScore ? 'away' : 'draw';
      const probs = { home: p.homeWin, draw: p.draw, away: p.awayWin };
      const brier =
        (probs.home - (outcome === 'home' ? 1 : 0)) ** 2 +
        (probs.draw - (outcome === 'draw' ? 1 : 0)) ** 2 +
        (probs.away - (outcome === 'away' ? 1 : 0)) ** 2;
      const logLoss = -Math.log(Math.max(1e-9, probs[outcome]));
      cal.history.push({
        matchNumber: e.matchNumber,
        brier: Number(brier.toFixed(4)),
        logLoss: Number(logLoss.toFixed(4)),
        predicted: `${p.predictedScore.home}-${p.predictedScore.away}`,
        actual: `${e.homeScore}-${e.awayScore}`,
        at: new Date().toISOString(),
      });
    }

    // 2. Elo update (World Cup K, goal-difference multiplier — eloratings.net rules)
    const [homeRow] = await this.db.select().from(countries).where(eq(countries.code, e.homeCode));
    const [awayRow] = await this.db.select().from(countries).where(eq(countries.code, e.awayCode));
    if (homeRow && awayRow) {
      const expectedHome = 1 / (1 + Math.pow(10, (awayRow.eloRating - homeRow.eloRating) / 400));
      const actualHome = e.homeScore > e.awayScore ? 1 : e.homeScore === e.awayScore ? 0.5 : 0;
      const gd = Math.abs(e.homeScore - e.awayScore);
      const gMult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
      const delta = Math.round(ELO_K_WORLD_CUP * gMult * (actualHome - expectedHome));
      await this.db.update(countries).set({ eloRating: homeRow.eloRating + delta }).where(eq(countries.code, e.homeCode));
      await this.db.update(countries).set({ eloRating: awayRow.eloRating - delta }).where(eq(countries.code, e.awayCode));
      cal.eloDeltas[String(e.matchNumber)] = { home: e.homeCode, away: e.awayCode, deltaHome: delta, deltaAway: -delta };
      this.logger.log(`Elo updated: ${e.homeCode} ${delta >= 0 ? '+' : ''}${delta}, ${e.awayCode} ${-delta >= 0 ? '+' : ''}${-delta}`);
    }

    // 3. form windows (newest first), tagged for exact reversal
    await this.applyFormEntry(e.homeCode, e.matchNumber, e.homeScore, e.awayScore, e.awayCode);
    await this.applyFormEntry(e.awayCode, e.matchNumber, e.awayScore, e.homeScore, e.homeCode);

    await this.saveCalibration(cal);
    await this.engineData.refresh();

    // 4. regenerate predictions for affected upcoming matches + tournament forecast
    await this.intelligence.recomputeForTeams([e.homeCode, e.awayCode], 'result_ingested');
    this.bus.emit('model.recalibrated', { modelVersion: MODEL_VERSION, trigger: 'result_ingested', affectedTeams: [e.homeCode, e.awayCode] });
    this.live.broadcastPredictionsUpdated({ trigger: 'result_ingested', matchNumber: e.matchNumber });
    this.scheduleForecastRefresh('result_ingested');
  }

  private async onMatchRetracted(e: { matchNumber: number; reason: string }): Promise<void> {
    const cal = await this.loadCalibration();

    // reverse Elo exactly
    const delta = cal.eloDeltas[String(e.matchNumber)];
    if (delta) {
      const [homeRow] = await this.db.select().from(countries).where(eq(countries.code, delta.home));
      const [awayRow] = await this.db.select().from(countries).where(eq(countries.code, delta.away));
      if (homeRow) await this.db.update(countries).set({ eloRating: homeRow.eloRating - delta.deltaHome }).where(eq(countries.code, delta.home));
      if (awayRow) await this.db.update(countries).set({ eloRating: awayRow.eloRating - delta.deltaAway }).where(eq(countries.code, delta.away));
      delete cal.eloDeltas[String(e.matchNumber)];
    }

    // remove the calibration sample + form entries for this match
    cal.history = cal.history.filter((h) => h.matchNumber !== e.matchNumber);
    const affected: string[] = [];
    if (delta) {
      await this.removeFormEntry(delta.home, e.matchNumber);
      await this.removeFormEntry(delta.away, e.matchNumber);
      affected.push(delta.home, delta.away);
    }

    await this.saveCalibration(cal);
    await this.engineData.refresh();
    await this.intelligence.recomputeForTeams(affected, 'retraction');
    this.bus.emit('model.recalibrated', { modelVersion: MODEL_VERSION, trigger: 'retraction', affectedTeams: affected });
    this.live.broadcastPredictionsUpdated({ trigger: 'retraction', matchNumber: e.matchNumber });
    this.scheduleForecastRefresh('retraction');
  }

  private async applyFormEntry(code: string, matchNumber: number, gf: number, ga: number, opponent: string): Promise<void> {
    const [row] = await this.db.select().from(countries).where(eq(countries.code, code));
    if (!row) return;
    const profile: any = row.profile ?? {};
    const recentForm: any[] = Array.isArray(profile.recentForm) ? profile.recentForm : [];
    recentForm.unshift({
      result: gf > ga ? 'W' : gf === ga ? 'D' : 'L',
      gf, ga, opponent,
      date: new Date().toISOString().slice(0, 10),
      source: 'tournament',
      matchNumber,
    });
    await this.db.update(countries).set({ profile: { ...profile, recentForm: recentForm.slice(0, 15) } }).where(eq(countries.code, code));
  }

  private async removeFormEntry(code: string, matchNumber: number): Promise<void> {
    const [row] = await this.db.select().from(countries).where(eq(countries.code, code));
    if (!row) return;
    const profile: any = row.profile ?? {};
    const recentForm: any[] = Array.isArray(profile.recentForm) ? profile.recentForm : [];
    await this.db
      .update(countries)
      .set({ profile: { ...profile, recentForm: recentForm.filter((f) => f.matchNumber !== matchNumber) } })
      .where(eq(countries.code, code));
  }

  // --- tournament-level forecast (qualification probabilities, power rankings) ------

  private scheduleForecastRefresh(trigger: string): void {
    if (process.env.DISABLE_SCHEDULER === 'true') return; // ops/tests refresh explicitly
    if (this.forecastTimer) clearTimeout(this.forecastTimer);
    this.forecastTimer = setTimeout(() => void this.refreshForecast(trigger).catch((e) => this.logger.warn(`forecast: ${e}`)), 1_500);
    this.forecastTimer.unref?.();
  }

  async refreshForecast(trigger: string): Promise<void> {
    const runs = Number(process.env.SYSTEM_FORECAST_RUNS ?? 2_000);
    const started = Date.now();
    const result = await runMonteCarlo(this.engineData.tournamentInputs(), { runs, seed: randomSeed() >>> 0 });
    this.forecast = { ...result, computedAt: new Date().toISOString() };
    await this.db.insert(simulations).values({
      userId: null,
      simulationType: 'monte_carlo',
      config: { system: true, trigger, runs, modelVersion: MODEL_VERSION } as never,
      results: { stageProbabilities: result.stageProbabilities, champion: result.champion, computedAt: this.forecast.computedAt } as never,
      seed: 0,
      durationMs: result.durationMs,
      simulationCount: runs,
    });
    this.logger.log(`tournament forecast refreshed (${trigger}): ${runs} runs in ${Date.now() - started}ms`);
  }

  async systemForecast(): Promise<(TournamentSimResult & { computedAt: string }) | null> {
    if (this.forecast) return this.forecast;
    // fall back to the latest persisted system forecast (e.g. right after boot)
    const rows = await this.db
      .select()
      .from(simulations)
      .where(eq(simulations.simulationType, 'monte_carlo'))
      .orderBy(desc(simulations.createdAt))
      .limit(10);
    const system = rows.find((r) => (r.config as any)?.system);
    if (!system) return null;
    return { ...(system.results as never as TournamentSimResult), computedAt: (system.results as any).computedAt } as never;
  }

  /** Power rankings: Elo (55%) + tournament forecast (35%) + form (10%). */
  async powerRankings(): Promise<Array<{ rank: number; team: string; name: string; score: number; elo: number; champion: number; reachSF: number; form: string; delta: 'up' | 'down' | 'flat' }>> {
    const forecast = await this.systemForecast();
    const byTeam = new Map<string, StageProbabilities>((forecast?.stageProbabilities ?? []).map((s) => [s.team, s]));
    const teams = this.engineData.allTeams();
    const maxElo = Math.max(...teams.map((t) => t.elo));
    const minElo = Math.min(...teams.map((t) => t.elo));

    const scored = teams.map((t) => {
      const sp = byTeam.get(t.code);
      const eloNorm = (t.elo - minElo) / Math.max(1, maxElo - minElo);
      const champ = sp?.champion ?? 0;
      const sf = sp?.reachSF ?? 0;
      const score = eloNorm * 55 + Math.min(1, champ * 4) * 25 + Math.min(1, sf * 2.5) * 10 + ((t.form.score + 1) / 2) * 10;
      return {
        team: t.code,
        name: t.name,
        score: Number(score.toFixed(1)),
        elo: t.elo,
        champion: champ,
        reachSF: sf,
        form: t.form.results.slice(0, 5),
        fifaRanking: t.fifaRanking,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s, i) => ({
      rank: i + 1,
      ...s,
      delta: s.fifaRanking > i + 1 ? 'up' : s.fifaRanking < i + 1 ? 'down' : 'flat',
    }));
  }

  /** Per-team qualification & progression probabilities from the live forecast. */
  async qualification(): Promise<{ computedAt: string | null; runs: number | null; teams: StageProbabilities[] }> {
    const forecast = await this.systemForecast();
    return {
      computedAt: forecast?.computedAt ?? null,
      runs: forecast?.runs ?? null,
      teams: forecast?.stageProbabilities ?? [],
    };
  }
}
