import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, lte, ne } from 'drizzle-orm';
import { matches, userLineups } from '@fifa/db';
import { IN_PLAY_PHASES, LINEUP_LOCK_MINUTES_BEFORE_KICKOFF, type MatchPhase } from '@fifa/shared';
import { DbService } from '../common/db.service';
import { EventBusService } from '../common/event-bus.service';
import { LiveGateway } from '../live/live.gateway';
import { LiveStateStore } from '../live/live-state.store';

/**
 * Autonomous match lifecycle. Phases advance purely from the official
 * schedule clock — there is no manual status toggle anywhere in the system:
 *
 *   scheduled → pre_match (T-75') → live → half_time → live → awaiting_result
 *
 * `completed` is only ever set by the result-ingestion pipeline once verified
 * source consensus exists; `postponed`/`cancelled` only by operational
 * ingestion. Without a configured live event feed the clock model cannot
 * observe extra time/penalties, so in-play knockout matches conservatively
 * hold `live` until FT+ET window lapses, then `awaiting_result` — the
 * extra_time/penalties phases are set when ingestion provides them.
 */

const MIN = 60_000;
const PRE_MATCH_MIN = LINEUP_LOCK_MINUTES_BEFORE_KICKOFF; // 75'
const FIRST_HALF_END = 49; // 45' + stoppage
const SECOND_HALF_START = 64; // 15' interval
/** Earliest a match decided in 90' can plausibly be over (kickoff + 90' + HT + stoppage). */
export const FT_GROUP = 112;
/** Earliest a knockout match needing ET/penalties can plausibly be over. */
export const FT_KNOCKOUT = 152;

/** Pure clock → phase mapping (exported for tests). */
export function clockPhase(kickoff: Date, now: Date, knockout: boolean): MatchPhase {
  const mins = (now.getTime() - kickoff.getTime()) / MIN;
  if (mins < -PRE_MATCH_MIN) return 'scheduled';
  if (mins < 0) return 'pre_match';
  if (mins < FIRST_HALF_END) return 'live';
  if (mins < SECOND_HALF_START) return 'half_time';
  if (mins < FT_GROUP) return 'live';
  if (knockout && mins < FT_KNOCKOUT) return 'extra_time';
  return 'awaiting_result';
}

/** Phases the sweep may never overwrite (set by ingestion/operations only). */
const PROTECTED: MatchPhase[] = ['completed', 'postponed', 'cancelled'];

@Injectable()
export class MatchLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MatchLifecycleService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dbs: DbService,
    private readonly bus: EventBusService,
    private readonly live: LiveGateway,
    private readonly liveStore: LiveStateStore,
  ) {}

  /** Test/ops override: shift the lifecycle clock without touching data. */
  now(): Date {
    const offset = Number(process.env.SIM_CLOCK_OFFSET_MS ?? 0);
    return new Date(Date.now() + (Number.isFinite(offset) ? offset : 0));
  }

  onModuleInit(): void {
    if (process.env.DISABLE_SCHEDULER === 'true') return;
    const every = Number(process.env.LIFECYCLE_SWEEP_MS ?? 30_000);
    this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.warn(`sweep failed: ${e}`)), every);
    this.timer.unref?.();
    void this.sweep().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: advance phases from the clock, lock due lineups. */
  async sweep(): Promise<{ transitions: number }> {
    await this.dbs.ensureReady();
    const db = this.dbs.db;
    const now = this.now();

    const rows = await db
      .select({
        id: matches.id,
        matchNumber: matches.matchNumber,
        stage: matches.stage,
        status: matches.status,
        matchDate: matches.matchDate,
      })
      .from(matches)
      .where(ne(matches.status, 'completed'));

    let transitions = 0;
    for (const m of rows) {
      if (PROTECTED.includes(m.status as MatchPhase)) continue;
      const clockNext = clockPhase(m.matchDate, now, m.stage !== 'group');
      // a fresh live feed refines in-play phases (exact half-time, extra time,
      // penalties — things the pure clock can only approximate). It can never
      // pull a match back before kickoff or complete it; the clock and the
      // ingestion pipeline keep those authorities.
      const feedPhase = this.liveStore.freshPhase(m.matchNumber);
      const next =
        feedPhase && IN_PLAY_PHASES.includes(feedPhase) && clockNext !== 'scheduled' && clockNext !== 'pre_match'
          ? feedPhase
          : clockNext;
      if (next === m.status) continue;

      await db.update(matches).set({ status: next as never }).where(eq(matches.id, m.id));
      transitions++;
      this.bus.emit('match.phase_changed', {
        matchNumber: m.matchNumber,
        from: m.status as MatchPhase,
        to: next,
        at: now.toISOString(),
      });
      this.live.broadcastPhase(m.matchNumber, { matchNumber: m.matchNumber, phase: next, at: now.toISOString() });
      this.logger.log(`M${m.matchNumber}: ${m.status} → ${next} (clock)`);

      // entering pre_match locks lineups (official-lineup release time)
      if (next === 'pre_match') {
        const locked = await db
          .update(userLineups)
          .set({ isLocked: true, updatedAt: now })
          .where(and(eq(userLineups.matchId, m.id), eq(userLineups.isLocked, false)))
          .returning({ id: userLineups.id });
        if (locked.length) {
          this.live.broadcastLineupOfficial(m.matchNumber, { matchNumber: m.matchNumber, lockedAt: now.toISOString() });
        }
      }
    }

    // safety net: lock lineups for anything inside the lock window regardless of phase
    const lockDeadline = new Date(now.getTime() + PRE_MATCH_MIN * MIN);
    const due = await db
      .select({ id: matches.id })
      .from(matches)
      .where(and(inArray(matches.status, ['scheduled', 'pre_match']), lte(matches.matchDate, lockDeadline)));
    if (due.length) {
      await db
        .update(userLineups)
        .set({ isLocked: true, updatedAt: now })
        .where(and(inArray(userLineups.matchId, due.map((d) => d.id)), eq(userLineups.isLocked, false)));
    }

    return { transitions };
  }

  /** The phase a match would be in right now if no result existed (used by retraction). */
  phaseFor(matchDate: Date, knockout: boolean): MatchPhase {
    return clockPhase(matchDate, this.now(), knockout);
  }
}
