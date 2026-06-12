/**
 * Shared domain types for the FIFA 2026 platform.
 * Used by the simulation engine, API, web and mobile clients.
 */

// ---------------------------------------------------------------------------
// Core enums (string unions — serializable, DB-enum compatible)
// ---------------------------------------------------------------------------

export type UserRole = 'guest' | 'registered' | 'premium' | 'admin';

export type MatchStage =
  | 'group'
  | 'round32'
  | 'round16'
  | 'quarterfinal'
  | 'semifinal'
  | 'third_place'
  | 'final';

export type MatchStatus = 'scheduled' | 'live' | 'completed' | 'postponed';

/**
 * Autonomous match lifecycle phases. Clock-derived phases advance on their
 * own from the official schedule; terminal phases are only ever set by the
 * result-ingestion pipeline (verified data), never by a manual toggle.
 */
export type MatchPhase =
  | 'scheduled'
  | 'pre_match'
  | 'live'
  | 'half_time'
  | 'extra_time'
  | 'penalties'
  | 'awaiting_result'
  | 'completed'
  | 'postponed'
  | 'cancelled';

export const MATCH_PHASES: readonly MatchPhase[] = [
  'scheduled', 'pre_match', 'live', 'half_time', 'extra_time', 'penalties',
  'awaiting_result', 'completed', 'postponed', 'cancelled',
];

/** Phases that end a match's lifecycle — only ingestion/operations set these. */
export const TERMINAL_PHASES: readonly MatchPhase[] = ['completed', 'cancelled'];
/** Phases during which a match is in play. */
export const IN_PLAY_PHASES: readonly MatchPhase[] = ['live', 'half_time', 'extra_time', 'penalties'];

export const MATCH_PHASE_LABELS: Record<MatchPhase, string> = {
  scheduled: 'Scheduled',
  pre_match: 'Pre-Match',
  live: 'Live',
  half_time: 'Half Time',
  extra_time: 'Extra Time',
  penalties: 'Penalties',
  awaiting_result: 'Awaiting Result',
  completed: 'Full Time',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
};

export type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC';

/** Official FIFA squad-list position groups. */
export type SquadPosition = 'GK' | 'DF' | 'MF' | 'FW';

/** Detailed on-pitch roles used by the lineup builder. */
export type PitchRole =
  | 'GK'
  | 'LB' | 'CB' | 'RB' | 'LWB' | 'RWB'
  | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM'
  | 'LW' | 'RW' | 'ST' | 'CF';

export type FormationId = '4-3-3' | '4-2-3-1' | '3-5-2' | '4-4-2' | '5-3-2';

export type TacticalStyle =
  | 'possession'
  | 'high_press'
  | 'counter_attack'
  | 'direct'
  | 'defensive_block';

export type SimulationType = 'single_match' | 'group_stage' | 'tournament' | 'monte_carlo';

export type GroupLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';

// ---------------------------------------------------------------------------
// Tournament data
// ---------------------------------------------------------------------------

export interface CountryInfo {
  code: string;
  name: string;
  flagUrl: string;
  confederation: Confederation;
  group: GroupLetter;
  pot: number;
  fifaRanking: number;
  fifaPoints: number;
  eloRating: number;
  worldCupAppearances: number | null;
  coach: string;
  coachNationality: string;
}

export interface VenueInfo {
  id: string;
  name: string;
  city: string;
  country: string;
  capacity: number;
  tz: string;
}

/** A slot in the knockout bracket before teams are known. */
export type MatchSlot =
  | { type: 'team'; code: string }
  | { type: 'groupWinner'; group: GroupLetter }
  | { type: 'groupRunnerUp'; group: GroupLetter }
  | { type: 'thirdPlace'; allowedGroups: GroupLetter[] }
  | { type: 'matchWinner'; match: number }
  | { type: 'matchLoser'; match: number };

export interface ScheduledMatch {
  matchNumber: number; // 1..104
  stage: MatchStage;
  group: GroupLetter | null;
  matchday?: number;
  kickoffUtc: string;
  localDate: string;
  localTime: string;
  utcOffset: number;
  venueId: string;
  home: MatchSlot;
  away: MatchSlot;
}

export interface SquadPlayer {
  number: number;
  position: SquadPosition;
  name: string;
  dateOfBirth: string;
  caps: number;
  goals: number;
  club: string;
  clubCountry: string | null;
  captain: boolean;
}

// ---------------------------------------------------------------------------
// Simulation results
// ---------------------------------------------------------------------------

export type MatchEventType =
  | 'goal'
  | 'penalty_goal'
  | 'own_goal'
  | 'yellow_card'
  | 'second_yellow'
  | 'red_card'
  | 'substitution'
  | 'injury'
  | 'penalty_missed'
  | 'tactical_change';

export interface SimMatchEvent {
  minute: number;
  type: MatchEventType;
  team: string; // country code
  playerId?: number;
  playerName?: string;
  assistPlayerId?: number;
  assistPlayerName?: string;
  detail?: string;
}

export interface SimTeamStats {
  goals: number;
  possession: number; // 0..100
  shots: number;
  shotsOnTarget: number;
  xG: number;
  corners: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  passAccuracy: number;
  saves: number;
}

export interface SimMatchResult {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  /** Score after 90' when extra time was played. */
  ftScore?: { home: number; away: number };
  wentToExtraTime: boolean;
  wentToPenalties: boolean;
  penalties?: { home: number; away: number; sequence: Array<{ team: string; scored: boolean; taker: string }> };
  winner: string | null; // null = draw (group stage)
  events: SimMatchEvent[];
  stats: { home: SimTeamStats; away: SimTeamStats };
  manOfTheMatch: { playerId: number; name: string; team: string } | null;
}

export interface MatchProbabilities {
  homeWin: number;
  draw: number;
  awayWin: number;
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  mostLikelyScore: { home: number; away: number; probability: number };
  scoreMatrix: number[][]; // [homeGoals][awayGoals] probabilities, 0..6+
  bttsProbability: number;
  over25Probability: number;
  confidence: number; // 0..100
}

export interface AiPrediction extends MatchProbabilities {
  predictedScore: { home: number; away: number };
  likelyScorers: Array<{ playerId: number; name: string; team: string; probability: number }>;
  insights: string[];
  modelBreakdown: { elo: number; dixonColes: number; form: number };
}

// ---------------------------------------------------------------------------
// Match intelligence (prediction engine v2)
// ---------------------------------------------------------------------------

/** Venue & environmental conditions for a fixture (reference data + climatology). */
export interface MatchConditionsInfo {
  venueId: string;
  venueName: string;
  city: string;
  altitudeM: number;
  /** climatological June/July average daily high — labelled, not a live forecast */
  avgHighC: number;
  avgHumidityPct: number;
  capacity: number;
  timezoneOffsetHours: number;
  notes: string[];
}

export interface TeamFatigueInfo {
  team: string;
  restDays: number | null; // null = first match of tournament
  matches7d: number;
  matches14d: number;
  travelKm: number;
  tzShift: number;
  /** 0..100 — 100 is a fully fresh squad */
  freshness: number;
  label: 'fresh' | 'normal' | 'tired' | 'exhausted';
  notes: string[];
}

/** Style-derived tactical trait axes, 0..100. */
export interface TacticalAxes {
  pressing: number;
  possession: number;
  directness: number;
  counterAttack: number;
  setPieces: number;
  defensiveBlock: number;
}

export interface TacticalComparison {
  home: { style: TacticalStyle; formation: FormationId; axes: TacticalAxes };
  away: { style: TacticalStyle; formation: FormationId; axes: TacticalAxes };
  /** which side the style matchup favours, if either */
  styleEdge: 'home' | 'away' | null;
  edges: string[];
}

export interface KeyBattle {
  zone: string;
  home: { playerId: number; name: string; rating: number; position: SquadPosition };
  away: { playerId: number; name: string; rating: number; position: SquadPosition };
  edge: 'home' | 'away' | 'even';
  note: string;
}

export type UpsetTier = 'low' | 'medium' | 'high' | 'extreme';

export interface UpsetAssessment {
  /** 0..100 — probability-weighted upset risk */
  score: number;
  tier: UpsetTier;
  favorite: string;
  underdog: string;
  underdogWinProbability: number;
  drivers: string[];
}

export type ConfidenceLevel = 'very_low' | 'low' | 'moderate' | 'high' | 'very_high';

export interface FactorContribution {
  factor: string;
  /** which side this factor leans toward */
  leans: 'home' | 'away' | 'neutral';
  /** signed impact on the home:away expected-goal ratio, in percent */
  impactPct: number;
  note: string;
}

export type FactorCoverageStatus = 'measured' | 'proxy' | 'unavailable';

export interface PredictionExplanation {
  whyFavored: string[];
  whyUnderdogCanWin: string[];
  biggestRisks: string[];
  keyVariables: FactorContribution[];
  confidenceLevel: ConfidenceLevel;
  /** honest provenance: which factors run on measured data vs proxies */
  dataCoverage: Array<{ factor: string; status: FactorCoverageStatus; source: string }>;
}

export interface OutcomeUncertainty {
  /** 95% interval for each outcome probability (Monte Carlo bootstrap) */
  homeWin: [number, number];
  draw: [number, number];
  awayWin: [number, number];
  method: string;
  samples: number;
}

export interface PsychologyAssessment {
  team: string;
  factorsApplied: string[];
  notes: string[];
}

/** Full v2 prediction — superset of AiPrediction, backward compatible. */
export interface AiPredictionV2 extends AiPrediction {
  modelVersion: number;
  conditions: MatchConditionsInfo | null;
  fatigue: { home: TeamFatigueInfo; away: TeamFatigueInfo } | null;
  tactics: TacticalComparison;
  keyBattles: KeyBattle[];
  psychology: { home: PsychologyAssessment; away: PsychologyAssessment } | null;
  upset: UpsetAssessment;
  explanation: PredictionExplanation;
  uncertainty: OutcomeUncertainty;
}

export interface GroupStandingRow {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayPoints: number;
  position: number;
}

export interface StageProbabilities {
  team: string;
  reachR32: number;
  reachR16: number;
  reachQF: number;
  reachSF: number;
  reachFinal: number;
  champion: number;
  winGroup: number;
  exitGroupStage: number;
}

export interface TournamentSimResult {
  runs: number;
  durationMs: number;
  champion: Record<string, number>; // code -> probability
  stageProbabilities: StageProbabilities[];
  mostLikelyFinal: { teams: [string, string]; probability: number };
  goldenBoot: Array<{ playerId: number; name: string; team: string; avgGoals: number; topScorerShare: number }>;
  surpriseTeam: { team: string; expectedRoundIndex: number; seedRank: number } | null;
  upsetProbability: number;
  /** A single representative full-tournament run (bracket replay). */
  sampleRun: SingleTournamentRun;
}

export interface SingleTournamentRun {
  groupStandings: Record<GroupLetter, GroupStandingRow[]>;
  thirdPlaceRanking: GroupStandingRow[];
  qualifiedThirds: string[];
  knockoutResults: Array<{
    matchNumber: number;
    stage: MatchStage;
    home: string;
    away: string;
    homeScore: number;
    awayScore: number;
    wentToExtraTime: boolean;
    wentToPenalties: boolean;
    penalties?: { home: number; away: number };
    winner: string;
  }>;
  champion: string;
  runnerUp: string;
  thirdPlace: string;
  goldenBoot: { name: string; team: string; goals: number } | null;
}

// ---------------------------------------------------------------------------
// Fantasy
// ---------------------------------------------------------------------------

export interface LineupSlotAssignment {
  slotId: string; // e.g. "LW", "CB1"
  role: PitchRole;
  playerId: number;
}

export interface LineupPayload {
  formation: FormationId;
  startingXi: LineupSlotAssignment[];
  substitutes: number[]; // player ids, ordered bench
  captainId: number;
  viceCaptainId: number;
}

export interface ChemistryBreakdown {
  total: number; // 0..100
  clubLinks: number;
  leagueLinks: number;
  experienceBalance: number;
  ageBalance: number;
  captainBonus: number;
}

export interface TacticalFitBreakdown {
  total: number; // 0..100
  positionFit: number;
  styleFit: number;
  formationFamiliarity: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Predictions & community
// ---------------------------------------------------------------------------

export interface PredictionPayload {
  matchNumber: number;
  homeScore: number;
  awayScore: number;
  firstGoalscorerId?: number | null;
  cleanSheetTeam?: string | null;
}

export interface CommunityIntelligence {
  matchNumber: number;
  totalPredictions: number;
  mostPredictedWinner: string | null;
  mostPredictedScoreline: string | null;
  outcomeSplit: { homeWin: number; draw: number; awayWin: number };
  crowdConfidenceIndex: number; // 0..100
  popularScorers: Array<{ playerId: number; name: string; count: number }>;
  totalSimulations: number;
}

// ---------------------------------------------------------------------------
// Realtime (socket.io) protocol
// ---------------------------------------------------------------------------

export const WS_EVENTS = {
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
  /** autonomous lifecycle: a match moved to a new phase */
  MATCH_PHASE: 'MATCH_PHASE',
  /** model recalibrated / snapshots regenerated — clients should refetch */
  PREDICTIONS_UPDATED: 'PREDICTIONS_UPDATED',
  STANDINGS_UPDATED: 'STANDINGS_UPDATED',
  /** real live-score feed: any in-play match state changed — refetch boards */
  LIVE_SCORES_UPDATED: 'LIVE_SCORES_UPDATED',
} as const;

export interface LiveTickPayload {
  matchNumber: number;
  minute: number;
  homeScore: number;
  awayScore: number;
  event?: SimMatchEvent;
  possessionHome: number;
  momentum: number; // 0..100, 50 = balanced, >50 home dominating
}

// ---------------------------------------------------------------------------
// Real live-score feed (FIFA sync) — verified in-play state, not simulation
// ---------------------------------------------------------------------------

/** A goal event observed on the real live feed. */
export interface LiveMatchEventDto {
  minute: number;
  minuteLabel: string; // e.g. "45'+2'"
  type: 'goal' | 'own_goal' | 'penalty_goal';
  team: 'home' | 'away';
  teamCode: string;
  player: string | null;
  /** the feed's own player id (FIFA), for canonical-name disambiguation */
  feedPlayerId?: string | null;
}

/**
 * Current real state of an in-play (or just-finished, pre-verification) match
 * as reported by the configured live feed. The verified final result still
 * only lands through the result-ingestion consensus pipeline; this state is
 * the live ticker between kickoff and verification.
 */
export interface LiveMatchStateDto {
  matchNumber: number;
  source: string; // 'fifa' | 'official_admin' | ...
  phase: MatchPhase; // feed-derived in-play phase
  minute: number | null;
  minuteLabel: string | null;
  period: number | null; // raw feed period code
  homeCode: string;
  awayCode: string;
  homeScore: number;
  awayScore: number;
  homePenalties: number | null;
  awayPenalties: number | null;
  attendance: number | null;
  events: LiveMatchEventDto[];
  /** feed says the match is over; result claim submitted, awaiting consensus */
  finished: boolean;
  fetchedAt: string;
  ageMs: number;
}

/** Room broadcast payload for WS_EVENTS.MATCH_LIVE_UPDATE (live feed kind). */
export interface LiveStateBroadcast {
  kind: 'live_state';
  state: LiveMatchStateDto;
  lastEvent: LiveMatchEventDto | null;
}

// ---------------------------------------------------------------------------
// Auth / API DTO shells shared by clients
// ---------------------------------------------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  countryCode: string | null;
  favoriteTeam: string | null;
  mfaEnabled: boolean;
  createdAt: string;
}

export interface LeaderboardEntryDto {
  rank: number;
  userId: string;
  username: string;
  countryCode: string | null;
  totalPoints: number;
  predictionAccuracy: number;
  exactScoreAccuracy: number;
  simulationsRun: number;
  reputationScore: number;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}
