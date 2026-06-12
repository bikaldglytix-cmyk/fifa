import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { matches, predictionSnapshots, venues } from '@fifa/db';
import type { AiPredictionV2, MatchPhase } from '@fifa/shared';
import {
  assembleExtras,
  predictMatch,
  MODEL_VERSION,
  type ItineraryStop,
  type MatchExtras,
} from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LiveStateStore } from '../live/live-state.store';
import { TournamentService } from '../tournament/tournament.service';

/**
 * Match intelligence: assembles the full situational-factor bundle for a
 * fixture from verified platform data (itineraries, venue reference data,
 * live standings for must-win math), runs the v2 prediction model, and
 * maintains the snapshot audit trail — every prediction change is recorded
 * with its trigger.
 */
@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly tournament: TournamentService,
    private readonly liveStore: LiveStateStore,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  /** Itinerary of matches a team has actually contested before a given kickoff. */
  private async itineraryFor(teamId: number, before: Date): Promise<ItineraryStop[]> {
    const rows = await this.db
      .select({ matchDate: matches.matchDate, venueId: matches.venueId, status: matches.status })
      .from(matches)
      .where(or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)))
      .orderBy(asc(matches.matchDate));
    return rows
      .filter((m) => m.matchDate.getTime() < before.getTime())
      .filter((m) => ['completed', 'live', 'half_time', 'extra_time', 'penalties', 'awaiting_result'].includes(m.status))
      .map((m) => ({ date: m.matchDate, venueId: m.venueId }));
  }

  /** Matchday-3 elimination math from the live group table. */
  private async mustWinFlags(match: { stage: string; groupLetter: string | null; matchday: number | null }, homeCode: string, awayCode: string) {
    if (match.stage !== 'group' || !match.groupLetter || (match.matchday ?? 1) < 2) {
      return { home: false, away: false };
    }
    const standings = await this.tournament.groupStandings();
    const table = standings[match.groupLetter] ?? [];
    const need = (code: string): boolean => {
      const row = table.find((r: any) => r.team === code);
      if (!row || row.played === 0) return false;
      const remaining = 3 - row.played;
      // cannot reach 2nd place's likely cut (~4 pts safe) without winning out
      return row.points + remaining * 3 >= 4 && row.points + (remaining - 1) * 3 + 1 < 4;
    };
    return { home: need(homeCode), away: need(awayCode) };
  }

  /** Full factor bundle for a fixture, from verified data only. */
  async extrasFor(matchNumber: number): Promise<MatchExtras | undefined> {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m || !m.homeTeamId || !m.awayTeamId) return undefined;
    const [venue] = await this.db.select().from(venues).where(eq(venues.id, m.venueId));
    const homeCode = this.engineData.codeOfTeamId(m.homeTeamId)!;
    const awayCode = this.engineData.codeOfTeamId(m.awayTeamId)!;
    const home = this.engineData.team(homeCode);
    const away = this.engineData.team(awayCode);
    const ctx = {
      stage: m.stage,
      matchNumber,
      venueCountry: this.engineData.venueCountry(matchNumber),
      knockout: m.stage !== 'group',
    } as const;

    const [homeItinerary, awayItinerary, mustWin] = await Promise.all([
      this.itineraryFor(m.homeTeamId, m.matchDate),
      this.itineraryFor(m.awayTeamId, m.matchDate),
      this.mustWinFlags(m, homeCode, awayCode),
    ]);

    return assembleExtras(home, away, ctx, this.engineData.h2hFor(homeCode, awayCode), {
      venueId: m.venueId,
      venueMeta: { name: venue?.name ?? m.venueId, city: venue?.city ?? '', capacity: venue?.capacity ?? 0 },
      matchDate: m.matchDate,
      homeItinerary,
      awayItinerary,
      mustWinHome: mustWin.home,
      mustWinAway: mustWin.away,
    });
  }

  /** Latest snapshot for the current model version, computing one if absent. */
  async predictionFor(matchNumber: number, opts: { recompute?: boolean; trigger?: string } = {}): Promise<AiPredictionV2 | { pending: true }> {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m) throw new NotFoundException(`No match #${matchNumber}`);
    if (!m.homeTeamId || !m.awayTeamId) return { pending: true };

    if (!opts.recompute) {
      const [latest] = await this.db
        .select()
        .from(predictionSnapshots)
        .where(and(eq(predictionSnapshots.matchId, m.id), eq(predictionSnapshots.modelVersion, MODEL_VERSION)))
        .orderBy(desc(predictionSnapshots.computedAt))
        .limit(1);
      if (latest) return latest.prediction as AiPredictionV2;
    }
    return this.computeAndSnapshot(matchNumber, opts.trigger ?? 'initial');
  }

  async computeAndSnapshot(matchNumber: number, trigger: string): Promise<AiPredictionV2 | { pending: true }> {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m?.homeTeamId || !m?.awayTeamId) return { pending: true };
    const homeCode = this.engineData.codeOfTeamId(m.homeTeamId)!;
    const awayCode = this.engineData.codeOfTeamId(m.awayTeamId)!;

    const prediction = predictMatch({
      home: this.engineData.team(homeCode),
      away: this.engineData.team(awayCode),
      ctx: {
        stage: m.stage,
        matchNumber,
        venueCountry: this.engineData.venueCountry(matchNumber),
        knockout: m.stage !== 'group',
      },
      h2h: this.engineData.h2hFor(homeCode, awayCode),
      extras: await this.extrasFor(matchNumber),
    });

    await this.db.insert(predictionSnapshots).values({
      matchId: m.id,
      modelVersion: MODEL_VERSION,
      trigger,
      prediction: prediction as never,
    });
    return prediction;
  }

  /** Regenerate snapshots for all undecided matches involving the given teams. */
  async recomputeForTeams(codes: string[], trigger: string): Promise<number> {
    if (!codes.length) return 0;
    const ids = codes.map((c) => this.engineData.teamId(c));
    const rows = await this.db
      .select({ matchNumber: matches.matchNumber, status: matches.status, homeTeamId: matches.homeTeamId, awayTeamId: matches.awayTeamId })
      .from(matches)
      .where(inArray(matches.status, ['scheduled', 'pre_match']));
    let n = 0;
    for (const r of rows) {
      if ((r.homeTeamId && ids.includes(r.homeTeamId)) || (r.awayTeamId && ids.includes(r.awayTeamId))) {
        await this.computeAndSnapshot(r.matchNumber, trigger);
        n++;
      }
    }
    this.logger.log(`regenerated ${n} prediction snapshots (${trigger}: ${codes.join(',')})`);
    return n;
  }

  /** Prediction audit trail: how the model's view of a match evolved and why. */
  async snapshotHistory(matchNumber: number) {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m) throw new NotFoundException(`No match #${matchNumber}`);
    const rows = await this.db
      .select()
      .from(predictionSnapshots)
      .where(eq(predictionSnapshots.matchId, m.id))
      .orderBy(desc(predictionSnapshots.computedAt))
      .limit(50);
    return rows.map((r) => {
      const p = r.prediction as AiPredictionV2;
      return {
        id: r.id,
        modelVersion: r.modelVersion,
        trigger: r.trigger,
        computedAt: r.computedAt,
        homeWin: p.homeWin,
        draw: p.draw,
        awayWin: p.awayWin,
        predictedScore: p.predictedScore,
        confidence: p.confidence,
        upsetTier: p.upset?.tier ?? null,
      };
    });
  }

  /**
   * Compact prediction summaries for the match board — every match that is
   * in play or kicks off within the window, snapshot-backed (cheap reads).
   */
  async board(hoursAhead = 72) {
    const rows = await this.db.select().from(matches).orderBy(asc(matches.matchDate));
    const now = Date.now();
    const horizon = now + hoursAhead * 3_600_000;
    const wanted = rows.filter(
      (m) =>
        m.homeTeamId && m.awayTeamId &&
        (['live', 'half_time', 'extra_time', 'penalties', 'awaiting_result', 'pre_match'].includes(m.status) ||
          (m.status === 'scheduled' && m.matchDate.getTime() <= horizon) ||
          (m.status === 'completed' && now - m.matchDate.getTime() <= 24 * 3_600_000)),
    );
    const out = [];
    for (const m of wanted) {
      const p = await this.predictionFor(m.matchNumber);
      const v2 = p as AiPredictionV2;
      out.push({
        matchNumber: m.matchNumber,
        phase: m.status as MatchPhase,
        kickoffUtc: m.matchDate.toISOString(),
        stage: m.stage,
        groupLetter: m.groupLetter,
        venueId: m.venueId,
        home: this.engineData.codeOfTeamId(m.homeTeamId!),
        away: this.engineData.codeOfTeamId(m.awayTeamId!),
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        // real feed state while in play / awaiting result verification
        live: m.status === 'completed' ? null : this.liveStore.dto(m.matchNumber),
        prediction: 'pending' in v2 ? null : {
          homeWin: v2.homeWin,
          draw: v2.draw,
          awayWin: v2.awayWin,
          predictedScore: v2.predictedScore,
          confidence: v2.confidence,
          confidenceLevel: v2.explanation.confidenceLevel,
          upset: { tier: v2.upset.tier, score: v2.upset.score, underdog: v2.upset.underdog },
          conditions: v2.conditions ? { city: v2.conditions.city, avgHighC: v2.conditions.avgHighC, altitudeM: v2.conditions.altitudeM } : null,
        },
      });
    }
    return out;
  }

  /** Full intelligence panel for the match page. */
  async panel(matchNumber: number) {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m) throw new NotFoundException(`No match #${matchNumber}`);
    const prediction = await this.predictionFor(matchNumber);
    return {
      matchNumber,
      phase: m.status as MatchPhase,
      kickoffUtc: m.matchDate.toISOString(),
      home: m.homeTeamId ? this.engineData.codeOfTeamId(m.homeTeamId) : null,
      away: m.awayTeamId ? this.engineData.codeOfTeamId(m.awayTeamId) : null,
      prediction,
    };
  }
}
