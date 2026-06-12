import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { IsOptional, IsString, Length, MaxLength, MinLength, IsBoolean, IsInt, Max, Min } from 'class-validator';
import {
  leagueMembers,
  matches,
  predictions,
  privateLeagues,
  userFollows,
  userPreferences,
  users,
  userTeams,
} from '@fifa/db';
import { generateJoinCode } from '@fifa/shared';
import { CurrentUser, Public, type AuthUser } from '../common/auth.guard';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

class CreateLeagueDto {
  @IsString() @MinLength(3) @MaxLength(100) name!: string;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsInt() @Min(2) @Max(10_000) maxParticipants?: number;
}

class JoinLeagueDto {
  @IsString() @Length(6, 10) joinCode!: string;
}

@ApiTags('social')
@ApiBearerAuth()
@Controller()
export class SocialController {
  constructor(
    private readonly dbs: DbService,
    private readonly leaderboard: LeaderboardService,
    private readonly engineData: EngineDataService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  // --- follows ---------------------------------------------------------------

  @Post('social/follow/:userId')
  async follow(@CurrentUser() me: AuthUser, @Param('userId') userId: string) {
    if (userId === me.id) throw new BadRequestException('Cannot follow yourself');
    const [target] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!target) throw new NotFoundException('User not found');
    await this.db
      .insert(userFollows)
      .values({ followerId: me.id, followingId: userId })
      .onConflictDoNothing();
    await this.leaderboard.recomputeUser(userId);
    return { following: true };
  }

  @Delete('social/follow/:userId')
  async unfollow(@CurrentUser() me: AuthUser, @Param('userId') userId: string) {
    await this.db
      .delete(userFollows)
      .where(and(eq(userFollows.followerId, me.id), eq(userFollows.followingId, userId)));
    return { following: false };
  }

  @Get('social/following')
  async following(@CurrentUser() me: AuthUser) {
    const rows = await this.db
      .select({ id: users.id, username: users.username, countryCode: users.countryCode })
      .from(userFollows)
      .innerJoin(users, eq(userFollows.followingId, users.id))
      .where(eq(userFollows.followerId, me.id));
    return rows;
  }

  @Get('social/followers')
  async followers(@CurrentUser() me: AuthUser) {
    return this.db
      .select({ id: users.id, username: users.username, countryCode: users.countryCode })
      .from(userFollows)
      .innerJoin(users, eq(userFollows.followerId, users.id))
      .where(eq(userFollows.followingId, me.id));
  }

  /** Prediction feed from followed users (respecting their share preference). */
  @Get('social/feed')
  async feed(@CurrentUser() me: AuthUser) {
    const follows = await this.db
      .select({ id: userFollows.followingId })
      .from(userFollows)
      .where(eq(userFollows.followerId, me.id));
    if (!follows.length) return [];
    const ids = follows.map((f) => f.id);

    const rows = await this.db
      .select({ p: predictions, m: matches, username: users.username, share: userPreferences.sharePredictions })
      .from(predictions)
      .innerJoin(users, eq(predictions.userId, users.id))
      .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
      .innerJoin(matches, eq(predictions.matchId, matches.id))
      .where(inArray(predictions.userId, ids))
      .orderBy(desc(predictions.updatedAt))
      .limit(50);

    return rows
      .filter((r) => r.share !== false)
      .map(({ p, m, username }) => ({
        username,
        matchNumber: m.matchNumber,
        home: m.homeTeamId ? this.engineData.codeOfTeamId(m.homeTeamId) : null,
        away: m.awayTeamId ? this.engineData.codeOfTeamId(m.awayTeamId) : null,
        predictedScore: `${p.predictedHomeScore}-${p.predictedAwayScore}`,
        pointsAwarded: p.isScored ? p.pointsAwarded : null,
        at: p.updatedAt,
      }));
  }

  /** Public profile with stats. */
  @Public()
  @Get('users/:username/profile')
  async profile(@Param('username') username: string) {
    const [u] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = ${username.toLowerCase()}`);
    if (!u) throw new NotFoundException('User not found');
    const [team] = await this.db.select().from(userTeams).where(eq(userTeams.userId, u.id));
    const [followerCount] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(userFollows)
      .where(eq(userFollows.followingId, u.id));
    return {
      id: u.id,
      username: u.username,
      countryCode: u.countryCode,
      role: u.role,
      memberSince: u.createdAt,
      fantasyTeam: team ? { country: team.countryCode, name: team.teamName, points: team.totalPoints } : null,
      followers: followerCount.n,
    };
  }

  // --- private leagues ---------------------------------------------------------

  @Post('leagues')
  async createLeague(@CurrentUser() me: AuthUser, @Body() dto: CreateLeagueDto) {
    let joinCode = generateJoinCode();
    for (let i = 0; i < 5; i++) {
      const clash = await this.db.select().from(privateLeagues).where(eq(privateLeagues.joinCode, joinCode));
      if (!clash.length) break;
      joinCode = generateJoinCode();
    }
    const [league] = await this.db
      .insert(privateLeagues)
      .values({
        creatorId: me.id,
        name: dto.name,
        joinCode,
        isPublic: dto.isPublic ?? false,
        maxParticipants: dto.maxParticipants ?? 100,
      })
      .returning();
    await this.db.insert(leagueMembers).values({ leagueId: league.id, userId: me.id });
    return league;
  }

  @Post('leagues/join')
  async joinLeague(@CurrentUser() me: AuthUser, @Body() dto: JoinLeagueDto) {
    const [league] = await this.db
      .select()
      .from(privateLeagues)
      .where(eq(privateLeagues.joinCode, dto.joinCode.toUpperCase()));
    if (!league) throw new NotFoundException('Invalid join code');
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(leagueMembers)
      .where(eq(leagueMembers.leagueId, league.id));
    if (n >= league.maxParticipants) throw new BadRequestException('League is full');
    await this.db.insert(leagueMembers).values({ leagueId: league.id, userId: me.id }).onConflictDoNothing();
    return league;
  }

  @Get('leagues/mine')
  async myLeagues(@CurrentUser() me: AuthUser) {
    const rows = await this.db
      .select({ l: privateLeagues })
      .from(leagueMembers)
      .innerJoin(privateLeagues, eq(leagueMembers.leagueId, privateLeagues.id))
      .where(eq(leagueMembers.userId, me.id));
    const out = [];
    for (const { l } of rows) {
      const [{ n }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(leagueMembers)
        .where(eq(leagueMembers.leagueId, l.id));
      out.push({ ...l, members: n });
    }
    return out;
  }

  @Get('leagues/:id/leaderboard')
  async leagueBoard(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    const [membership] = await this.db
      .select()
      .from(leagueMembers)
      .where(and(eq(leagueMembers.leagueId, id), eq(leagueMembers.userId, me.id)));
    if (!membership) throw new NotFoundException('Not a member of this league');
    return this.leaderboard.leagueBoard(id);
  }

  @Delete('leagues/:id/leave')
  async leaveLeague(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    await this.db.delete(leagueMembers).where(and(eq(leagueMembers.leagueId, id), eq(leagueMembers.userId, me.id)));
    return { left: true };
  }
}
