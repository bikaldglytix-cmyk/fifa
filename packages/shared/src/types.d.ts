/**
 * Shared domain types for the FIFA 2026 platform.
 * Used by the simulation engine, API, web and mobile clients.
 */
export type UserRole = 'guest' | 'registered' | 'premium' | 'admin';
export type MatchStage = 'group' | 'round32' | 'round16' | 'quarterfinal' | 'semifinal' | 'third_place' | 'final';
export type MatchStatus = 'scheduled' | 'live' | 'completed' | 'postponed';
export type Confederation = 'UEFA' | 'CONMEBOL' | 'CONCACAF' | 'CAF' | 'AFC' | 'OFC';
/** Official FIFA squad-list position groups. */
export type SquadPosition = 'GK' | 'DF' | 'MF' | 'FW';
/** Detailed on-pitch roles used by the lineup builder. */
export type PitchRole = 'GK' | 'LB' | 'CB' | 'RB' | 'LWB' | 'RWB' | 'CDM' | 'CM' | 'CAM' | 'LM' | 'RM' | 'LW' | 'RW' | 'ST' | 'CF';
export type FormationId = '4-3-3' | '4-2-3-1' | '3-5-2' | '4-4-2' | '5-3-2';
export type TacticalStyle = 'possession' | 'high_press' | 'counter_attack' | 'direct' | 'defensive_block';
export type SimulationType = 'single_match' | 'group_stage' | 'tournament' | 'monte_carlo';
export type GroupLetter = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';
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
export type MatchSlot = {
    type: 'team';
    code: string;
} | {
    type: 'groupWinner';
    group: GroupLetter;
} | {
    type: 'groupRunnerUp';
    group: GroupLetter;
} | {
    type: 'thirdPlace';
    allowedGroups: GroupLetter[];
} | {
    type: 'matchWinner';
    match: number;
} | {
    type: 'matchLoser';
    match: number;
};
export interface ScheduledMatch {
    matchNumber: number;
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
export type MatchEventType = 'goal' | 'penalty_goal' | 'own_goal' | 'yellow_card' | 'second_yellow' | 'red_card' | 'substitution' | 'injury' | 'penalty_missed' | 'tactical_change';
export interface SimMatchEvent {
    minute: number;
    type: MatchEventType;
    team: string;
    playerId?: number;
    playerName?: string;
    assistPlayerId?: number;
    assistPlayerName?: string;
    detail?: string;
}
export interface SimTeamStats {
    goals: number;
    possession: number;
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
    ftScore?: {
        home: number;
        away: number;
    };
    wentToExtraTime: boolean;
    wentToPenalties: boolean;
    penalties?: {
        home: number;
        away: number;
        sequence: Array<{
            team: string;
            scored: boolean;
            taker: string;
        }>;
    };
    winner: string | null;
    events: SimMatchEvent[];
    stats: {
        home: SimTeamStats;
        away: SimTeamStats;
    };
    manOfTheMatch: {
        playerId: number;
        name: string;
        team: string;
    } | null;
}
export interface MatchProbabilities {
    homeWin: number;
    draw: number;
    awayWin: number;
    expectedHomeGoals: number;
    expectedAwayGoals: number;
    mostLikelyScore: {
        home: number;
        away: number;
        probability: number;
    };
    scoreMatrix: number[][];
    bttsProbability: number;
    over25Probability: number;
    confidence: number;
}
export interface AiPrediction extends MatchProbabilities {
    predictedScore: {
        home: number;
        away: number;
    };
    likelyScorers: Array<{
        playerId: number;
        name: string;
        team: string;
        probability: number;
    }>;
    insights: string[];
    modelBreakdown: {
        elo: number;
        dixonColes: number;
        form: number;
    };
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
    champion: Record<string, number>;
    stageProbabilities: StageProbabilities[];
    mostLikelyFinal: {
        teams: [string, string];
        probability: number;
    };
    goldenBoot: Array<{
        playerId: number;
        name: string;
        team: string;
        avgGoals: number;
        topScorerShare: number;
    }>;
    surpriseTeam: {
        team: string;
        expectedRoundIndex: number;
        seedRank: number;
    } | null;
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
        penalties?: {
            home: number;
            away: number;
        };
        winner: string;
    }>;
    champion: string;
    runnerUp: string;
    thirdPlace: string;
    goldenBoot: {
        name: string;
        team: string;
        goals: number;
    } | null;
}
export interface LineupSlotAssignment {
    slotId: string;
    role: PitchRole;
    playerId: number;
}
export interface LineupPayload {
    formation: FormationId;
    startingXi: LineupSlotAssignment[];
    substitutes: number[];
    captainId: number;
    viceCaptainId: number;
}
export interface ChemistryBreakdown {
    total: number;
    clubLinks: number;
    leagueLinks: number;
    experienceBalance: number;
    ageBalance: number;
    captainBonus: number;
}
export interface TacticalFitBreakdown {
    total: number;
    positionFit: number;
    styleFit: number;
    formationFamiliarity: number;
    warnings: string[];
}
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
    outcomeSplit: {
        homeWin: number;
        draw: number;
        awayWin: number;
    };
    crowdConfidenceIndex: number;
    popularScorers: Array<{
        playerId: number;
        name: string;
        count: number;
    }>;
    totalSimulations: number;
}
export declare const WS_EVENTS: {
    readonly SUBSCRIBE_MATCH: "match:subscribe";
    readonly UNSUBSCRIBE_MATCH: "match:unsubscribe";
    readonly SUBSCRIBE_LEADERBOARD: "leaderboard:subscribe";
    readonly START_LIVE_SIM: "live:start";
    readonly MATCH_LIVE_UPDATE: "MATCH_LIVE_UPDATE";
    readonly LINEUP_OFFICIAL: "LINEUP_OFFICIAL";
    readonly SIMULATION_COMPLETE: "SIMULATION_COMPLETE";
    readonly RANKING_CHANGE: "RANKING_CHANGE";
    readonly PREDICTION_RESULT: "PREDICTION_RESULT";
    readonly NOTIFICATION: "NOTIFICATION";
    readonly LIVE_TICK: "LIVE_TICK";
    readonly LIVE_FINISHED: "LIVE_FINISHED";
};
export interface LiveTickPayload {
    matchNumber: number;
    minute: number;
    homeScore: number;
    awayScore: number;
    event?: SimMatchEvent;
    possessionHome: number;
    momentum: number;
}
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
//# sourceMappingURL=types.d.ts.map