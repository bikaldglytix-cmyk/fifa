import { Injectable } from '@nestjs/common';
import type { LiveMatchStateDto } from '@fifa/shared';

/** Internal live state (DTO minus the derived ageMs). */
export type LiveMatchState = Omit<LiveMatchStateDto, 'ageMs'>;

/**
 * In-memory registry of real live match states. Deliberately dependency-free
 * so both the feed poller (writer) and lifecycle/tournament/intelligence
 * readers can inject it without cycles. Self-healing: the poller refills it
 * from the feed within one tick after a restart, and verified results live in
 * PostgreSQL via the ingestion pipeline — nothing durable is stored here.
 */
@Injectable()
export class LiveStateStore {
  private readonly states = new Map<number, LiveMatchState>();

  get(matchNumber: number): LiveMatchState | undefined {
    return this.states.get(matchNumber);
  }

  set(state: LiveMatchState): void {
    this.states.set(state.matchNumber, state);
  }

  delete(matchNumber: number): void {
    this.states.delete(matchNumber);
  }

  all(): LiveMatchState[] {
    return [...this.states.values()].sort((a, b) => a.matchNumber - b.matchNumber);
  }

  /** DTO view with freshness, for API payloads. */
  dto(matchNumber: number): LiveMatchStateDto | null {
    const s = this.states.get(matchNumber);
    return s ? { ...s, ageMs: Date.now() - new Date(s.fetchedAt).getTime() } : null;
  }

  dtos(): LiveMatchStateDto[] {
    return this.all().map((s) => ({ ...s, ageMs: Date.now() - new Date(s.fetchedAt).getTime() }));
  }

  /** Fresh feed-derived phase for a match, if any (used by the lifecycle sweep). */
  freshPhase(matchNumber: number, maxAgeMs = 120_000): LiveMatchState['phase'] | null {
    const s = this.states.get(matchNumber);
    if (!s || s.finished) return null;
    if (Date.now() - new Date(s.fetchedAt).getTime() > maxAgeMs) return null;
    return s.phase;
  }
}
