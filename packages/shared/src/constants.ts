import type { MatchStage, UserRole } from './types';

/** Tournament identity */
export const TOURNAMENT_YEAR = 2026;
export const TOURNAMENT_NAME = 'FIFA World Cup 2026';
export const TOURNAMENT_START = '2026-06-11';
export const TOURNAMENT_END = '2026-07-19';
export const GROUPS: readonly string[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

export const STAGE_ORDER: readonly MatchStage[] = [
  'group',
  'round32',
  'round16',
  'quarterfinal',
  'semifinal',
  'third_place',
  'final',
];

export const STAGE_LABELS: Record<MatchStage, string> = {
  group: 'Group Stage',
  round32: 'Round of 32',
  round16: 'Round of 16',
  quarterfinal: 'Quarter-finals',
  semifinal: 'Semi-finals',
  third_place: 'Third-place match',
  final: 'Final',
};

/** Knockout match-number ranges (official FIFA numbering). */
export const MATCH_NUMBER_RANGES: Record<MatchStage, [number, number]> = {
  group: [1, 72],
  round32: [73, 88],
  round16: [89, 96],
  quarterfinal: [97, 100],
  semifinal: [101, 102],
  third_place: [103, 103],
  final: [104, 104],
};

export const stageForMatchNumber = (n: number): MatchStage => {
  for (const [stage, [lo, hi]] of Object.entries(MATCH_NUMBER_RANGES) as Array<[MatchStage, [number, number]]>) {
    if (n >= lo && n <= hi) return stage;
  }
  throw new Error(`invalid match number ${n}`);
};

/**
 * FIFA group-stage tiebreakers (2026 regulations, art. 13):
 * points → GD → GF → head-to-head points → h2h GD → h2h GF → fair play → drawing of lots.
 * Fair-play deductions per regulations:
 */
export const FAIR_PLAY_DEDUCTIONS = {
  yellow: -1,
  secondYellow: -3, // indirect red
  directRed: -4,
  yellowAndDirectRed: -5,
} as const;

/** Yellow-card suspension rule: 2 yellows in separate matches => 1-match ban; slate wiped after quarterfinals. */
export const YELLOW_ACCUMULATION_LIMIT = 2;
export const YELLOW_WIPE_AFTER_STAGE: MatchStage = 'quarterfinal';

/** Hosts get home advantage in the sim when playing in their own country. */
export const HOST_COUNTRIES = ['USA', 'MEX', 'CAN'] as const;

// ---------------------------------------------------------------------------
// Simulation limits / product gating
// ---------------------------------------------------------------------------

export const SIM_LIMITS: Record<UserRole, { maxRunsPerCall: number; dailyCalls: number; monteCarloMax: number }> = {
  guest: { maxRunsPerCall: 1_000, dailyCalls: 20, monteCarloMax: 1_000 },
  registered: { maxRunsPerCall: 10_000, dailyCalls: 200, monteCarloMax: 10_000 },
  premium: { maxRunsPerCall: 100_000, dailyCalls: 2_000, monteCarloMax: 100_000 },
  admin: { maxRunsPerCall: 1_000_000, dailyCalls: 100_000, monteCarloMax: 1_000_000 },
};

export const DEFAULT_MATCH_SIMS = 10_000;
export const DEFAULT_TOURNAMENT_RUNS = 1_000;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // PRD: 15 minutes
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600; // PRD: 7 days
export const BCRYPT_COST = 12;

// ---------------------------------------------------------------------------
// Lineup locking — lineups lock 75 minutes before kickoff (official release time)
// ---------------------------------------------------------------------------

export const LINEUP_LOCK_MINUTES_BEFORE_KICKOFF = 75;

// ---------------------------------------------------------------------------
// League-strength tiers used by the player-rating model. Values are relative
// multipliers for the league a player's club plays in (by club country code).
// Documented modeling input, not a data source.
// ---------------------------------------------------------------------------

export const LEAGUE_STRENGTH: Record<string, number> = {
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
export const LEAGUE_STRENGTH_DEFAULT = 0.55;
