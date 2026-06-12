import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  leaderboardEntries,
  leagueMembers,
  predictions,
  simulations,
  userFollows,
  userLineups,
  userTeams,
  users,
} from '@fifa/db';
import { REPUTATION_WEIGHTS, type LeaderboardEntryDto } from '@fifa/shared';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';

@Injectable()
export class LeaderboardService {
  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  /**
   * Recomputes a user's aggregate entry (global + country scopes) from raw
   * prediction/fantasy/simulation data, then refreshes ranks.
   */
  async recomputeUser(userId: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) return;

    const [predAgg] = await this.db
      .select({
        total: sql<number>`coalesce(sum(${predictions.pointsAwarded}), 0)::int`,
        scored: sql<number>`count(*) filter (where ${predictions.isScored})::int`,
        correct: sql<number>`count(*) filter (where ${predictions.isCorrectOutcome})::int`,
        exact: sql<number>`count(*) filter (where ${predictions.isExactScore})::int`,
      })
      .from(predictions)
      .where(eq(predictions.userId, userId));

    const [fantasyAgg] = await this.db
      .select({ total: sql<number>`coalesce(sum(${userLineups.pointsEarned}), 0)::int` })
      .from(userLineups)
      .innerJoin(userTeams, eq(userLineups.userTeamId, userTeams.id))
      .where(eq(userTeams.userId, userId));

    const [simAgg] = await this.db
      .select({ runs: sql<number>`coalesce(sum(${simulations.simulationCount}), 0)::int` })
      .from(simulations)
      .where(eq(simulations.userId, userId));

    const [followerAgg] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(userFollows)
      .where(eq(userFollows.followingId, userId));

    const predictionPoints = predAgg.total;
    const fantasyPoints = fantasyAgg.total;
    const totalPoints = predictionPoints + fantasyPoints;
    const reputation =
      predictionPoints * REPUTATION_WEIGHTS.predictionPoint +
      fantasyPoints * REPUTATION_WEIGHTS.fantasyPoint +
      simAgg.runs * REPUTATION_WEIGHTS.simulationRun +
      followerAgg.n * REPUTATION_WEIGHTS.followerBonus;

    const scopes: Array<{ type: 'global' | 'country'; key: string }> = [{ type: 'global', key: 'global' }];
    if (user.countryCode) scopes.push({ type: 'country', key: user.countryCode });

    for (const scope of scopes) {
      const values = {
        totalPoints,
        predictionPoints,
        fantasyPoints,
        predictionAccuracy: (predAgg.scored ? (predAgg.correct / predAgg.scored) * 100 : 0).toFixed(2),
        exactScoreAccuracy: (predAgg.scored ? (predAgg.exact / predAgg.scored) * 100 : 0).toFixed(2),
        winnerAccuracy: (predAgg.scored ? (predAgg.correct / predAgg.scored) * 100 : 0).toFixed(2),
        simulationsRun: simAgg.runs,
        reputationScore: reputation.toFixed(2),
        lastUpdated: new Date(),
      };
      const [existing] = await this.db
        .select()
        .from(leaderboardEntries)
        .where(
          and(
            eq(leaderboardEntries.userId, userId),
            eq(leaderboardEntries.tournamentId, this.engineData.tournamentId),
            eq(leaderboardEntries.leaderboardType, scope.type),
            eq(leaderboardEntries.scopeKey, scope.key),
          ),
        );
      if (existing) {
        await this.db.update(leaderboardEntries).set(values).where(eq(leaderboardEntries.id, existing.id));
      } else {
        await this.db.insert(leaderboardEntries).values({
          userId,
          tournamentId: this.engineData.tournamentId,
          leaderboardType: scope.type,
          scopeKey: scope.key,
          ...values,
        });
      }
    }
    await this.refreshRanks();
  }

  /** Window-function rank refresh per scope. */
  async refreshRanks(): Promise<void> {
    await this.db.execute(sql`
      with ranked as (
        select id, row_number() over (
          partition by tournament_id, leaderboard_type, scope_key
          order by total_points desc, reputation_score desc, last_updated asc
        ) as rn
        from leaderboard_entries
      )
      update leaderboard_entries le
      set rank = ranked.rn
      from ranked
      where le.id = ranked.id
    `);
  }

  async top(type: 'global' | 'country', scopeKey: string, limit = 100, offset = 0): Promise<LeaderboardEntryDto[]> {
    const rows = await this.db
      .select({ e: leaderboardEntries, username: users.username, countryCode: users.countryCode })
      .from(leaderboardEntries)
      .innerJoin(users, eq(leaderboardEntries.userId, users.id))
      .where(
        and(
          eq(leaderboardEntries.tournamentId, this.engineData.tournamentId),
          eq(leaderboardEntries.leaderboardType, type),
          eq(leaderboardEntries.scopeKey, scopeKey),
        ),
      )
      .orderBy(desc(leaderboardEntries.totalPoints), desc(leaderboardEntries.reputationScore))
      .limit(Math.min(500, limit))
      .offset(offset);

    return rows.map(({ e, username, countryCode }, i) => ({
      rank: e.rank ?? offset + i + 1,
      userId: e.userId,
      username,
      countryCode,
      totalPoints: e.totalPoints,
      predictionAccuracy: Number(e.predictionAccuracy),
      exactScoreAccuracy: Number(e.exactScoreAccuracy),
      simulationsRun: e.simulationsRun,
      reputationScore: Number(e.reputationScore),
    }));
  }

  async friends(userId: string): Promise<LeaderboardEntryDto[]> {
    const follows = await this.db
      .select({ id: userFollows.followingId })
      .from(userFollows)
      .where(eq(userFollows.followerId, userId));
    const ids = [follows.map((f) => f.id), [userId]].flat();
    const rows = await this.db
      .select({ e: leaderboardEntries, username: users.username, countryCode: users.countryCode })
      .from(leaderboardEntries)
      .innerJoin(users, eq(leaderboardEntries.userId, users.id))
      .where(
        and(
          eq(leaderboardEntries.leaderboardType, 'global'),
          sql`${leaderboardEntries.userId} in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
        ),
      )
      .orderBy(desc(leaderboardEntries.totalPoints));
    return rows.map(({ e, username, countryCode }, i) => ({
      rank: i + 1,
      userId: e.userId,
      username,
      countryCode,
      totalPoints: e.totalPoints,
      predictionAccuracy: Number(e.predictionAccuracy),
      exactScoreAccuracy: Number(e.exactScoreAccuracy),
      simulationsRun: e.simulationsRun,
      reputationScore: Number(e.reputationScore),
    }));
  }

  async leagueBoard(leagueId: string): Promise<LeaderboardEntryDto[]> {
    const rows = await this.db
      .select({ m: leagueMembers, username: users.username, countryCode: users.countryCode, e: leaderboardEntries })
      .from(leagueMembers)
      .innerJoin(users, eq(leagueMembers.userId, users.id))
      .leftJoin(
        leaderboardEntries,
        and(
          eq(leaderboardEntries.userId, leagueMembers.userId),
          eq(leaderboardEntries.leaderboardType, 'global'),
        ),
      )
      .where(eq(leagueMembers.leagueId, leagueId));

    return rows
      .map(({ username, countryCode, e, m }) => ({
        rank: 0,
        userId: m.userId,
        username,
        countryCode,
        totalPoints: e?.totalPoints ?? 0,
        predictionAccuracy: Number(e?.predictionAccuracy ?? 0),
        exactScoreAccuracy: Number(e?.exactScoreAccuracy ?? 0),
        simulationsRun: e?.simulationsRun ?? 0,
        reputationScore: Number(e?.reputationScore ?? 0),
      }))
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .map((r, i) => ({ ...r, rank: i + 1 }));
  }
}
