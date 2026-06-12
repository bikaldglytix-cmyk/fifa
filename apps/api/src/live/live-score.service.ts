import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { matches } from '@fifa/db';
import { IN_PLAY_PHASES, type LiveMatchEventDto, type MatchPhase } from '@fifa/shared';
import { DbService } from '../common/db.service';
import { EventBusService } from '../common/event-bus.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LiveGateway } from '../live/live.gateway';
import { ResultIngestionService } from '../ingestion/result-ingestion.service';
import { LiveStateStore, type LiveMatchState } from './live-state.store';
import {
  FIFA_STATUS,
  buildResultEntry,
  calendarPath,
  eventsSafeToAttach,
  fifaGet,
  goalEventsFromTimeline,
  livePath,
  mapCalendarMatch,
  mapLiveDoc,
  parseMatchMinute,
  phaseFromFeed,
  playerDocName,
  playerPath,
  timelinePath,
  toSimMatchEvents,
  type FeedMatchSnapshot,
  type FifaCalendarMatchRaw,
  type FifaPlayerRaw,
  type FifaTimelineEventRaw,
  type SquadPlayerRef,
} from './fifa-feed';

/**
 * Real live-score sync (PRD: "World Cup Live Mode — real-time score sync with
 * FIFA"). Polls FIFA's public match-data API:
 *
 *  - one calendar request per tick covers status + score for ALL 104 matches
 *  - in-play matches additionally get the live doc (minute/period) and the
 *    timeline (goal events with scorer names)
 *  - state lands in LiveStateStore (in-memory, self-healing) and is broadcast
 *    over socket.io: per-match rooms get MATCH_LIVE_UPDATE, everyone gets a
 *    coalesced LIVE_SCORES_UPDATED for board refreshes
 *  - when the feed reports full time, a final-result claim is submitted to the
 *    consensus pipeline as source 'fifa' — the existing clock-plausibility
 *    gate and multi-source consensus still decide when a match COMPLETES.
 *    The live feed never writes scores to the matches table directly.
 *
 * Cadence: hot (default 20s) while anything is in play or near kickoff,
 * idle (default 5 min) otherwise. Disabled by DISABLE_SCHEDULER=true (tests)
 * or LIVE_FEED=off.
 */
@Injectable()
export class LiveScoreService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LiveScoreService.name);
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  /** matchNumber → FIFA ids (from the first successful calendar fetch). */
  private index = new Map<number, { idStage: string; idMatch: string }>();
  /** matches whose final result we already claimed this process. */
  private readonly claimed = new Set<number>();
  /** knockout matches observed in an extra-time period. */
  private readonly etSeen = new Set<number>();
  /** matches where FIFA's home/away orientation is the reverse of ours. */
  private readonly flippedNumbers = new Set<number>();

  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly store: LiveStateStore,
    private readonly live: LiveGateway,
    private readonly ingestion: ResultIngestionService,
    private readonly bus: EventBusService,
  ) {}

  private get hotMs(): number {
    return Number(process.env.LIVE_FEED_POLL_MS ?? 20_000);
  }
  private get idleMs(): number {
    return Number(process.env.LIVE_FEED_IDLE_MS ?? 300_000);
  }

  onModuleInit(): void {
    // verified completion → the live ticker for that match is done
    // (registered even when polling is off: manual states need cleanup too)
    this.bus.on('match.completed', (e) => {
      this.store.delete(e.matchNumber);
      this.live.broadcastLiveScores();
    });
    if (process.env.DISABLE_SCHEDULER === 'true' || process.env.LIVE_FEED === 'off') {
      this.logger.log('live feed polling disabled (DISABLE_SCHEDULER / LIVE_FEED=off)');
      return;
    }
    this.schedule(2_000); // first tick shortly after boot (also catch-up)
    this.logger.log('FIFA live-score sync armed');
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  /** One poll pass. Always reschedules itself; cadence derived from activity. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    let hot = false;
    try {
      hot = await this.poll();
    } catch (e) {
      this.logger.warn(`live feed tick failed: ${e}`);
    } finally {
      this.ticking = false;
      this.schedule(hot ? this.hotMs : this.idleMs);
    }
  }

  /** @returns true when the next tick should use the hot cadence. */
  private async poll(): Promise<boolean> {
    await this.dbs.ensureReady();
    const db = this.dbs.db;
    const rows = await db
      .select({
        matchNumber: matches.matchNumber,
        stage: matches.stage,
        status: matches.status,
        matchDate: matches.matchDate,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
      })
      .from(matches);
    const byNumber = new Map(rows.map((r) => [r.matchNumber, r]));

    const cal = await fifaGet<{ Results: FifaCalendarMatchRaw[] }>(calendarPath());
    if (!cal?.Results?.length) {
      this.logger.warn('FIFA calendar unreachable — keeping last known live states');
      return this.anyActivity(rows, Date.now());
    }

    let changed = false;
    let anyLive = false;

    for (const raw of cal.Results) {
      const snap = mapCalendarMatch(raw);
      if (!snap) continue;
      const row = byNumber.get(snap.matchNumber);
      if (!row) continue;
      this.index.set(snap.matchNumber, { idStage: snap.idStage, idMatch: snap.idMatch });

      if (snap.matchStatus === FIFA_STATUS.LIVE) anyLive = true;

      // verified-complete matches need no live state
      if (row.status === 'completed') {
        if (this.store.get(snap.matchNumber)) {
          this.store.delete(snap.matchNumber);
          changed = true;
        }
        continue;
      }

      const isLive = snap.matchStatus === FIFA_STATUS.LIVE;
      const isFinished = snap.matchStatus === FIFA_STATUS.FINISHED && snap.homeScore != null;
      if (!isLive && !isFinished) continue;

      // orientation guard: FIFA home/away vs our fixture orientation
      const oriented = this.orient(snap, row.homeTeamId, row.awayTeamId);

      let events: LiveMatchEventDto[] = this.store.get(snap.matchNumber)?.events ?? [];
      let merged: FeedMatchSnapshot = oriented;

      if (isLive) {
        const fresh = await this.fetchLiveDetail(oriented);
        merged = fresh.snapshot;
        events = fresh.events.length ? fresh.events : events;
        if ((merged.period ?? 0) >= 7) this.etSeen.add(snap.matchNumber);
      }

      const phase = phaseFromFeed(merged.matchStatus, merged.period) ?? (isFinished ? 'awaiting_result' : 'live');
      const next: LiveMatchState = {
        matchNumber: merged.matchNumber,
        source: 'fifa',
        phase: phase as MatchPhase,
        minute: parseMatchMinute(merged.minuteLabel),
        minuteLabel: merged.minuteLabel,
        period: merged.period,
        homeCode: this.codeOf(row.homeTeamId) ?? merged.homeCode ?? '?',
        awayCode: this.codeOf(row.awayTeamId) ?? merged.awayCode ?? '?',
        homeScore: merged.homeScore ?? 0,
        awayScore: merged.awayScore ?? 0,
        homePenalties: merged.homePenalties,
        awayPenalties: merged.awayPenalties,
        attendance: merged.attendance,
        events,
        finished: isFinished,
        fetchedAt: new Date().toISOString(),
      };

      const prev = this.store.get(next.matchNumber);
      // an admin manual override outranks the feed while it is fresh (≤10 min)
      if (prev?.source === 'official_admin' && Date.now() - new Date(prev.fetchedAt).getTime() < 600_000 && !isFinished) {
        continue;
      }
      this.store.set(next);

      if (this.materiallyChanged(prev, next)) {
        changed = true;
        const lastEvent = next.events.length ? next.events[next.events.length - 1] : null;
        this.live.broadcastLiveState(next.matchNumber, {
          kind: 'live_state',
          state: this.store.dto(next.matchNumber)!,
          lastEvent,
        });
        this.logger.log(
          `M${next.matchNumber} ${next.homeCode} ${next.homeScore}–${next.awayScore} ${next.awayCode}` +
            ` [${next.minuteLabel ?? next.phase}${next.finished ? ' FT' : ''}] (fifa)`,
        );
      }

      if (isFinished && !this.claimed.has(next.matchNumber)) {
        await this.submitFinalResult(merged, row.stage);
      }
    }

    if (changed) this.live.broadcastLiveScores();
    return anyLive || this.anyActivity(rows, Date.now());
  }

  /** Live doc + timeline for an in-play match (fresher minute, goal events). */
  private async fetchLiveDetail(
    snap: FeedMatchSnapshot,
  ): Promise<{ snapshot: FeedMatchSnapshot; events: LiveMatchEventDto[] }> {
    const ids = this.index.get(snap.matchNumber);
    if (!ids) return { snapshot: snap, events: [] };

    const [liveDoc, timeline] = await Promise.all([
      fifaGet<Record<string, unknown>>(livePath(ids.idStage, ids.idMatch)),
      fifaGet<{ Event?: FifaTimelineEventRaw[] }>(timelinePath(ids.idStage, ids.idMatch)),
    ]);

    let merged = snap;
    if (liveDoc) {
      const partial = mapLiveDoc(liveDoc as never);
      // live doc reports in FIFA orientation; re-orient if our fixture is flipped
      const flipped = this.flippedNumbers.has(snap.matchNumber);
      merged = {
        ...snap,
        ...partial,
        homeScore: flipped ? (partial.awayScore ?? snap.homeScore) : (partial.homeScore ?? snap.homeScore),
        awayScore: flipped ? (partial.homeScore ?? snap.awayScore) : (partial.awayScore ?? snap.awayScore),
        homePenalties: flipped ? (partial.awayPenalties ?? null) : (partial.homePenalties ?? null),
        awayPenalties: flipped ? (partial.homePenalties ?? null) : (partial.awayPenalties ?? null),
      };
    }

    // snap is already oriented: fifaHomeTeamId is the FIFA id of OUR home side
    const events = goalEventsFromTimeline(
      timeline?.Event,
      snap.fifaHomeTeamId,
      merged.homeCode ?? '?',
      merged.awayCode ?? '?',
    );
    return { snapshot: merged, events };
  }

  private orient(snap: FeedMatchSnapshot, homeTeamId: number | null, awayTeamId: number | null): FeedMatchSnapshot {
    const ourHome = this.codeOf(homeTeamId);
    const ourAway = this.codeOf(awayTeamId);
    if (!ourHome || !ourAway || !snap.homeCode || !snap.awayCode) return snap;
    if (snap.homeCode === ourHome) {
      this.flippedNumbers.delete(snap.matchNumber);
      return snap;
    }
    if (snap.homeCode === ourAway && snap.awayCode === ourHome) {
      this.flippedNumbers.add(snap.matchNumber);
      this.logger.warn(`M${snap.matchNumber}: FIFA orientation flipped vs fixture — re-orienting scores`);
      return {
        ...snap,
        homeCode: snap.awayCode,
        awayCode: snap.homeCode,
        fifaHomeTeamId: snap.fifaAwayTeamId,
        fifaAwayTeamId: snap.fifaHomeTeamId,
        homeScore: snap.awayScore,
        awayScore: snap.homeScore,
        homePenalties: snap.awayPenalties,
        awayPenalties: snap.homePenalties,
      };
    }
    this.logger.warn(`M${snap.matchNumber}: FIFA codes ${snap.homeCode}/${snap.awayCode} ≠ fixture ${ourHome}/${ourAway}`);
    return snap;
  }

  /** Feed says FT → submit a final-result claim (consensus + clock gate decide). */
  private async submitFinalResult(snap: FeedMatchSnapshot, stage: string): Promise<void> {
    let goals = this.store.get(snap.matchNumber)?.events ?? [];
    // fetch the complete goal list fresh at FT — it feeds stat lines and
    // first-scorer settlement everywhere, plus the 90'/ET split in knockouts
    const ids = this.index.get(snap.matchNumber);
    if (ids) {
      const timeline = await fifaGet<{ Event?: FifaTimelineEventRaw[] }>(timelinePath(ids.idStage, ids.idMatch));
      if (timeline?.Event?.length) {
        // snap is already oriented: fifaHomeTeamId is the FIFA id of OUR home side
        goals = goalEventsFromTimeline(timeline.Event, snap.fifaHomeTeamId, snap.homeCode ?? '?', snap.awayCode ?? '?');
      }
    }
    const wentToExtraTime =
      this.etSeen.has(snap.matchNumber) ||
      (snap.homePenalties != null && snap.awayPenalties != null) ||
      (stage !== 'group' && goals.some((g) => g.minute > 90));
    const entry = buildResultEntry(snap, stage, goals, { wentToExtraTime });
    if (!entry) return;
    if (stage !== 'group' && wentToExtraTime && goals.length !== (snap.homeScore ?? 0) + (snap.awayScore ?? 0)) {
      this.logger.warn(`M${snap.matchNumber}: timeline incomplete — 90'/ET split degraded to final score`);
    }

    // scorer names → squad player ids (stat lines, first-scorer settlement)
    const { events, aligned, unresolved } = await this.resolveGoals(goals, {
      home: this.squadRefs(snap.homeCode),
      away: this.squadRefs(snap.awayCode),
    });
    if (unresolved.length) {
      this.logger.warn(`M${snap.matchNumber}: unresolved scorer(s) — ${unresolved.join('; ')}`);
    }
    if (eventsSafeToAttach(goals, aligned, entry.homeScoreEt ?? entry.homeScore, entry.awayScoreEt ?? entry.awayScore)) {
      entry.events = events;
    } else if (goals.length) {
      this.logger.warn(
        `M${snap.matchNumber}: goal events omitted from claim (timeline incomplete or opening scorer unresolved) — score-only result`,
      );
    }
    try {
      const out = await this.ingestion.submitClaim('fifa', entry);
      this.claimed.add(snap.matchNumber);
      this.logger.log(
        `M${snap.matchNumber} FT ${entry.homeScore}–${entry.awayScore}` +
          (entry.homeScoreEt != null ? ` (aet ${entry.homeScoreEt}–${entry.awayScoreEt})` : '') +
          ` → claim ${out.accepted ? 'ACCEPTED' : out.held ? `HELD until ${out.earliestAcceptanceUtc}` : 'pending consensus'}`,
      );
    } catch (e: any) {
      if (String(e?.message ?? e).includes('already completed')) {
        this.claimed.add(snap.matchNumber);
      } else {
        this.logger.warn(`M${snap.matchNumber}: result claim failed — ${e?.message ?? e}`);
      }
    }
  }

  private codeOf(teamId: number | null): string | null {
    return teamId ? (this.engineData.codeOfTeamId(teamId) ?? null) : null;
  }

  /** Squad references for scorer-name resolution (empty when code unknown). */
  private squadRefs(code: string | null): SquadPlayerRef[] {
    if (!code) return [];
    const out: SquadPlayerRef[] = [];
    for (const p of this.engineData.playersById.values()) {
      if (p.countryCode === code) out.push({ id: p.id, name: p.name, countryCode: p.countryCode });
    }
    return out;
  }

  /** feed player id → canonical full name (cached for the process lifetime). */
  private readonly feedPlayerNames = new Map<string, string | null>();

  /**
   * Two-pass scorer resolution. Display names settle most goals; for the
   * rest (shirt names like "RAÚL" that are ambiguous when a squad carries
   * two Raúls), the feed's player doc supplies the canonical full name.
   */
  private async resolveGoals(
    goals: LiveMatchEventDto[],
    squads: { home: SquadPlayerRef[]; away: SquadPlayerRef[] },
  ): Promise<ReturnType<typeof toSimMatchEvents>> {
    const first = toSimMatchEvents(goals, squads);
    if (!first.unresolved.length) return first;

    const patched = [...goals];
    let changed = false;
    for (let i = 0; i < goals.length; i++) {
      if (first.aligned[i] != null) continue;
      const fid = goals[i].feedPlayerId;
      if (!fid) continue;
      let full = this.feedPlayerNames.get(fid);
      if (full === undefined) {
        full = playerDocName(await fifaGet<FifaPlayerRaw>(playerPath(fid)));
        this.feedPlayerNames.set(fid, full);
      }
      if (full && full !== goals[i].player) {
        patched[i] = { ...goals[i], player: full };
        changed = true;
      }
    }
    return changed ? toSimMatchEvents(patched, squads) : first;
  }

  /** Worth broadcasting? Score, phase, minute, FT flag or new events changed. */
  private materiallyChanged(prev: LiveMatchState | undefined, next: LiveMatchState): boolean {
    if (!prev) return true;
    return (
      prev.homeScore !== next.homeScore ||
      prev.awayScore !== next.awayScore ||
      prev.phase !== next.phase ||
      prev.minute !== next.minute ||
      prev.finished !== next.finished ||
      prev.events.length !== next.events.length ||
      prev.homePenalties !== next.homePenalties ||
      prev.awayPenalties !== next.awayPenalties
    );
  }

  private anyActivity(
    rows: Array<{ status: string; matchDate: Date }>,
    now: number,
  ): boolean {
    return rows.some(
      (r) =>
        IN_PLAY_PHASES.includes(r.status as never) ||
        r.status === 'awaiting_result' ||
        (r.status !== 'completed' && Math.abs(r.matchDate.getTime() - now) <= 30 * 60_000),
    );
  }
}
