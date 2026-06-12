import { Injectable, Logger } from '@nestjs/common';
import type { MatchPhase } from '@fifa/shared';

/**
 * In-process typed event bus — the spine of the autonomous pipeline.
 * Completion, retraction and phase changes fan out to standings, model
 * recalibration, bracket resolution and realtime broadcast without any
 * component knowing about the others.
 */

export interface PlatformEvents {
  'match.phase_changed': { matchNumber: number; from: MatchPhase; to: MatchPhase; at: string };
  'match.completed': { matchNumber: number; homeCode: string; awayCode: string; homeScore: number; awayScore: number; source: string };
  'match.retracted': { matchNumber: number; reason: string };
  'model.recalibrated': { modelVersion: number; trigger: string; affectedTeams: string[] };
  'standings.updated': { groups: string[] };
}

type Handler<K extends keyof PlatformEvents> = (payload: PlatformEvents[K]) => void | Promise<void>;

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);
  private readonly handlers = new Map<keyof PlatformEvents, Set<Handler<never>>>();

  on<K extends keyof PlatformEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as Handler<never>);
    this.handlers.set(event, set);
    return () => set.delete(handler as Handler<never>);
  }

  /** Fire-and-forget with isolation: one failing subscriber never blocks the rest. */
  emit<K extends keyof PlatformEvents>(event: K, payload: PlatformEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set?.size) return;
    for (const handler of set) {
      void Promise.resolve()
        .then(() => (handler as Handler<K>)(payload))
        .catch((e) => this.logger.error(`subscriber for ${String(event)} failed: ${e?.message ?? e}`));
    }
  }
}
