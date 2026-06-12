import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { WS_EVENTS, type LiveTickPayload, type SimMatchEvent } from '@fifa/shared';
import { mulberry32, randomSeed, simulateMatch } from '@fifa/sim-engine';
import { EngineDataService } from '../engine/engine-data.service';

/**
 * Realtime gateway (socket.io):
 *  - room-based match subscriptions (`match:<n>`) and leaderboard updates
 *  - "live replay": simulates a match minute-by-minute at a chosen speed and
 *    streams ticks — the in-app live experience for any fixture
 *  - admin-entered real results broadcast to subscribed rooms
 */
@WebSocketGateway({
  cors: { origin: (process.env.WEB_ORIGINS ?? 'http://localhost:3100').split(',') },
})
export class LiveGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveGateway.name);
  private readonly liveLoops = new Map<string, NodeJS.Timeout>();

  constructor(private readonly engineData: EngineDataService) {}

  handleConnection(socket: Socket): void {
    this.logger.debug(`connected ${socket.id}`);
  }

  handleDisconnect(socket: Socket): void {
    const loop = this.liveLoops.get(socket.id);
    if (loop) {
      clearInterval(loop);
      this.liveLoops.delete(socket.id);
    }
  }

  @SubscribeMessage(WS_EVENTS.SUBSCRIBE_MATCH)
  onSubscribeMatch(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchNumber: number }): void {
    socket.join(`match:${body.matchNumber}`);
  }

  @SubscribeMessage(WS_EVENTS.UNSUBSCRIBE_MATCH)
  onUnsubscribeMatch(@ConnectedSocket() socket: Socket, @MessageBody() body: { matchNumber: number }): void {
    socket.leave(`match:${body.matchNumber}`);
  }

  @SubscribeMessage(WS_EVENTS.SUBSCRIBE_LEADERBOARD)
  onSubscribeLeaderboard(@ConnectedSocket() socket: Socket): void {
    socket.join('leaderboard');
  }

  /**
   * Simulated live replay: the server simulates the match once, then streams
   * it to THIS socket minute-by-minute. speed = game-minutes per real second.
   */
  @SubscribeMessage(WS_EVENTS.START_LIVE_SIM)
  onStartLive(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { matchNumber?: number; homeCode?: string; awayCode?: string; speed?: number; seed?: number },
  ): void {
    let homeCode = body.homeCode?.toUpperCase();
    let awayCode = body.awayCode?.toUpperCase();
    let stage: 'group' | 'round16' = 'group';
    let venueCountry: 'USA' | 'MEX' | 'CAN' = 'USA';
    const matchNumber = body.matchNumber ?? 0;

    if (body.matchNumber) {
      const m = this.engineData.scheduledMatch(body.matchNumber);
      if (m.home.type === 'team' && m.away.type === 'team') {
        homeCode = m.home.code;
        awayCode = m.away.code;
        stage = m.stage === 'group' ? 'group' : 'round16';
        venueCountry = this.engineData.venueCountry(m.matchNumber);
      }
    }
    if (!homeCode || !awayCode) {
      socket.emit('error', { message: 'Provide matchNumber or homeCode/awayCode' });
      return;
    }

    const result = simulateMatch(
      {
        home: this.engineData.team(homeCode),
        away: this.engineData.team(awayCode),
        ctx: { stage, matchNumber, venueCountry, knockout: stage !== 'group' },
        h2h: this.engineData.h2hFor(homeCode, awayCode),
      },
      { rng: mulberry32((body.seed ?? randomSeed()) >>> 0), knockout: stage !== 'group', withEvents: true },
    );

    const speed = Math.min(30, Math.max(0.5, body.speed ?? 3));
    const totalMinutes = result.wentToExtraTime ? 120 : 90;
    let minute = 0;
    let homeScore = 0;
    let awayScore = 0;

    const existing = this.liveLoops.get(socket.id);
    if (existing) clearInterval(existing);

    const interval = setInterval(() => {
      minute += 1;
      const eventsNow: SimMatchEvent[] = result.events.filter((e) => e.minute === minute);
      for (const ev of eventsNow) {
        if (ev.type === 'goal' || ev.type === 'penalty_goal' || ev.type === 'own_goal') {
          if (ev.team === homeCode) homeScore++;
          else awayScore++;
        }
      }
      const swing = (homeScore - awayScore) * 8;
      const tick: LiveTickPayload = {
        matchNumber,
        minute,
        homeScore,
        awayScore,
        event: eventsNow[0],
        possessionHome: result.stats.home.possession,
        momentum: Math.max(10, Math.min(90, 50 + swing + Math.sin(minute / 7) * 10)),
      };
      socket.emit(WS_EVENTS.LIVE_TICK, tick);
      for (const ev of eventsNow.slice(1)) {
        socket.emit(WS_EVENTS.LIVE_TICK, { ...tick, event: ev });
      }

      if (minute >= totalMinutes) {
        clearInterval(interval);
        this.liveLoops.delete(socket.id);
        socket.emit(WS_EVENTS.LIVE_FINISHED, { matchNumber, result });
      }
    }, 1000 / speed);

    this.liveLoops.set(socket.id, interval);
    socket.emit('live:started', { matchNumber, home: homeCode, away: awayCode, speed, totalMinutes });
  }

  // --- server-side broadcast helpers (used by admin pipeline) -----------------

  broadcastResult(matchNumber: number, payload: unknown): void {
    this.server.to(`match:${matchNumber}`).emit(WS_EVENTS.MATCH_LIVE_UPDATE, payload);
    this.server.emit(WS_EVENTS.SIMULATION_COMPLETE, { matchNumber });
  }

  /** Real live feed: state change for one match (subscribed match pages). */
  broadcastLiveState(matchNumber: number, payload: unknown): void {
    this.server.to(`match:${matchNumber}`).emit(WS_EVENTS.MATCH_LIVE_UPDATE, payload);
  }

  /** Real live feed: coalesced "something changed" signal for boards. */
  broadcastLiveScores(): void {
    this.server.emit(WS_EVENTS.LIVE_SCORES_UPDATED, { at: Date.now() });
  }

  /** Autonomous lifecycle: phase transitions reach every connected client. */
  broadcastPhase(matchNumber: number, payload: unknown): void {
    this.server.emit(WS_EVENTS.MATCH_PHASE, payload);
    this.server.to(`match:${matchNumber}`).emit(WS_EVENTS.MATCH_PHASE, payload);
  }

  broadcastPredictionsUpdated(payload: unknown): void {
    this.server.emit(WS_EVENTS.PREDICTIONS_UPDATED, payload);
  }

  broadcastStandings(): void {
    this.server.emit(WS_EVENTS.STANDINGS_UPDATED, { at: Date.now() });
  }

  broadcastLineupOfficial(matchNumber: number, payload: unknown): void {
    this.server.to(`match:${matchNumber}`).emit(WS_EVENTS.LINEUP_OFFICIAL, payload);
  }

  broadcastLeaderboard(): void {
    this.server.to('leaderboard').emit(WS_EVENTS.RANKING_CHANGE, { at: Date.now() });
  }

  notifyUser(userId: string, payload: unknown): void {
    this.server.to(`user:${userId}`).emit(WS_EVENTS.NOTIFICATION, payload);
  }

  @SubscribeMessage('auth:identify')
  onIdentify(@ConnectedSocket() socket: Socket, @MessageBody() body: { userId: string }): void {
    if (body?.userId) socket.join(`user:${body.userId}`);
  }
}
