import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  auditLogs,
  dataIngestionLogs,
  matches,
  playerStatistics,
  predictions,
  resultClaims,
  teamStatistics,
  userLineups,
  userTeams,
} from '@fifa/db';
import { DbService } from '../common/db.service';
import { EventBusService } from '../common/event-bus.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { LiveGateway } from '../live/live.gateway';
import { FT_GROUP, FT_KNOCKOUT, MatchLifecycleService } from '../lifecycle/match-lifecycle.service';
import { ResultsService, type ResultEntry } from '../admin/results.service';

/**
 * Multi-source result ingestion with confidence consensus AND clock
 * plausibility. A match completes only when BOTH hold:
 *
 *  1. Claims agreeing on an identical result reach the acceptance threshold
 *     (default 0.9). The verified-operator entry carries authority weight 1.0;
 *     external feeds register via RESULT_FEEDS with configured weights.
 *     Disagreeing sources park the match with a logged conflict.
 *
 *  2. The lifecycle clock says the match can plausibly be finished. No source
 *     — operator included — can complete a match before kickoff + 112' (90'
 *     decision) or + 152' (ET/penalties result). Early claims are HELD and
 *     resolve automatically when the clock window opens (no manual step).
 */

export interface SourceDef {
  name: string;
  weight: number;
}

const BUILT_IN_SOURCES: SourceDef[] = [
  { name: 'official_admin', weight: 1.0 },
  // FIFA's own live match-data feed (api.fifa.com) — authoritative enough to
  // complete a match alone once the clock-plausibility gate opens.
  { name: 'fifa', weight: 0.95 },
];

function configuredSources(): SourceDef[] {
  const out = [...BUILT_IN_SOURCES];
  try {
    const raw = process.env.RESULT_FEEDS;
    if (raw) {
      for (const f of JSON.parse(raw) as SourceDef[]) {
        if (f?.name && typeof f.weight === 'number') out.push({ name: f.name, weight: Math.min(0.95, Math.max(0.05, f.weight)) });
      }
    }
  } catch {
    /* malformed RESULT_FEEDS env ignored — only verified built-ins remain */
  }
  return out;
}

const canonicalPayload = (e: ResultEntry) => ({
  homeScore: e.homeScore,
  awayScore: e.awayScore,
  homeScoreEt: e.homeScoreEt ?? null,
  awayScoreEt: e.awayScoreEt ?? null,
  homePenalties: e.homePenalties ?? null,
  awayPenalties: e.awayPenalties ?? null,
});

type CanonicalResult = ReturnType<typeof canonicalPayload>;

/**
 * Clock-plausibility check for a result payload (pure, exported for tests).
 * A 90'-decided result is acceptable from kickoff+112'; a result carrying
 * ET/penalty fields needs kickoff+152'.
 */
export function resultAcceptance(
  matchDate: Date,
  payload: CanonicalResult,
  now: Date,
): { ok: boolean; earliestAcceptanceUtc: string } {
  const wentBeyond90 =
    payload.homeScoreEt != null || payload.awayScoreEt != null ||
    payload.homePenalties != null || payload.awayPenalties != null;
  const thresholdMin = wentBeyond90 ? FT_KNOCKOUT : FT_GROUP;
  const earliest = new Date(matchDate.getTime() + thresholdMin * 60_000);
  return { ok: now.getTime() >= earliest.getTime(), earliestAcceptanceUtc: earliest.toISOString() };
}

@Injectable()
export class ResultIngestionService implements OnModuleInit {
  private readonly logger = new Logger(ResultIngestionService.name);
  private readonly sources = new Map(configuredSources().map((s) => [s.name, s]));

  constructor(
    private readonly dbs: DbService,
    private readonly bus: EventBusService,
    private readonly results: ResultsService,
    private readonly engineData: EngineDataService,
    private readonly leaderboard: LeaderboardService,
    private readonly lifecycle: MatchLifecycleService,
    private readonly live: LiveGateway,
  ) {}

  /** Held claims resolve automatically the moment the clock window opens. */
  onModuleInit(): void {
    this.bus.on('match.phase_changed', async (e) => {
      if (e.to !== 'extra_time' && e.to !== 'awaiting_result') return;
      const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, e.matchNumber));
      if (!match || match.status === 'completed') return;
      const pending = await this.db
        .select({ id: resultClaims.id })
        .from(resultClaims)
        .where(and(eq(resultClaims.matchId, match.id), eq(resultClaims.status, 'pending')))
        .limit(1);
      if (pending.length) {
        const out = await this.resolveConsensus(match.id);
        if (out.accepted) this.logger.log(`held result for M${e.matchNumber} auto-accepted on phase '${e.to}'`);
      }
    });
  }

  private get db() {
    return this.dbs.db;
  }

  private get acceptThreshold(): number {
    const t = Number(process.env.RESULT_ACCEPT_THRESHOLD ?? 0.9);
    return Number.isFinite(t) ? t : 0.9;
  }

  listSources(): SourceDef[] {
    return [...this.sources.values()];
  }

  /**
   * Records a result claim from a source and attempts consensus resolution.
   * Early or under-weight claims stay pending — never lost, never premature.
   */
  async submitClaim(
    sourceName: string,
    entry: ResultEntry,
    submittedBy?: string,
  ): Promise<{
    claimId: number;
    accepted: boolean;
    held: boolean;
    earliestAcceptanceUtc: string | null;
    consensusWeight: number;
    resolved: string[];
  }> {
    const source = this.sources.get(sourceName);
    if (!source) throw new BadRequestException(`Unknown result source '${sourceName}'`);

    const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, entry.matchNumber));
    if (!match) throw new NotFoundException(`No match #${entry.matchNumber}`);
    if (!match.homeTeamId || !match.awayTeamId) {
      throw new BadRequestException('Match participants are not resolved yet');
    }
    if (match.status === 'completed') {
      throw new BadRequestException('Match already completed — retract the result first to correct it');
    }
    const isKnockout = match.stage !== 'group';
    const finalHome = entry.homeScoreEt ?? entry.homeScore;
    const finalAway = entry.awayScoreEt ?? entry.awayScore;
    if (isKnockout && finalHome === finalAway && (entry.homePenalties == null || entry.awayPenalties == null)) {
      throw new BadRequestException('Knockout draw requires a penalty shootout result');
    }
    if (!isKnockout && (entry.homeScoreEt != null || entry.homePenalties != null)) {
      throw new BadRequestException('Group matches cannot have extra time or penalties');
    }

    const payload = canonicalPayload(entry);
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 64);

    const [claim] = await this.db
      .insert(resultClaims)
      .values({
        matchId: match.id,
        source: source.name,
        sourceWeight: source.weight.toFixed(2),
        payload: { ...payload, events: entry.events ?? [], attendance: entry.attendance ?? null },
        payloadHash: hash,
        submittedBy: submittedBy ?? null,
      })
      .returning();

    const gate = resultAcceptance(match.matchDate, payload, this.lifecycle.now());
    if (!gate.ok) {
      await this.db.insert(dataIngestionLogs).values({
        source: source.name,
        dataType: 'result_held_early',
        confidenceScore: source.weight.toFixed(2),
        recordsIngested: 0,
        validationErrors: {
          matchNumber: entry.matchNumber,
          note: `claim held: match cannot plausibly be finished before ${gate.earliestAcceptanceUtc}`,
          earliestAcceptanceUtc: gate.earliestAcceptanceUtc,
        },
      });
      this.logger.warn(
        `claim for M${entry.matchNumber} from '${source.name}' HELD — earliest acceptance ${gate.earliestAcceptanceUtc}`,
      );
      return {
        claimId: claim.id,
        accepted: false,
        held: true,
        earliestAcceptanceUtc: gate.earliestAcceptanceUtc,
        consensusWeight: 0,
        resolved: [],
      };
    }

    const out = await this.resolveConsensus(match.id);
    return { claimId: claim.id, held: false, earliestAcceptanceUtc: null, ...out };
  }

  /**
   * Weighted agreement across distinct sources on an identical result,
   * gated by clock plausibility. Self-sufficient: callable from claim
   * submission or from lifecycle phase transitions.
   */
  async resolveConsensus(
    matchId: number,
  ): Promise<{ accepted: boolean; consensusWeight: number; resolved: string[] }> {
    const [match] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!match || match.status === 'completed') return { accepted: false, consensusWeight: 0, resolved: [] };

    const open = await this.db
      .select()
      .from(resultClaims)
      .where(and(eq(resultClaims.matchId, matchId), eq(resultClaims.status, 'pending')));
    if (!open.length) return { accepted: false, consensusWeight: 0, resolved: [] };

    // weight per hash: count each source once (its max weight)
    const byHash = new Map<string, Map<string, number>>();
    for (const c of open) {
      const perSource = byHash.get(c.payloadHash) ?? new Map<string, number>();
      perSource.set(c.source, Math.max(perSource.get(c.source) ?? 0, Number(c.sourceWeight)));
      byHash.set(c.payloadHash, perSource);
    }
    let bestHash: string | null = null;
    let bestWeight = 0;
    for (const [hash, perSource] of byHash) {
      const w = [...perSource.values()].reduce((a, b) => a + b, 0);
      if (w > bestWeight) {
        bestWeight = w;
        bestHash = hash;
      }
    }

    if (!bestHash || bestWeight < this.acceptThreshold) {
      if (byHash.size > 1) {
        await this.db.insert(dataIngestionLogs).values({
          source: 'consensus',
          dataType: 'result_conflict',
          confidenceScore: bestWeight.toFixed(2),
          recordsIngested: 0,
          validationErrors: {
            matchId,
            variants: [...byHash.keys()],
            note: 'sources disagree — match held in awaiting_result until consensus',
          },
        });
        this.logger.warn(`result conflict on match ${matchId}: ${byHash.size} variants, best weight ${bestWeight}`);
      }
      return { accepted: false, consensusWeight: bestWeight, resolved: [] };
    }

    const winner = open.find((c) => c.payloadHash === bestHash)!;
    const winnerPayload = winner.payload as CanonicalResult & { events?: ResultEntry['events']; attendance?: number | null };

    // clock plausibility applies to the WINNING payload regardless of caller
    const gate = resultAcceptance(match.matchDate, winnerPayload, this.lifecycle.now());
    if (!gate.ok) {
      this.logger.warn(
        `consensus reached for M${match.matchNumber} (weight ${bestWeight}) but clock says not finished — holding until ${gate.earliestAcceptanceUtc}`,
      );
      return { accepted: false, consensusWeight: bestWeight, resolved: [] };
    }

    const entry: ResultEntry = {
      matchNumber: match.matchNumber,
      homeScore: winnerPayload.homeScore,
      awayScore: winnerPayload.awayScore,
      homeScoreEt: winnerPayload.homeScoreEt ?? undefined,
      awayScoreEt: winnerPayload.awayScoreEt ?? undefined,
      homePenalties: winnerPayload.homePenalties ?? undefined,
      awayPenalties: winnerPayload.awayPenalties ?? undefined,
      attendance: winnerPayload.attendance ?? undefined,
      events: winnerPayload.events?.length ? winnerPayload.events : undefined,
    };

    const { resolved } = await this.results.enterResult(entry);

    const now = new Date();
    await this.db
      .update(resultClaims)
      .set({ status: 'accepted', resolvedAt: now })
      .where(and(eq(resultClaims.matchId, matchId), eq(resultClaims.payloadHash, bestHash), eq(resultClaims.status, 'pending')));
    await this.db
      .update(resultClaims)
      .set({ status: 'superseded', resolvedAt: now })
      .where(and(eq(resultClaims.matchId, matchId), eq(resultClaims.status, 'pending')));

    await this.db.insert(dataIngestionLogs).values({
      source: winner.source,
      dataType: 'match_result',
      confidenceScore: Math.min(1, bestWeight).toFixed(2),
      recordsIngested: 1,
      validationErrors: null,
    });

    const [completed] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    this.bus.emit('match.completed', {
      matchNumber: completed.matchNumber,
      homeCode: this.engineData.codeOfTeamId(completed.homeTeamId!)!,
      awayCode: this.engineData.codeOfTeamId(completed.awayTeamId!)!,
      homeScore: completed.homeScore ?? 0,
      awayScore: completed.awayScore ?? 0,
      source: winner.source,
    });
    this.live.broadcastStandings();
    return { accepted: true, consensusWeight: bestWeight, resolved };
  }

  /**
   * Retracts a verified result (bad data, official correction). Reverses the
   * entire downstream pipeline and returns the match to its clock-derived
   * phase. Full audit trail retained.
   */
  async retract(matchNumber: number, reason: string, byUserId?: string): Promise<{ ok: true; revertedTo: string }> {
    const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!match) throw new NotFoundException(`No match #${matchNumber}`);
    if (match.status !== 'completed') throw new BadRequestException('Only completed matches can be retracted');

    const before = { homeScore: match.homeScore, awayScore: match.awayScore, status: match.status };

    // 1. reverse fantasy points awarded for this match
    const lineups = await this.db
      .select({ l: userLineups, t: userTeams })
      .from(userLineups)
      .innerJoin(userTeams, eq(userLineups.userTeamId, userTeams.id))
      .where(eq(userLineups.matchId, match.id));
    const affectedUsers = new Set<string>();
    for (const { l, t } of lineups) {
      if (l.pointsEarned !== 0) {
        await this.db
          .update(userTeams)
          .set({ totalPoints: t.totalPoints - l.pointsEarned, updatedAt: new Date() })
          .where(eq(userTeams.id, t.id));
        await this.db
          .update(userLineups)
          .set({ pointsEarned: 0, pointsBreakdown: null, updatedAt: new Date() })
          .where(eq(userLineups.id, l.id));
        affectedUsers.add(t.userId);
      }
    }

    // 2. reset prediction scoring for this match
    const preds = await this.db
      .update(predictions)
      .set({ pointsAwarded: 0, isScored: false, isCorrectOutcome: null, isExactScore: null, updatedAt: new Date() })
      .where(eq(predictions.matchId, match.id))
      .returning({ userId: predictions.userId });
    for (const p of preds) affectedUsers.add(p.userId);

    // 3. drop stat lines
    await this.db.delete(playerStatistics).where(eq(playerStatistics.matchId, match.id));
    await this.db.delete(teamStatistics).where(eq(teamStatistics.matchId, match.id));

    // 4. clear the result; phase returns to the autonomous clock
    const revertedTo = this.lifecycle.phaseFor(match.matchDate, match.stage !== 'group');
    await this.db
      .update(matches)
      .set({
        homeScore: null, awayScore: null, homeScoreEt: null, awayScoreEt: null,
        homePenalties: null, awayPenalties: null, winnerTeamId: null, attendance: null,
        status: revertedTo as never,
      })
      .where(eq(matches.id, match.id));

    // 5. un-resolve knockout slots that no longer have a decided feeder
    await this.reresolveBracketFromScratch();

    // 6. claims + audit
    await this.db
      .update(resultClaims)
      .set({ status: 'retracted', resolvedAt: new Date() })
      .where(and(eq(resultClaims.matchId, match.id), inArray(resultClaims.status, ['accepted', 'pending'])));
    await this.db.insert(auditLogs).values({
      userId: byUserId ?? null,
      action: 'result.retracted',
      entityType: 'match',
      entityId: String(matchNumber),
      oldValues: before,
      newValues: { status: revertedTo, reason },
    });
    await this.db.insert(dataIngestionLogs).values({
      source: 'consensus',
      dataType: 'result_retraction',
      confidenceScore: '1.00',
      recordsIngested: 1,
      validationErrors: { matchNumber, reason },
    });

    for (const userId of affectedUsers) await this.leaderboard.recomputeUser(userId);

    await this.engineData.refresh();
    this.bus.emit('match.retracted', { matchNumber, reason });
    this.live.broadcastPhase(matchNumber, { matchNumber, phase: revertedTo, at: new Date().toISOString() });
    this.live.broadcastStandings();
    this.logger.warn(`result RETRACTED for M${matchNumber} (${reason}) — phase now '${revertedTo}'`);
    return { ok: true, revertedTo };
  }

  /** Clears slot-derived knockout participants, then re-resolves from current results. */
  private async reresolveBracketFromScratch(): Promise<void> {
    const all = await this.db.select().from(matches);
    for (const m of all) {
      if (m.stage === 'group') continue;
      if (m.status === 'completed') continue; // never touch decided matches
      const patch: Record<string, unknown> = {};
      if (m.homeSlot && m.homeTeamId) patch.homeTeamId = null;
      if (m.awaySlot && m.awayTeamId) patch.awayTeamId = null;
      if (Object.keys(patch).length) {
        await this.db.update(matches).set(patch as never).where(eq(matches.id, m.id));
      }
    }
    await this.results.resolveBracket();
  }

  async claimsFor(matchNumber?: number) {
    if (matchNumber != null) {
      const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
      if (!match) throw new NotFoundException(`No match #${matchNumber}`);
      return this.db.select().from(resultClaims).where(eq(resultClaims.matchId, match.id)).orderBy(desc(resultClaims.claimedAt));
    }
    return this.db.select().from(resultClaims).orderBy(desc(resultClaims.claimedAt)).limit(200);
  }
}
