import type { FormationId, PitchRole, SquadPosition } from './types';

export interface FormationSlot {
  /** Unique within formation, e.g. "CB1", "LW". */
  id: string;
  role: PitchRole;
  /** Squad-list groups eligible for this slot without a tactical-fit penalty. */
  natural: SquadPosition[];
  /** Pitch coordinates for rendering: x 0..100 (left→right), y 0..100 (own goal→opponent goal). */
  x: number;
  y: number;
}

export interface FormationDef {
  id: FormationId;
  name: string;
  description: string;
  /** Style biases applied by the sim when a team lines up in this formation. */
  attackModifier: number;
  defenseModifier: number;
  slots: FormationSlot[];
}

const GK: FormationSlot = { id: 'GK', role: 'GK', natural: ['GK'], x: 50, y: 4 };

export const FORMATIONS: Record<FormationId, FormationDef> = {
  '4-3-3': {
    id: '4-3-3',
    name: '4-3-3',
    description: 'Balanced possession shape with wide forwards and a midfield triangle.',
    attackModifier: 1.05,
    defenseModifier: 1.0,
    slots: [
      GK,
      { id: 'LB', role: 'LB', natural: ['DF'], x: 14, y: 26 },
      { id: 'CB1', role: 'CB', natural: ['DF'], x: 37, y: 20 },
      { id: 'CB2', role: 'CB', natural: ['DF'], x: 63, y: 20 },
      { id: 'RB', role: 'RB', natural: ['DF'], x: 86, y: 26 },
      { id: 'CDM', role: 'CDM', natural: ['MF'], x: 50, y: 42 },
      { id: 'CM1', role: 'CM', natural: ['MF'], x: 30, y: 55 },
      { id: 'CM2', role: 'CM', natural: ['MF'], x: 70, y: 55 },
      { id: 'LW', role: 'LW', natural: ['FW', 'MF'], x: 16, y: 78 },
      { id: 'ST', role: 'ST', natural: ['FW'], x: 50, y: 86 },
      { id: 'RW', role: 'RW', natural: ['FW', 'MF'], x: 84, y: 78 },
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    name: '4-2-3-1',
    description: 'Double pivot with an advanced playmaker behind a lone striker.',
    attackModifier: 1.0,
    defenseModifier: 1.03,
    slots: [
      GK,
      { id: 'LB', role: 'LB', natural: ['DF'], x: 14, y: 26 },
      { id: 'CB1', role: 'CB', natural: ['DF'], x: 37, y: 20 },
      { id: 'CB2', role: 'CB', natural: ['DF'], x: 63, y: 20 },
      { id: 'RB', role: 'RB', natural: ['DF'], x: 86, y: 26 },
      { id: 'CDM1', role: 'CDM', natural: ['MF'], x: 36, y: 42 },
      { id: 'CDM2', role: 'CDM', natural: ['MF'], x: 64, y: 42 },
      { id: 'LM', role: 'LM', natural: ['MF', 'FW'], x: 18, y: 64 },
      { id: 'CAM', role: 'CAM', natural: ['MF', 'FW'], x: 50, y: 64 },
      { id: 'RM', role: 'RM', natural: ['MF', 'FW'], x: 82, y: 64 },
      { id: 'ST', role: 'ST', natural: ['FW'], x: 50, y: 86 },
    ],
  },
  '3-5-2': {
    id: '3-5-2',
    name: '3-5-2',
    description: 'Back three with wing-backs supplying width for a front two.',
    attackModifier: 1.02,
    defenseModifier: 0.98,
    slots: [
      GK,
      { id: 'CB1', role: 'CB', natural: ['DF'], x: 28, y: 20 },
      { id: 'CB2', role: 'CB', natural: ['DF'], x: 50, y: 17 },
      { id: 'CB3', role: 'CB', natural: ['DF'], x: 72, y: 20 },
      { id: 'LWB', role: 'LWB', natural: ['DF', 'MF'], x: 10, y: 48 },
      { id: 'RWB', role: 'RWB', natural: ['DF', 'MF'], x: 90, y: 48 },
      { id: 'CM1', role: 'CM', natural: ['MF'], x: 32, y: 50 },
      { id: 'CM2', role: 'CDM', natural: ['MF'], x: 50, y: 42 },
      { id: 'CM3', role: 'CM', natural: ['MF'], x: 68, y: 50 },
      { id: 'ST1', role: 'ST', natural: ['FW'], x: 38, y: 84 },
      { id: 'ST2', role: 'ST', natural: ['FW'], x: 62, y: 84 },
    ],
  },
  '4-4-2': {
    id: '4-4-2',
    name: '4-4-2',
    description: 'Two compact banks of four with a classic strike partnership.',
    attackModifier: 0.99,
    defenseModifier: 1.04,
    slots: [
      GK,
      { id: 'LB', role: 'LB', natural: ['DF'], x: 14, y: 26 },
      { id: 'CB1', role: 'CB', natural: ['DF'], x: 37, y: 20 },
      { id: 'CB2', role: 'CB', natural: ['DF'], x: 63, y: 20 },
      { id: 'RB', role: 'RB', natural: ['DF'], x: 86, y: 26 },
      { id: 'LM', role: 'LM', natural: ['MF', 'FW'], x: 14, y: 55 },
      { id: 'CM1', role: 'CM', natural: ['MF'], x: 38, y: 50 },
      { id: 'CM2', role: 'CM', natural: ['MF'], x: 62, y: 50 },
      { id: 'RM', role: 'RM', natural: ['MF', 'FW'], x: 86, y: 55 },
      { id: 'ST1', role: 'ST', natural: ['FW'], x: 38, y: 84 },
      { id: 'ST2', role: 'ST', natural: ['FW'], x: 62, y: 84 },
    ],
  },
  '5-3-2': {
    id: '5-3-2',
    name: '5-3-2',
    description: 'Low-block back five built to absorb pressure and counter.',
    attackModifier: 0.93,
    defenseModifier: 1.1,
    slots: [
      GK,
      { id: 'LWB', role: 'LWB', natural: ['DF', 'MF'], x: 8, y: 32 },
      { id: 'CB1', role: 'CB', natural: ['DF'], x: 30, y: 19 },
      { id: 'CB2', role: 'CB', natural: ['DF'], x: 50, y: 16 },
      { id: 'CB3', role: 'CB', natural: ['DF'], x: 70, y: 19 },
      { id: 'RWB', role: 'RWB', natural: ['DF', 'MF'], x: 92, y: 32 },
      { id: 'CM1', role: 'CM', natural: ['MF'], x: 30, y: 50 },
      { id: 'CM2', role: 'CDM', natural: ['MF'], x: 50, y: 44 },
      { id: 'CM3', role: 'CM', natural: ['MF'], x: 70, y: 50 },
      { id: 'ST1', role: 'ST', natural: ['FW'], x: 38, y: 82 },
      { id: 'ST2', role: 'ST', natural: ['FW'], x: 62, y: 82 },
    ],
  },
};

export const FORMATION_IDS = Object.keys(FORMATIONS) as FormationId[];

/** Position-group weighting for goal involvement, used by scorer selection and ratings. */
export const POSITION_GOAL_WEIGHT: Record<SquadPosition, number> = {
  GK: 0.001,
  DF: 0.06,
  MF: 0.25,
  FW: 0.69,
};

export const POSITION_ASSIST_WEIGHT: Record<SquadPosition, number> = {
  GK: 0.005,
  DF: 0.14,
  MF: 0.48,
  FW: 0.375,
};

/** Role-level multipliers refining the group weight when a lineup is known. */
export const ROLE_GOAL_MULTIPLIER: Record<PitchRole, number> = {
  GK: 0.05,
  CB: 0.6,
  LB: 0.7,
  RB: 0.7,
  LWB: 0.9,
  RWB: 0.9,
  CDM: 0.7,
  CM: 1.0,
  CAM: 1.7,
  LM: 1.3,
  RM: 1.3,
  LW: 2.1,
  RW: 2.1,
  CF: 2.6,
  ST: 3.0,
};
