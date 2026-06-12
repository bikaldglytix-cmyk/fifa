import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import {
  matches,
  notifications,
  playerStatistics,
  teamStatistics,
  tournaments,
  userLineups,
  userTeams,
} from '@fifa/db';
import {
  GROUPS,
  type GroupLetter,
  type MatchSlot,
  type SimMatchEvent,
} from '@fifa/shared';
import {
  computeStandings,
  mulberry32,
  rankThirdPlacedTeams,
  resolveRoundOf32,
  scoreFantasyLineup,
  type GroupMatchRecord,
  type ThirdPlaceTable,
} from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { PredictionsService } from '../predictions/predictions.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { LiveGateway } from '../live/live.gateway';

export interface ResultEntry {
  matchNumber: number;
  homeScore: number;
  awayScore: number;
  homeScoreEt?: number | null;
  awayScoreEt?: number | null;
  homePenalties?: number | null;
  awayPenalties?: number | null;
  attendance?: number | null;
  events?: SimMatchEvent[];
}

/**
 * Real-result pipeline. When an admin (or a configured feed adapter) enters a
 * final score this service:
 *  1. persists the result + per-player stat lines from the event list
 *  2. scores predictions and fantasy lineups for the match
 *  3. recomputes leaderboards
 *  4. resolves bracket slots (R32 via official Annex C once groups complete;
 *     later rounds as feeder matches finish)
 *  5. notifies affected users + broadcasts over WebSocket
 */
@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly predictions: PredictionsService,
    private readonly leaderboard: LeaderboardService,
    private readonly live: LiveGateway,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  async enterResult(entry: ResultEntry): Promise<{ ok: true; resolved: string[] }> {
    const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, entry.matchNumber));
    if (!match) throw new NotFoundException(`No match #${entry.matchNumber}`);
    if (!match.homeTeamId || !match.awayTeamId) {
      throw new BadRequestException('Match participants are not resolved yet');
    }
    const isKnockout = match.stage !== 'group';
    const finalHome = entry.homeScoreEt ?? entry.homeScore;
    const finalAway = entry.awayScoreEt ?? entry.awayScore;
    if (isKnockout && finalHome === finalAway && (entry.homePenalties == null || entry.awayPenalties == null)) {
      throw new BadRequestException('Knockout draw requires a penalty shootout result');
    }

    const winnerTeamId = !isKnockout
      ? finalHome === finalAway
        ? null
        : finalHome > finalAway
          ? match.homeTeamId
          : match.awayTeamId
      : finalHome !== finalAway
        ? finalHome > finalAway
          ? match.homeTeamId
          : match.awayTeamId
        : (entry.homePenalties ?? 0) > (entry.awayPenalties ?? 0)
          ? match.homeTeamId
          : match.awayTeamId;

    await this.db
      .update(matches)
      .set({
        homeScore: finalHome,
        awayScore: finalAway,
        homeScoreEt: entry.homeScoreEt ?? null,
        awayScoreEt: entry.awayScoreEt ?? null,
        homePenalties: entry.homePenalties ?? null,
        awayPenalties: entry.awayPenalties ?? null,
        winnerTeamId,
        attendance: entry.attendance ?? null,
        status: 'completed',
      })
      .where(eq(matches.id, match.id));

    // store on the row for prediction first-scorer scoring
    if (entry.events?.length) {
      await this.persistStatLines(match.id, match.matchDate, entry.events);
      (match as any).events = entry.events;
    }

    // team statistics rows
    for (const [teamId, gf, ga] of [
      [match.homeTeamId, finalHome, finalAway],
      [match.awayTeamId, finalAway, finalHome],
    ] as Array<[number, number, number]>) {
      await this.db
        .insert(teamStatistics)
        .values({
          teamId,
          matchId: match.id,
          matchDate: match.localDate,
          goalsScored: gf,
          goalsConceded: ga,
        })
        .onConflictDoNothing();
    }

    // scoring + leaderboards
    const scored = await this.scoreMatchAndUsers(match.id, entry.events ?? []);

    // bracket resolution
    const resolved = await this.resolveBracket();

    // realtime broadcast
    const homeCode = this.engineData.codeOfTeamId(match.homeTeamId)!;
    const awayCode = this.engineData.codeOfTeamId(match.awayTeamId)!;
    this.live.broadcastResult(match.matchNumber, {
      matchNumber: match.matchNumber,
      home: homeCode,
      away: awayCode,
      homeScore: finalHome,
      awayScore: finalAway,
      penalties: entry.homePenalties != null ? { home: entry.homePenalties, away: entry.awayPenalties } : null,
      status: 'completed',
    });
    this.live.broadcastLeaderboard();

    this.logger.log(
      `result entered: M${match.matchNumber} ${homeCode} ${finalHome}-${finalAway} ${awayCode} — ${scored} users scored, resolved: ${resolved.join(',') || 'none'}`,
    );
    return { ok: true, resolved };
  }

  private async persistStatLines(matchId: number, matchDate: Date, events: SimMatchEvent[]): Promise<void> {
    const byPlayer = new Map<number, { goals: number; assists: number; yellow: number; red: number }>();
    for (const ev of events) {
      if (ev.playerId) {
        const rec = byPlayer.get(ev.playerId) ?? { goals: 0, assists: 0, yellow: 0, red: 0 };
        if (ev.type === 'goal' || ev.type === 'penalty_goal') rec.goals++;
        if (ev.type === 'yellow_card') rec.yellow++;
        if (ev.type === 'red_card' || ev.type === 'second_yellow') rec.red++;
        byPlayer.set(ev.playerId, rec);
      }
      if (ev.assistPlayerId) {
        const rec = byPlayer.get(ev.assistPlayerId) ?? { goals: 0, assists: 0, yellow: 0, red: 0 };
        rec.assists++;
        byPlayer.set(ev.assistPlayerId, rec);
      }
    }
    const dateStr = matchDate.toISOString().slice(0, 10);
    for (const [playerId, s] of byPlayer) {
      await this.db
        .insert(playerStatistics)
        .values({
          playerId,
          matchId,
          matchDate: dateStr,
          season: '2026',
          goals: s.goals,
          assists: s.assists,
          yellowCards: s.yellow,
          redCards: s.red,
        })
        .onConflictDoNothing();
    }
  }

  private async scoreMatchAndUsers(matchId: number, events: SimMatchEvent[]): Promise<number> {
    const [match] = await this.db.select().from(matches).where(eq(matches.id, matchId));
    (match as any).events = events;

    const predictionResults = await this.predictions.scoreMatch(matchId);

    // fantasy lineups for this match
    const lineups = await this.db
      .select({ l: userLineups, t: userTeams })
      .from(userLineups)
      .innerJoin(userTeams, eq(userLineups.userTeamId, userTeams.id))
      .where(eq(userLineups.matchId, matchId));

    const homeCode = this.engineData.codeOfTeamId(match.homeTeamId!)!;
    const awayCode = this.engineData.codeOfTeamId(match.awayTeamId!)!;
    const simResultShape = {
      home: homeCode,
      away: awayCode,
      homeScore: match.homeScore ?? 0,
      awayScore: match.awayScore ?? 0,
      wentToExtraTime: match.homeScoreEt != null,
      wentToPenalties: match.homePenalties != null,
      winner: match.winnerTeamId ? this.engineData.codeOfTeamId(match.winnerTeamId) : null,
      events,
      stats: {
        home: emptyStats(match.homeScore ?? 0),
        away: emptyStats(match.awayScore ?? 0),
      },
      manOfTheMatch: null,
    };

    for (const { l, t } of lineups) {
      const xi = (l.startingXi as Array<{ playerId: number; slotId: string }>) ?? [];
      const selections = xi.map((s) => {
        const p = this.engineData.playersById.get(s.playerId);
        return {
          playerId: s.playerId,
          position: p?.position ?? 'MF',
          isStarter: true,
          isCaptain: l.captainPlayerId === s.playerId,
          isViceCaptain: l.viceCaptainPlayerId === s.playerId,
          team: t.countryCode,
        } as const;
      });
      const { total, lines } = scoreFantasyLineup(simResultShape as never, selections as never, {
        knockout: match.stage !== 'group',
      });
      await this.db
        .update(userLineups)
        .set({ pointsEarned: total, pointsBreakdown: lines as never, isLocked: true, updatedAt: new Date() })
        .where(eq(userLineups.id, l.id));
      await this.db
        .update(userTeams)
        .set({ totalPoints: t.totalPoints + total, updatedAt: new Date() })
        .where(eq(userTeams.id, t.id));
      await this.db.insert(notifications).values({
        userId: t.userId,
        type: 'match_result',
        title: `${homeCode} ${match.homeScore}-${match.awayScore} ${awayCode}`,
        body: `Your XI earned ${total} fantasy points.`,
        data: { matchNumber: match.matchNumber, points: total },
      });
      this.live.notifyUser(t.userId, { type: 'fantasy_points', matchNumber: match.matchNumber, points: total });
    }

    const affected = new Set<string>([
      ...predictionResults.map((r) => r.userId),
      ...lineups.map(({ t }) => t.userId),
    ]);
    for (const userId of affected) {
      await this.leaderboard.recomputeUser(userId);
    }
    for (const r of predictionResults) {
      await this.db.insert(notifications).values({
        userId: r.userId,
        type: 'prediction_scored',
        title: 'Prediction scored',
        body: `You earned ${r.points} points on match ${match.matchNumber}.`,
        data: { matchNumber: match.matchNumber, points: r.points },
      });
    }
    return affected.size;
  }

  /**
   * Resolves knockout participants from completed results:
   *  - all 72 group matches done → official Annex C population of matches 73–88
   *  - any later match whose two feeders are decided gets its teams set
   */
  async resolveBracket(): Promise<string[]> {
    const resolved: string[] = [];
    const all = await this.db.select().from(matches);
    const byNumber = new Map(all.map((m) => [m.matchNumber, m]));

    const groupMatches = all.filter((m) => m.stage === 'group');
    const groupsDone = groupMatches.every((m) => m.status === 'completed');

    if (groupsDone) {
      const r32 = all.filter((m) => m.stage === 'round32');
      const needsResolution = r32.some((m) => !m.homeTeamId || !m.awayTeamId);
      if (needsResolution) {
        const rng = mulberry32(20260611);
        const outcomes = {} as Record<GroupLetter, { winner: string; runnerUp: string; third: string }>;
        const thirds: Array<ReturnType<typeof computeStandings>[number] & { group: GroupLetter }> = [];
        for (const g of GROUPS as readonly GroupLetter[]) {
          const records: GroupMatchRecord[] = groupMatches
            .filter((m) => m.groupLetter === g)
            .map((m) => ({
              home: this.engineData.codeOfTeamId(m.homeTeamId!)!,
              away: this.engineData.codeOfTeamId(m.awayTeamId!)!,
              homeScore: m.homeScore ?? 0,
              awayScore: m.awayScore ?? 0,
              fairPlayHome: 0,
              fairPlayAway: 0,
            }));
          const codes = [...new Set(records.flatMap((r) => [r.home, r.away]))];
          const standings = computeStandings(codes, records, rng);
          outcomes[g] = { winner: standings[0].team, runnerUp: standings[1].team, third: standings[2].team };
          thirds.push({ ...standings[2], group: g });
        }
        const ranked = rankThirdPlacedTeams(thirds, rng) as typeof thirds;
        const [tournament] = await this.db.select().from(tournaments).where(eq(tournaments.year, 2026));
        const table = (tournament.formatConfig as any).thirdPlaceTable as ThirdPlaceTable;
        const schedule = all.map((m) => ({
          matchNumber: m.matchNumber,
          stage: m.stage,
          group: m.groupLetter as GroupLetter | null,
          kickoffUtc: m.matchDate.toISOString(),
          localDate: m.localDate,
          localTime: m.localTime,
          utcOffset: 0,
          venueId: m.venueId,
          home: (m.homeSlot ?? { type: 'team', code: this.engineData.codeOfTeamId(m.homeTeamId!)! }) as MatchSlot,
          away: (m.awaySlot ?? { type: 'team', code: this.engineData.codeOfTeamId(m.awayTeamId!)! }) as MatchSlot,
        }));
        const { r32: pairs } = resolveRoundOf32(
          schedule as never,
          outcomes,
          ranked.map((r) => r.group),
          table,
        );
        for (const [matchNumber, pair] of pairs) {
          const m = byNumber.get(matchNumber)!;
          if (!m.homeTeamId || !m.awayTeamId) {
            await this.db
              .update(matches)
              .set({
                homeTeamId: this.engineData.teamId(pair.home),
                awayTeamId: this.engineData.teamId(pair.away),
              })
              .where(eq(matches.id, m.id));
            resolved.push(`M${matchNumber}:${pair.home}-${pair.away}`);
          }
        }
      }
    }

    // later rounds from feeders
    for (const m of all.filter((x) => ['round16', 'quarterfinal', 'semifinal', 'third_place', 'final'].includes(x.stage))) {
      if (m.homeTeamId && m.awayTeamId) continue;
      const resolveSlot = (slot: MatchSlot | null): number | null => {
        if (!slot) return null;
        if (slot.type === 'matchWinner') {
          const feeder = byNumber.get(slot.match);
          return feeder?.status === 'completed' ? feeder.winnerTeamId : null;
        }
        if (slot.type === 'matchLoser') {
          const feeder = byNumber.get(slot.match);
          if (feeder?.status !== 'completed' || !feeder.winnerTeamId) return null;
          return feeder.winnerTeamId === feeder.homeTeamId ? feeder.awayTeamId : feeder.homeTeamId;
        }
        return null;
      };
      const homeId = m.homeTeamId ?? resolveSlot(m.homeSlot as MatchSlot);
      const awayId = m.awayTeamId ?? resolveSlot(m.awaySlot as MatchSlot);
      if ((homeId && homeId !== m.homeTeamId) || (awayId && awayId !== m.awayTeamId)) {
        await this.db
          .update(matches)
          .set({ homeTeamId: homeId ?? null, awayTeamId: awayId ?? null })
          .where(eq(matches.id, m.id));
        if (homeId && awayId) {
          resolved.push(`M${m.matchNumber}:${this.engineData.codeOfTeamId(homeId)}-${this.engineData.codeOfTeamId(awayId)}`);
        }
      }
    }

    if (resolved.length) await this.engineData.refresh();
    return resolved;
  }
}

const emptyStats = (goals: number) => ({
  goals,
  possession: 50,
  shots: 0,
  shotsOnTarget: 0,
  xG: 0,
  corners: 0,
  fouls: 0,
  yellowCards: 0,
  redCards: 0,
  passAccuracy: 0,
  saves: 0,
});
