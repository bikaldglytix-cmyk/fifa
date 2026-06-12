import type { SquadPosition } from './types';
/**
 * Fantasy scoring rules — single source of truth for engine, API and clients.
 * FPL-inspired, adapted to international tournament play.
 */
export declare const FANTASY_SCORING: {
    readonly appearance: 2;
    readonly goal: Record<SquadPosition, number>;
    readonly assist: 3;
    readonly cleanSheet: Record<SquadPosition, number>;
    /** per 2 goals conceded (GK/DF only) */
    readonly concededPenaltyPer2: -1;
    /** per 3 saves (GK) */
    readonly savesPer3: 1;
    readonly penaltySave: 5;
    readonly penaltyMiss: -2;
    readonly yellowCard: -1;
    readonly secondYellow: -3;
    readonly redCard: -3;
    readonly ownGoal: -2;
    readonly manOfTheMatch: 3;
    /** knockout progression bonus for every starter whose team wins a knockout tie */
    readonly knockoutWinBonus: 1;
    readonly captainMultiplier: 2;
    readonly viceCaptainMultiplier: 1.5;
};
/**
 * Prediction contest scoring.
 */
export declare const PREDICTION_SCORING: {
    readonly correctOutcome: 2;
    readonly exactScore: 5;
    readonly correctGoalDifference: 1;
    readonly firstGoalscorer: 3;
    readonly cleanSheetCall: 2;
    /** Knockout: predicting the team that advances (after ET/pens) when 90' outcome differs */
    readonly advancingTeamBonus: 1;
    /** stage multipliers — later stages worth more */
    readonly stageMultiplier: Record<string, number>;
};
/** Reputation score combines volume and quality of activity. */
export declare const REPUTATION_WEIGHTS: {
    readonly predictionPoint: 1;
    readonly fantasyPoint: 0.5;
    readonly simulationRun: 0.001;
    readonly followerBonus: 2;
};
/** Chemistry calculation weights (lineup builder). */
export declare const CHEMISTRY_WEIGHTS: {
    /** same club among starters: each pair adds links */
    readonly clubPairBonus: 3.5;
    /** same club country (league familiarity) pair bonus */
    readonly leaguePairBonus: 0.6;
    /** ideal average caps window */
    readonly capsSweetSpotMin: 25;
    readonly capsSweetSpotMax: 75;
    /** ideal average age window */
    readonly ageSweetSpotMin: 25;
    readonly ageSweetSpotMax: 28.5;
    readonly captainSeniorityCapsMin: 50;
};
//# sourceMappingURL=scoring.d.ts.map