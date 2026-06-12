"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEAGUE_STRENGTH_DEFAULT = exports.LEAGUE_STRENGTH = exports.LINEUP_LOCK_MINUTES_BEFORE_KICKOFF = exports.BCRYPT_COST = exports.REFRESH_TOKEN_TTL_SECONDS = exports.ACCESS_TOKEN_TTL_SECONDS = exports.DEFAULT_TOURNAMENT_RUNS = exports.DEFAULT_MATCH_SIMS = exports.SIM_LIMITS = exports.HOST_COUNTRIES = exports.YELLOW_WIPE_AFTER_STAGE = exports.YELLOW_ACCUMULATION_LIMIT = exports.FAIR_PLAY_DEDUCTIONS = exports.stageForMatchNumber = exports.MATCH_NUMBER_RANGES = exports.STAGE_LABELS = exports.STAGE_ORDER = exports.GROUPS = exports.TOURNAMENT_END = exports.TOURNAMENT_START = exports.TOURNAMENT_NAME = exports.TOURNAMENT_YEAR = void 0;
/** Tournament identity */
exports.TOURNAMENT_YEAR = 2026;
exports.TOURNAMENT_NAME = 'FIFA World Cup 2026';
exports.TOURNAMENT_START = '2026-06-11';
exports.TOURNAMENT_END = '2026-07-19';
exports.GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
exports.STAGE_ORDER = [
    'group',
    'round32',
    'round16',
    'quarterfinal',
    'semifinal',
    'third_place',
    'final',
];
exports.STAGE_LABELS = {
    group: 'Group Stage',
    round32: 'Round of 32',
    round16: 'Round of 16',
    quarterfinal: 'Quarter-finals',
    semifinal: 'Semi-finals',
    third_place: 'Third-place match',
    final: 'Final',
};
/** Knockout match-number ranges (official FIFA numbering). */
exports.MATCH_NUMBER_RANGES = {
    group: [1, 72],
    round32: [73, 88],
    round16: [89, 96],
    quarterfinal: [97, 100],
    semifinal: [101, 102],
    third_place: [103, 103],
    final: [104, 104],
};
const stageForMatchNumber = (n) => {
    for (const [stage, [lo, hi]] of Object.entries(exports.MATCH_NUMBER_RANGES)) {
        if (n >= lo && n <= hi)
            return stage;
    }
    throw new Error(`invalid match number ${n}`);
};
exports.stageForMatchNumber = stageForMatchNumber;
/**
 * FIFA group-stage tiebreakers (2026 regulations, art. 13):
 * points → GD → GF → head-to-head points → h2h GD → h2h GF → fair play → drawing of lots.
 * Fair-play deductions per regulations:
 */
exports.FAIR_PLAY_DEDUCTIONS = {
    yellow: -1,
    secondYellow: -3, // indirect red
    directRed: -4,
    yellowAndDirectRed: -5,
};
/** Yellow-card suspension rule: 2 yellows in separate matches => 1-match ban; slate wiped after quarterfinals. */
exports.YELLOW_ACCUMULATION_LIMIT = 2;
exports.YELLOW_WIPE_AFTER_STAGE = 'quarterfinal';
/** Hosts get home advantage in the sim when playing in their own country. */
exports.HOST_COUNTRIES = ['USA', 'MEX', 'CAN'];
// ---------------------------------------------------------------------------
// Simulation limits / product gating
// ---------------------------------------------------------------------------
const UNLIMITED = Number.MAX_SAFE_INTEGER;
exports.SIM_LIMITS = {
    guest: { maxRunsPerCall: UNLIMITED, dailyCalls: UNLIMITED, monteCarloMax: UNLIMITED },
    registered: { maxRunsPerCall: UNLIMITED, dailyCalls: UNLIMITED, monteCarloMax: UNLIMITED },
    premium: { maxRunsPerCall: UNLIMITED, dailyCalls: UNLIMITED, monteCarloMax: UNLIMITED },
    admin: { maxRunsPerCall: UNLIMITED, dailyCalls: UNLIMITED, monteCarloMax: UNLIMITED },
};
exports.DEFAULT_MATCH_SIMS = 10_000;
exports.DEFAULT_TOURNAMENT_RUNS = 1_000;
// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
exports.ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // PRD: 15 minutes
exports.REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600; // PRD: 7 days
exports.BCRYPT_COST = 12;
// ---------------------------------------------------------------------------
// Lineup locking — lineups lock 75 minutes before kickoff (official release time)
// ---------------------------------------------------------------------------
exports.LINEUP_LOCK_MINUTES_BEFORE_KICKOFF = 75;
// ---------------------------------------------------------------------------
// League-strength tiers used by the player-rating model. Values are relative
// multipliers for the league a player's club plays in (by club country code).
// Documented modeling input, not a data source.
// ---------------------------------------------------------------------------
exports.LEAGUE_STRENGTH = {
    ENG: 1.0,
    ESP: 0.97,
    ITA: 0.94,
    GER: 0.94,
    FRA: 0.91,
    NED: 0.85,
    POR: 0.85,
    TUR: 0.8,
    BEL: 0.79,
    BRA: 0.8,
    ARG: 0.78,
    KSA: 0.78,
    MEX: 0.76,
    USA: 0.75,
    SCO: 0.74,
    GRE: 0.73,
    RUS: 0.73,
    AUT: 0.73,
    SUI: 0.73,
    CRO: 0.72,
    DEN: 0.72,
    CZE: 0.71,
    NOR: 0.7,
    SWE: 0.7,
    POL: 0.7,
    JPN: 0.72,
    KOR: 0.7,
    QAT: 0.7,
    UAE: 0.69,
    EGY: 0.68,
    COL: 0.68,
    URU: 0.68,
    ECU: 0.66,
    PAR: 0.65,
    CHI: 0.65,
    PER: 0.64,
    CHN: 0.64,
    AUS: 0.66,
    RSA: 0.63,
    TUN: 0.63,
    MAR: 0.65,
    ALG: 0.63,
    CRC: 0.6,
    IRN: 0.65,
    IRQ: 0.6,
    UZB: 0.62,
    JOR: 0.58,
    CYP: 0.65,
    ISR: 0.68,
    UKR: 0.72,
    SRB: 0.7,
    ROU: 0.68,
    HUN: 0.67,
    BUL: 0.63,
    SVK: 0.64,
    SVN: 0.64,
    BIH: 0.6,
    ALB: 0.58,
    MKD: 0.56,
    IND: 0.55,
    THA: 0.56,
    VIE: 0.54,
    IDN: 0.54,
    MYS: 0.54,
    KUW: 0.58,
    BHR: 0.56,
    OMA: 0.56,
    CAN: 0.7,
    PAN: 0.55,
    HON: 0.55,
    GUA: 0.54,
    SLV: 0.53,
    HAI: 0.5,
    JAM: 0.55,
    TRI: 0.52,
    BOL: 0.58,
    VEN: 0.6,
    NZL: 0.58,
    SEN: 0.55,
    CIV: 0.55,
    GHA: 0.54,
    NGA: 0.56,
    CMR: 0.55,
    COD: 0.53,
    ANG: 0.55,
    ZAM: 0.52,
    KEN: 0.5,
    ETH: 0.48,
    LBY: 0.52,
    SDN: 0.5,
    AZE: 0.6,
    KAZ: 0.6,
    GEO: 0.6,
    ARM: 0.58,
    MDA: 0.55,
    BLR: 0.58,
    FIN: 0.64,
    IRL: 0.6,
    ISL: 0.6,
    WAL: 0.62,
    NIR: 0.55,
    LUX: 0.52,
    MLT: 0.5,
    CUW: 0.5,
};
exports.LEAGUE_STRENGTH_DEFAULT = 0.55;
//# sourceMappingURL=constants.js.map