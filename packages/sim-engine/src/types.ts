import type {
  FormationId,
  GroupLetter,
  MatchStage,
  SquadPosition,
  TacticalStyle,
  LineupSlotAssignment,
} from '@fifa/shared';

/** Player as the engine sees it (assembled from DB by the API layer). */
export interface SimPlayer {
  id: number;
  name: string;
  position: SquadPosition;
  rating: number; // 0..100 modeled base rating
  caps: number;
  internationalGoals: number;
  age: number;
  club: string | null;
  clubCountry: string | null;
  captain: boolean;
  jerseyNumber: number;
  fitness: number; // 0..100
  injured?: boolean;
}

export interface ManagerProfile {
  name: string;
  tacticalRating: number; // 0..100
  adaptabilityRating: number;
  substitutionRating: number;
  pressureHandling: number;
  knockoutRating: number;
  preferredStyle: TacticalStyle;
}

export interface TeamForm {
  /** last-10 result string, newest first, e.g. "WWDLW..." */
  results: string;
  /** weighted form score -1..+1 */
  score: number;
}

export interface SimTeam {
  code: string;
  name: string;
  elo: number;
  fifaRanking: number;
  confederation: string;
  group: GroupLetter;
  isHostNation: boolean;
  manager: ManagerProfile;
  squad: SimPlayer[];
  form: TeamForm;
  /** historical penalty shootout record */
  shootouts: { taken: number; won: number };
  /** optional user-pinned lineup (their fantasy XI drives their nation) */
  pinnedLineup?: {
    formation: FormationId;
    startingXi: LineupSlotAssignment[];
  } | null;
}

export interface H2HRecord {
  played: number;
  wins1: number;
  wins2: number;
  draws: number;
  goals1: number;
  goals2: number;
  wcMeetings: number;
  lastMeeting?: { date: string; score: string; tournament: string } | null;
}

/** Per-tournament mutable player state (suspensions, fatigue, goals). */
export interface PlayerTournamentState {
  yellows: number;
  suspendedForNext: boolean;
  goals: number;
  assists: number;
  started: number;
  fatigue: number; // 0..1 accumulated
}

export interface MatchContext {
  stage: MatchStage;
  matchNumber: number;
  /** venue country code (USA/MEX/CAN) for host advantage */
  venueCountry: 'USA' | 'MEX' | 'CAN';
  knockout: boolean;
}

export interface EngineConfig {
  /** league-average goals per team per match (intl. baseline) */
  baseGoals: number;
  /** Elo points granted to a host nation playing in its own country */
  hostEloBonus: number;
  /** Elo scale for converting rating difference into goal ratio */
  eloGoalScale: number;
  /** shared bivariate component factor */
  goalCorrelation: number;
  /** Dixon-Coles low-score correction */
  dixonColesRho: number;
  maxLambda: number;
  minLambda: number;
  extraTimeFactor: number; // per-30min scoring vs per-90
  penaltyBaseConversion: number;
}

export const DEFAULT_CONFIG: EngineConfig = {
  baseGoals: 1.32,
  hostEloBonus: 62,
  // calibrated so ΔElo=100 ⇒ ~0.3 expected-goal difference (eloratings.net heuristic)
  eloGoalScale: 2000,
  goalCorrelation: 0.12,
  dixonColesRho: -0.11,
  maxLambda: 4.4,
  minLambda: 0.18,
  extraTimeFactor: 0.3,
  penaltyBaseConversion: 0.76,
};
