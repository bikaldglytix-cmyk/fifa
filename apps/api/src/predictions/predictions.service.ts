import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { matches, players, predictions, simulations } from '@fifa/db';
import { PREDICTION_SCORING, type CommunityIntelligence, type MatchStage } from '@fifa/shared';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { FraudService } from '../security/fraud.service';

@Injectable()
export class PredictionsService {
  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly fraud: FraudService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  async submit(
    userId: string,
    dto: {
      matchNumber: number;
      homeScore: number;
      awayScore: number;
      firstGoalscorerId?: number | null;
      cleanSheetTeam?: string | null;
      submissionMs?: number;
    },
  ) {
    const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, dto.matchNumber));
    if (!match) throw new NotFoundException(`No match #${dto.matchNumber}`);
    if (match.status !== 'scheduled') throw new ConflictException('Predictions close at kickoff');
    if (match.matchDate.getTime() <= Date.now()) throw new ConflictException('Match already kicked off');
    if (!match.homeTeamId || !match.awayTeamId) {
      throw new BadRequestException('Participants not decided yet');
    }

    const homeCode = this.engineData.codeOfTeamId(match.homeTeamId)!;
    const awayCode = this.engineData.codeOfTeamId(match.awayTeamId)!;

    if (dto.cleanSheetTeam && ![homeCode, awayCode].includes(dto.cleanSheetTeam.toUpperCase())) {
      throw new BadRequestException('cleanSheetTeam must be one of the two sides');
    }
    if (dto.firstGoalscorerId) {
      const [p] = await this.db.select().from(players).where(eq(players.id, dto.firstGoalscorerId));
      if (!p || ![homeCode, awayCode].includes(p.countryCode)) {
        throw new BadRequestException('firstGoalscorer must play in this match');
      }
    }

    const predictedWinner =
      dto.homeScore > dto.awayScore ? homeCode : dto.awayScore > dto.homeScore ? awayCode : null;

    const values = {
      predictedHomeScore: dto.homeScore,
      predictedAwayScore: dto.awayScore,
      predictedWinner,
      firstGoalscorerId: dto.firstGoalscorerId ?? null,
      cleanSheetTeam: dto.cleanSheetTeam?.toUpperCase() ?? null,
      submissionMs: dto.submissionMs ?? null,
      updatedAt: new Date(),
    };

    const [existing] = await this.db
      .select()
      .from(predictions)
      .where(and(eq(predictions.userId, userId), eq(predictions.matchId, match.id)));

    const [saved] = existing
      ? await this.db.update(predictions).set(values).where(eq(predictions.id, existing.id)).returning()
      : await this.db.insert(predictions).values({ userId, matchId: match.id, ...values }).returning();

    await this.fraud.onPredictionSubmitted(userId, saved.id, dto.submissionMs ?? null);
    return { ...saved, home: homeCode, away: awayCode };
  }

  async mine(userId: string) {
    const rows = await this.db
      .select({ p: predictions, m: matches })
      .from(predictions)
      .innerJoin(matches, eq(predictions.matchId, matches.id))
      .where(eq(predictions.userId, userId))
      .orderBy(desc(matches.matchNumber));
    return rows.map(({ p, m }) => ({
      ...p,
      matchNumber: m.matchNumber,
      stage: m.stage,
      kickoffUtc: m.matchDate,
      home: m.homeTeamId ? this.engineData.codeOfTeamId(m.homeTeamId) : null,
      away: m.awayTeamId ? this.engineData.codeOfTeamId(m.awayTeamId) : null,
      actual: m.status === 'completed' ? { homeScore: m.homeScore, awayScore: m.awayScore } : null,
    }));
  }

  /** Aggregated crowd view for a match (PRD CommunityIntelligence). */
  async communityIntelligence(matchNumber: number): Promise<CommunityIntelligence> {
    const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!match) throw new NotFoundException(`No match #${matchNumber}`);

    const rows = await this.db
      .select({
        homeScore: predictions.predictedHomeScore,
        awayScore: predictions.predictedAwayScore,
        winner: predictions.predictedWinner,
        scorerId: predictions.firstGoalscorerId,
      })
      .from(predictions)
      .where(eq(predictions.matchId, match.id));

    const total = rows.length;
    const outcome = { homeWin: 0, draw: 0, awayWin: 0 };
    const scoreCounts = new Map<string, number>();
    const winnerCounts = new Map<string, number>();
    const scorerCounts = new Map<number, number>();
    const homeCode = match.homeTeamId ? this.engineData.codeOfTeamId(match.homeTeamId) : null;

    for (const r of rows) {
      if (r.homeScore > r.awayScore) outcome.homeWin++;
      else if (r.homeScore < r.awayScore) outcome.awayWin++;
      else outcome.draw++;
      const k = `${r.homeScore}-${r.awayScore}`;
      scoreCounts.set(k, (scoreCounts.get(k) ?? 0) + 1);
      if (r.winner) winnerCounts.set(r.winner, (winnerCounts.get(r.winner) ?? 0) + 1);
      if (r.scorerId) scorerCounts.set(r.scorerId, (scorerCounts.get(r.scorerId) ?? 0) + 1);
    }

    const top = <K,>(m: Map<K, number>): K | null =>
      m.size ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;

    const consensusShare = total
      ? Math.max(outcome.homeWin, outcome.draw, outcome.awayWin) / total
      : 0;

    const popularScorerIds = [...scorerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const popularScorers = popularScorerIds.map(([playerId, count]) => ({
      playerId,
      name: this.engineData.playersById.get(playerId)?.name ?? `#${playerId}`,
      count,
    }));

    const [simVolume] = await this.db
      .select({ total: sql<number>`coalesce(sum(${simulations.simulationCount}), 0)::int` })
      .from(simulations)
      .where(sql`(${simulations.config} ->> 'matchNumber')::int = ${matchNumber}`);

    return {
      matchNumber,
      totalPredictions: total,
      mostPredictedWinner: top(winnerCounts) ?? (outcome.draw > 0 && consensusShare === outcome.draw / Math.max(1, total) ? null : homeCode),
      mostPredictedScoreline: top(scoreCounts),
      outcomeSplit: {
        homeWin: total ? outcome.homeWin / total : 0,
        draw: total ? outcome.draw / total : 0,
        awayWin: total ? outcome.awayWin / total : 0,
      },
      crowdConfidenceIndex: Math.round(consensusShare * 100),
      popularScorers,
      totalSimulations: simVolume?.total ?? 0,
    };
  }

  /**
   * Scores all predictions for a completed match. Returns scored rows for
   * leaderboard recomputation. Called by the admin results pipeline.
   */
  async scoreMatch(matchId: number): Promise<Array<{ userId: string; points: number }>> {
    const [match] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    if (!match || match.status !== 'completed' || match.homeScore == null || match.awayScore == null) {
      return [];
    }
    const S = PREDICTION_SCORING;
    const multiplier = S.stageMultiplier[match.stage as MatchStage] ?? 1;
    const homeCode = this.engineData.codeOfTeamId(match.homeTeamId!)!;
    const awayCode = this.engineData.codeOfTeamId(match.awayTeamId!)!;
    const actualOutcome = Math.sign(match.homeScore - match.awayScore); // 90' outcome
    const actualGd = match.homeScore - match.awayScore;
    const winnerCode = match.winnerTeamId ? this.engineData.codeOfTeamId(match.winnerTeamId) : null;

    const events = ((match as any).events ?? null) as Array<{ type: string; team: string; playerId?: number; minute: number }> | null;
    const firstScorerId = events
      ?.filter((e) => e.type === 'goal' || e.type === 'penalty_goal')
      .sort((a, b) => a.minute - b.minute)[0]?.playerId;

    const rows = await this.db.select().from(predictions).where(eq(predictions.matchId, matchId));
    const results: Array<{ userId: string; points: number }> = [];

    for (const p of rows) {
      let pts = 0;
      const predOutcome = Math.sign(p.predictedHomeScore - p.predictedAwayScore);
      const exact = p.predictedHomeScore === match.homeScore && p.predictedAwayScore === match.awayScore;
      const correctOutcome = predOutcome === actualOutcome;

      if (correctOutcome) pts += S.correctOutcome;
      if (exact) pts += S.exactScore;
      else if (correctOutcome && p.predictedHomeScore - p.predictedAwayScore === actualGd) {
        pts += S.correctGoalDifference;
      }
      if (p.cleanSheetTeam) {
        const conceded = p.cleanSheetTeam === homeCode ? match.awayScore : match.homeScore;
        if (conceded === 0) pts += S.cleanSheetCall;
      }
      if (p.firstGoalscorerId && firstScorerId && p.firstGoalscorerId === firstScorerId) {
        pts += S.firstGoalscorer;
      }
      // knockout: credited the advancing side despite a 90' draw
      if (match.stage !== 'group' && actualOutcome === 0 && p.predictedWinner && p.predictedWinner === winnerCode) {
        pts += S.advancingTeamBonus;
      }

      const points = Math.round(pts * multiplier);
      await this.db
        .update(predictions)
        .set({ pointsAwarded: points, isScored: true, isCorrectOutcome: correctOutcome, isExactScore: exact, updatedAt: new Date() })
        .where(eq(predictions.id, p.id));
      results.push({ userId: p.userId, points });
    }
    return results;
  }
}
