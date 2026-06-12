import type { SquadPosition } from './types';

/**
 * Fantasy scoring rules — single source of truth for engine, API and clients.
 * FPL-inspired, adapted to international tournament play.
 */
export const FANTASY_SCORING = {
  appearance: 2, // started or came on
  goal: { GK: 7, DF: 6, MF: 5, FW: 4 } as Record<SquadPosition, number>,
  assist: 3,
  cleanSheet: { GK: 4, DF: 4, MF: 1, FW: 0 } as Record<SquadPosition, number>,
  /** per 2 goals conceded (GK/DF only) */
  concededPenaltyPer2: -1,
  /** per 3 saves (GK) */
  savesPer3: 1,
  penaltySave: 5,
  penaltyMiss: -2,
  yellowCard: -1,
  secondYellow: -3,
  redCard: -3,
  ownGoal: -2,
  manOfTheMatch: 3,
  /** knockout progression bonus for every starter whose team wins a knockout tie */
  knockoutWinBonus: 1,
  captainMultiplier: 2,
  viceCaptainMultiplier: 1.5, // applied only when captain did not play
} as const;

/**
 * Prediction contest scoring.
 */
export const PREDICTION_SCORING = {
  correctOutcome: 2, // W/D/L tendency
  exactScore: 5, // includes the outcome points implicitly? No — added on top
  correctGoalDifference: 1, // bonus when outcome correct and GD matches (non-exact)
  firstGoalscorer: 3,
  cleanSheetCall: 2,
  /** Knockout: predicting the team that advances (after ET/pens) when 90' outcome differs */
  advancingTeamBonus: 1,
  /** stage multipliers — later stages worth more */
  stageMultiplier: {
    group: 1,
    round32: 1.25,
    round16: 1.5,
    quarterfinal: 2,
    semifinal: 2.5,
    third_place: 2,
    final: 3,
  } as Record<string, number>,
} as const;

/** Reputation score combines volume and quality of activity. */
export const REPUTATION_WEIGHTS = {
  predictionPoint: 1.0,
  fantasyPoint: 0.5,
  simulationRun: 0.001,
  followerBonus: 2,
} as const;

/** Chemistry calculation weights (lineup builder). */
export const CHEMISTRY_WEIGHTS = {
  /** same club among starters: each pair adds links */
  clubPairBonus: 3.5,
  /** same club country (league familiarity) pair bonus */
  leaguePairBonus: 0.6,
  /** ideal average caps window */
  capsSweetSpotMin: 25,
  capsSweetSpotMax: 75,
  /** ideal average age window */
  ageSweetSpotMin: 25.0,
  ageSweetSpotMax: 28.5,
  captainSeniorityCapsMin: 50,
} as const;
