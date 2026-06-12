import type { MatchStage, UserRole } from './types';
/** Tournament identity */
export declare const TOURNAMENT_YEAR = 2026;
export declare const TOURNAMENT_NAME = "FIFA World Cup 2026";
export declare const TOURNAMENT_START = "2026-06-11";
export declare const TOURNAMENT_END = "2026-07-19";
export declare const GROUPS: readonly string[];
export declare const STAGE_ORDER: readonly MatchStage[];
export declare const STAGE_LABELS: Record<MatchStage, string>;
/** Knockout match-number ranges (official FIFA numbering). */
export declare const MATCH_NUMBER_RANGES: Record<MatchStage, [number, number]>;
export declare const stageForMatchNumber: (n: number) => MatchStage;
/**
 * FIFA group-stage tiebreakers (2026 regulations, art. 13):
 * points → GD → GF → head-to-head points → h2h GD → h2h GF → fair play → drawing of lots.
 * Fair-play deductions per regulations:
 */
export declare const FAIR_PLAY_DEDUCTIONS: {
    readonly yellow: -1;
    readonly secondYellow: -3;
    readonly directRed: -4;
    readonly yellowAndDirectRed: -5;
};
/** Yellow-card suspension rule: 2 yellows in separate matches => 1-match ban; slate wiped after quarterfinals. */
export declare const YELLOW_ACCUMULATION_LIMIT = 2;
export declare const YELLOW_WIPE_AFTER_STAGE: MatchStage;
/** Hosts get home advantage in the sim when playing in their own country. */
export declare const HOST_COUNTRIES: readonly ["USA", "MEX", "CAN"];
export declare const SIM_LIMITS: Record<UserRole, {
    maxRunsPerCall: number;
    dailyCalls: number;
    monteCarloMax: number;
}>;
export declare const DEFAULT_MATCH_SIMS = 10000;
export declare const DEFAULT_TOURNAMENT_RUNS = 1000;
export declare const ACCESS_TOKEN_TTL_SECONDS: number;
export declare const REFRESH_TOKEN_TTL_SECONDS: number;
export declare const BCRYPT_COST = 12;
export declare const LINEUP_LOCK_MINUTES_BEFORE_KICKOFF = 75;
export declare const LEAGUE_STRENGTH: Record<string, number>;
export declare const LEAGUE_STRENGTH_DEFAULT = 0.55;
//# sourceMappingURL=constants.d.ts.map