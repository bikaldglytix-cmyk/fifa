import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { desc, eq } from 'drizzle-orm';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { dataIngestionLogs, matches, players, users, userLineups } from '@fifa/db';
import { LINEUP_LOCK_MINUTES_BEFORE_KICKOFF } from '@fifa/shared';
import { CurrentUser, Roles, type AuthUser } from '../common/auth.guard';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { ResultsService } from './results.service';
import { ResultIngestionService } from '../ingestion/result-ingestion.service';
import { MatchLifecycleService } from '../lifecycle/match-lifecycle.service';
import { ModelService } from '../model/model.service';
import { FraudService } from '../security/fraud.service';
import { LiveGateway } from '../live/live.gateway';
import { LiveStateStore } from '../live/live-state.store';

class ResultEventDto {
  @IsInt() @Min(1) @Max(130) minute!: number;
  @IsIn(['goal', 'penalty_goal', 'own_goal', 'yellow_card', 'second_yellow', 'red_card']) type!: string;
  @IsString() @Length(3, 3) team!: string;
  @IsOptional() @IsInt() playerId?: number;
  @IsOptional() @IsString() playerName?: string;
  @IsOptional() @IsInt() assistPlayerId?: number;
}

class EnterResultDto {
  @IsInt() @Min(0) @Max(20) homeScore!: number;
  @IsInt() @Min(0) @Max(20) awayScore!: number;
  @IsOptional() @IsInt() @Min(0) homeScoreEt?: number;
  @IsOptional() @IsInt() @Min(0) awayScoreEt?: number;
  @IsOptional() @IsInt() @Min(0) homePenalties?: number;
  @IsOptional() @IsInt() @Min(0) awayPenalties?: number;
  @IsOptional() @IsInt() @Min(0) attendance?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ResultEventDto) events?: ResultEventDto[];
}

class InjuryDto {
  @IsIn(['fit', 'doubtful', 'out']) status!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) fitness?: number;
}

class LiveStateDto {
  @IsInt() @Min(0) @Max(20) homeScore!: number;
  @IsInt() @Min(0) @Max(20) awayScore!: number;
  @IsOptional() @IsInt() @Min(0) @Max(130) minute?: number;
  @IsOptional() @IsIn(['live', 'half_time', 'extra_time', 'penalties']) phase?: string;
  @IsOptional() @IsInt() @Min(0) homePenalties?: number;
  @IsOptional() @IsInt() @Min(0) awayPenalties?: number;
  @IsOptional() @IsInt() @Min(0) attendance?: number;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly dbs: DbService,
    private readonly results: ResultsService,
    private readonly ingestion: ResultIngestionService,
    private readonly lifecycle: MatchLifecycleService,
    private readonly model: ModelService,
    private readonly fraud: FraudService,
    private readonly engineData: EngineDataService,
    private readonly live: LiveGateway,
    private readonly liveStore: LiveStateStore,
  ) {}

  /** Ops: force one lifecycle sweep now (the sweep also runs on its own timer). */
  @Post('lifecycle/sweep')
  sweep() {
    return this.lifecycle.sweep();
  }

  private get db() {
    return this.dbs.db;
  }

  /**
   * Submit a verified official result claim. This is result INGESTION
   * (source `official_admin`, authority weight 1.0), not a status toggle —
   * completion and the downstream pipeline run autonomously via consensus.
   */
  @Post('results/:matchNumber')
  enterResult(
    @CurrentUser() admin: AuthUser,
    @Param('matchNumber', ParseIntPipe) matchNumber: number,
    @Body() dto: EnterResultDto,
  ) {
    return this.ingestion.submitClaim('official_admin', { matchNumber, ...dto, events: dto.events as never }, admin.id);
  }

  /** Retract a verified result (official correction) — reverses the entire pipeline. */
  @Delete('results/:matchNumber')
  retractResult(
    @CurrentUser() admin: AuthUser,
    @Param('matchNumber', ParseIntPipe) matchNumber: number,
    @Body('reason') reason?: string,
  ) {
    return this.ingestion.retract(matchNumber, reason ?? 'official correction', admin.id);
  }

  /** Multi-source result-claim ledger (ingestion transparency). */
  @Get('ingestion/claims')
  claims(@Query('match') match?: string) {
    return this.ingestion.claimsFor(match ? Number(match) : undefined);
  }

  /**
   * Relay a result payload received from a configured external feed (ops
   * tooling / feed webhooks). The claim carries the FEED's weight, not
   * admin authority — consensus rules still decide completion.
   */
  @Post('ingestion/claims/:source/:matchNumber')
  relayFeedClaim(
    @Param('source') source: string,
    @Param('matchNumber', ParseIntPipe) matchNumber: number,
    @Body() dto: EnterResultDto,
  ) {
    return this.ingestion.submitClaim(source, { matchNumber, ...dto, events: dto.events as never });
  }

  /**
   * Manually set the live in-play state for a match (operator fallback when
   * the FIFA feed is unreachable). Overrides the feed for 10 minutes; it is
   * ticker state only — verified completion still requires a result claim.
   */
  @Post('live/:matchNumber')
  async setLiveState(@Param('matchNumber', ParseIntPipe) matchNumber: number, @Body() dto: LiveStateDto) {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m || !m.homeTeamId || !m.awayTeamId) {
      return { ok: false, error: 'Match not found or participants unresolved' };
    }
    this.liveStore.set({
      matchNumber,
      source: 'official_admin',
      phase: (dto.phase ?? 'live') as never,
      minute: dto.minute ?? null,
      minuteLabel: dto.minute != null ? `${dto.minute}'` : null,
      period: null,
      homeCode: this.engineData.codeOfTeamId(m.homeTeamId)!,
      awayCode: this.engineData.codeOfTeamId(m.awayTeamId)!,
      homeScore: dto.homeScore,
      awayScore: dto.awayScore,
      homePenalties: dto.homePenalties ?? null,
      awayPenalties: dto.awayPenalties ?? null,
      attendance: dto.attendance ?? null,
      events: this.liveStore.get(matchNumber)?.events ?? [],
      finished: false,
      fetchedAt: new Date().toISOString(),
    });
    const state = this.liveStore.dto(matchNumber)!;
    this.live.broadcastLiveState(matchNumber, { kind: 'live_state', state, lastEvent: null });
    this.live.broadcastLiveScores();
    return { ok: true, state };
  }

  /** Clear a manual live state (feed resumes on its next tick). */
  @Delete('live/:matchNumber')
  clearLiveState(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    this.liveStore.delete(matchNumber);
    this.live.broadcastLiveScores();
    return { ok: true };
  }

  /** Re-run bracket resolution manually. */
  @Post('bracket/resolve')
  resolveBracket() {
    return this.results.resolveBracket();
  }

  /** Lock all user lineups for matches kicking off within the lock window. */
  @Post('lineups/lock-due')
  async lockDue() {
    const all = await this.db.select().from(matches);
    const due = all.filter(
      (m) => m.status === 'scheduled' && Date.now() >= m.matchDate.getTime() - LINEUP_LOCK_MINUTES_BEFORE_KICKOFF * 60_000,
    );
    let locked = 0;
    for (const m of due) {
      const result = await this.db
        .update(userLineups)
        .set({ isLocked: true, updatedAt: new Date() })
        .where(eq(userLineups.matchId, m.id))
        .returning({ id: userLineups.id });
      locked += result.length;
      this.live.broadcastLineupOfficial(m.matchNumber, { matchNumber: m.matchNumber, lockedAt: new Date().toISOString() });
    }
    return { matchesProcessed: due.length, lineupsLocked: locked };
  }

  /** Player availability management (injuries / fitness). */
  @Patch('players/:id/injury')
  async setInjury(@Param('id', ParseIntPipe) id: number, @Body() dto: InjuryDto) {
    const [row] = await this.db
      .update(players)
      .set({
        injuryStatus: dto.status,
        injuryDescription: dto.description ?? null,
        fitnessPercentage: dto.fitness ?? (dto.status === 'fit' ? 100 : dto.status === 'doubtful' ? 70 : 0),
        updatedAt: new Date(),
      })
      .where(eq(players.id, id))
      .returning();
    await this.engineData.refresh();
    return row;
  }

  @Post('users/:id/premium')
  async grantPremium(@Param('id') id: string, @Query('days') days = '30') {
    const until = new Date(Date.now() + Number(days) * 86_400_000);
    const [row] = await this.db
      .update(users)
      .set({ role: 'premium', premiumUntil: until, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return { id: row.id, role: row.role, premiumUntil: row.premiumUntil };
  }

  @Post('users/:id/suspend')
  async suspend(@CurrentUser() admin: AuthUser, @Param('id') id: string, @Body('reason') reason?: string) {
    const [row] = await this.db
      .update(users)
      .set({ suspendedAt: new Date(), suspensionReason: reason ?? 'Manual suspension', isActive: false })
      .where(eq(users.id, id))
      .returning();
    return { id: row.id, suspended: true };
  }

  @Post('users/:id/reinstate')
  async reinstate(@Param('id') id: string) {
    const [row] = await this.db
      .update(users)
      .set({ suspendedAt: null, suspensionReason: null, isActive: true })
      .where(eq(users.id, id))
      .returning();
    return { id: row.id, suspended: false };
  }

  @Get('fraud/flags')
  flags(@Query('all') all?: string) {
    return this.fraud.listFlags(all !== 'true');
  }

  @Patch('fraud/flags/:id/resolve')
  resolveFlag(@CurrentUser() admin: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.fraud.resolveFlag(id, admin.id);
  }

  @Get('fraud/multi-account/:userId')
  multiAccount(@Param('userId') userId: string) {
    return this.fraud.detectMultiAccounts(userId);
  }

  @Get('ingestion-logs')
  ingestionLogs() {
    return this.db.select().from(dataIngestionLogs).orderBy(desc(dataIngestionLogs.ingestedAt)).limit(100);
  }

  @Post('engine/refresh')
  async refreshEngine() {
    await this.engineData.refresh();
    return { refreshed: true };
  }

  /** Ops: recompute the system tournament forecast now (also runs on events). */
  @Post('forecast/refresh')
  async refreshForecast() {
    await this.model.refreshForecast('manual');
    return { refreshed: true };
  }
}
