"use strict";
/**
 * Shared domain types for the FIFA 2026 platform.
 * Used by the simulation engine, API, web and mobile clients.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.WS_EVENTS = void 0;
// ---------------------------------------------------------------------------
// Realtime (socket.io) protocol
// ---------------------------------------------------------------------------
exports.WS_EVENTS = {
    // client -> server
    SUBSCRIBE_MATCH: 'match:subscribe',
    UNSUBSCRIBE_MATCH: 'match:unsubscribe',
    SUBSCRIBE_LEADERBOARD: 'leaderboard:subscribe',
    START_LIVE_SIM: 'live:start',
    // server -> client
    MATCH_LIVE_UPDATE: 'MATCH_LIVE_UPDATE',
    LINEUP_OFFICIAL: 'LINEUP_OFFICIAL',
    SIMULATION_COMPLETE: 'SIMULATION_COMPLETE',
    RANKING_CHANGE: 'RANKING_CHANGE',
    PREDICTION_RESULT: 'PREDICTION_RESULT',
    NOTIFICATION: 'NOTIFICATION',
    LIVE_TICK: 'LIVE_TICK',
    LIVE_FINISHED: 'LIVE_FINISHED',
};
//# sourceMappingURL=types.js.map