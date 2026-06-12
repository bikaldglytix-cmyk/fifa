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
export declare const FORMATIONS: Record<FormationId, FormationDef>;
export declare const FORMATION_IDS: FormationId[];
/** Position-group weighting for goal involvement, used by scorer selection and ratings. */
export declare const POSITION_GOAL_WEIGHT: Record<SquadPosition, number>;
export declare const POSITION_ASSIST_WEIGHT: Record<SquadPosition, number>;
/** Role-level multipliers refining the group weight when a lineup is known. */
export declare const ROLE_GOAL_MULTIPLIER: Record<PitchRole, number>;
//# sourceMappingURL=formations.d.ts.map