import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { simulations } from '@fifa/db';
import {
  DEFAULT_MATCH_SIMS,
  SIM_LIMITS,
  round,
  type FormationId,
  type LineupSlotAssignment,
  type UserRole,
} from '@fifa/shared';
import {
  mulberry32,
  deriveSeed,
  predictMatch,
  randomSeed,
  runMonteCarlo,
  simulateMatch,
  type MatchInputs,
} from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import type { AuthUser } from '../common/auth.guard';

export interface SimJob {
  id: string;
  userId: string | null;
  type: 'tournament';
  status: 'running' | 'completed' | 'failed';
  progress: number; // 0..1
  runs: number;
  startedAt: number;
  result?: unknown;
  error?: string;
  simulationId?: string;
  listeners: Set<(ev: { progress: number; status: string }) => void>;
}

@Injectable()
export class SimulationsService {
  /** in-memory async job registry (per instance; jobs are short-lived) */
  private readonly jobs = new Map<string, SimJob>();
  private readonly dailyUse = new Map<string, { date: string; calls: number }>();

  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  private roleOf(user: AuthUser | null): UserRole {
    return user?.role ?? 'guest';
  }

  private enforceLimits(user: AuthUser | null, runs: number): void {
    const role = this.roleOf(user);
    const limits = SIM_LIMITS[role];
    if (runs > limits.maxRunsPerCall) {
      throw new ForbiddenException(
        `${role} accounts are limited to ${limits.maxRunsPerCall.toLocaleString()} simulations per call${role !== 'premium' ? ' — upgrade to premium for more' : ''}`,
      );
    }
    const key = user?.id ?? 'anon';
    const today = new Date().toISOString().slice(0, 10);
    const use = this.dailyUse.get(key);
    const calls = use?.date === today ? use.calls : 0;
    if (calls >= limits.dailyCalls) {
      throw new ForbiddenException(`Daily simulation limit reached (${limits.dailyCalls})`);
    }
    this.dailyUse.set(key, { date: today, calls: calls + 1 });
  }

  // -------------------------------------------------------------------------

  async simulateMatchEndpoint(
    user: AuthUser | null,
    dto: {
      matchNumber?: number;
      homeCode?: string;
      awayCode?: string;
      runs?: number;
      seed?: number;
      knockout?: boolean;
      homeLineup?: { formation: FormationId; startingXi: LineupSlotAssignment[] };
    },
  ) {
    const runs = Math.max(1, dto.runs ?? DEFAULT_MATCH_SIMS);
    this.enforceLimits(user, runs);

    let homeCode: string;
    let awayCode: string;
    let ctxStage: MatchInputs['ctx']['stage'] = 'group';
    let venueCountry: 'USA' | 'MEX' | 'CAN' = 'USA';
    let matchNumber = 0;

    if (dto.matchNumber) {
      const m = this.engineData.scheduledMatch(dto.matchNumber);
      if (m.home.type !== 'team' || m.away.type !== 'team') {
        throw new BadRequestException('Knockout participants not decided yet — simulate the tournament instead');
      }
      homeCode = m.home.code;
      awayCode = m.away.code;
      ctxStage = m.stage;
      venueCountry = this.engineData.venueCountry(m.matchNumber);
      matchNumber = m.matchNumber;
    } else if (dto.homeCode && dto.awayCode) {
      homeCode = dto.homeCode.toUpperCase();
      awayCode = dto.awayCode.toUpperCase();
      if (homeCode === awayCode) throw new BadRequestException('Pick two different teams');
      if (dto.knockout) ctxStage = 'round16';
    } else {
      throw new BadRequestException('Provide matchNumber or homeCode+awayCode');
    }

    const home = dto.homeLineup
      ? this.engineData.teamWithLineup(homeCode, dto.homeLineup.formation, dto.homeLineup.startingXi)
      : this.engineData.team(homeCode);
    const away = this.engineData.team(awayCode);

    const inputs: MatchInputs = {
      home,
      away,
      ctx: { stage: ctxStage, matchNumber, venueCountry, knockout: ctxStage !== 'group' },
      h2h: this.engineData.h2hFor(homeCode, awayCode),
    };

    const seed = (dto.seed ?? randomSeed()) >>> 0;
    const started = Date.now();

    const prediction = predictMatch(inputs);

    // aggregate N runs — yield to the event loop periodically so large runs
    // can't starve DB connection handshakes and other requests (a starved
    // loop makes Supabase's pooler count timed-out auths as failures and
    // trip its circuit breaker, taking the whole API down)
    const yieldEvery = 500;
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    const scoreCounts = new Map<string, number>();
    let goalsH = 0;
    let goalsA = 0;
    for (let i = 0; i < runs; i++) {
      const r = simulateMatch(inputs, {
        rng: mulberry32(deriveSeed(seed, i)),
        knockout: inputs.ctx.knockout,
        withEvents: false,
      });
      if (r.homeScore > r.awayScore) homeWins++;
      else if (r.homeScore < r.awayScore) awayWins++;
      else draws++;
      goalsH += r.homeScore;
      goalsA += r.awayScore;
      const k = `${r.homeScore}-${r.awayScore}`;
      scoreCounts.set(k, (scoreCounts.get(k) ?? 0) + 1);
      if ((i + 1) % yieldEvery === 0) await new Promise((r) => setImmediate(r));
    }

    // one detailed showcase run
    const detailed = simulateMatch(inputs, {
      rng: mulberry32(deriveSeed(seed, 999_983)),
      knockout: inputs.ctx.knockout,
      withEvents: true,
    });

    const topScores = [...scoreCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([score, n]) => ({ score, probability: round(n / runs, 4) }));

    const result = {
      matchNumber: matchNumber || null,
      home: homeCode,
      away: awayCode,
      runs,
      seed,
      durationMs: Date.now() - started,
      prediction,
      simulated: {
        homeWin: round(homeWins / runs, 4),
        draw: round(draws / runs, 4),
        awayWin: round(awayWins / runs, 4),
        avgHomeGoals: round(goalsH / runs, 2),
        avgAwayGoals: round(goalsA / runs, 2),
        topScorelines: topScores,
      },
      sampleMatch: detailed,
    };

    const [saved] = await this.db
      .insert(simulations)
      .values({
        userId: user?.id ?? null,
        simulationType: 'single_match',
        config: { matchNumber, homeCode, awayCode, runs, hasCustomLineup: Boolean(dto.homeLineup) },
        results: result as never,
        seed,
        durationMs: result.durationMs,
        simulationCount: runs,
      })
      .returning({ id: simulations.id });

    if (user) void this.leaderboard.recomputeUser(user.id).catch(() => undefined);
    return { simulationId: saved.id, ...result };
  }

  // -------------------------------------------------------------------------

  async startTournamentJob(
    user: AuthUser | null,
    dto: { runs?: number; seed?: number; pinned?: { code: string; formation: FormationId; startingXi: LineupSlotAssignment[] } },
  ): Promise<{ jobId: string; runs: number }> {
    const role = this.roleOf(user);
    const runs = Math.max(10, Math.min(dto.runs ?? 1000, SIM_LIMITS[role].monteCarloMax));
    this.enforceLimits(user, runs);

    const job: SimJob = {
      id: randomUUID(),
      userId: user?.id ?? null,
      type: 'tournament',
      status: 'running',
      progress: 0,
      runs,
      startedAt: Date.now(),
      listeners: new Set(),
    };
    this.jobs.set(job.id, job);

    const seed = (dto.seed ?? randomSeed()) >>> 0;
    const inputs = this.engineData.tournamentInputs(dto.pinned);

    void runMonteCarlo(inputs, {
      runs,
      seed,
      onProgress: (done, total) => {
        job.progress = done / total;
        for (const l of job.listeners) l({ progress: job.progress, status: job.status });
      },
    })
      .then(async (result) => {
        const [saved] = await this.db
          .insert(simulations)
          .values({
            userId: job.userId,
            simulationType: 'monte_carlo',
            config: { runs, seed, pinnedTeam: dto.pinned?.code ?? null },
            results: result as never,
            seed,
            durationMs: result.durationMs,
            simulationCount: runs,
          })
          .returning({ id: simulations.id });
        job.simulationId = saved.id;
        job.result = result;
        job.status = 'completed';
        job.progress = 1;
        if (job.userId) void this.leaderboard.recomputeUser(job.userId).catch(() => undefined);
        for (const l of job.listeners) l({ progress: 1, status: 'completed' });
        setTimeout(() => this.jobs.delete(job.id), 10 * 60_000).unref?.();
      })
      .catch((e) => {
        job.status = 'failed';
        job.error = String(e?.message ?? e);
        for (const l of job.listeners) l({ progress: job.progress, status: 'failed' });
      });

    return { jobId: job.id, runs };
  }

  getJob(jobId: string): SimJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new NotFoundException('Job not found (jobs expire 10 minutes after completion)');
    return job;
  }

  async getSimulation(id: string) {
    const [row] = await this.db.select().from(simulations).where(eq(simulations.id, id));
    if (!row) throw new NotFoundException('Simulation not found');
    return row;
  }

  async listMine(userId: string, limit = 20) {
    return this.db
      .select({
        id: simulations.id,
        simulationType: simulations.simulationType,
        config: simulations.config,
        durationMs: simulations.durationMs,
        simulationCount: simulations.simulationCount,
        createdAt: simulations.createdAt,
      })
      .from(simulations)
      .where(eq(simulations.userId, userId))
      .orderBy(desc(simulations.createdAt))
      .limit(Math.min(100, limit));
  }

  async totalSimulationVolume(): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${simulations.simulationCount}), 0)::int` })
      .from(simulations);
    return row.total;
  }
}
