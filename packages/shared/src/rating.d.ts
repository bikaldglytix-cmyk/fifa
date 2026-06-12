import type { SquadPosition } from './types';
/**
 * Deterministic player base-rating model (0–100).
 *
 * Inputs are real, published data only: official squad-list position, caps,
 * international goals, date of birth and current club's league country.
 * The formula is a documented modeling choice (see README §Data & Modeling):
 *
 *  rating = positionBase
 *         + experience(caps)            // log-scaled, 0..14
 *         + scoringContribution(pos)    // goals-per-cap vs positional norm
 *         + leagueQuality(clubCountry)  // 0..12
 *         + ageCurve(age, pos)          // peak 27 (GK 30), quadratic decay
 *         + captainBonus
 */
export interface RatingInput {
    position: SquadPosition;
    caps: number;
    internationalGoals: number;
    age: number;
    clubCountry: string | null;
    captain?: boolean;
}
export declare function computePlayerRating(p: RatingInput): number;
/** Simple per-position fantasy "price" derived from rating, for UI display. */
export declare function fantasyPrice(rating: number): number;
//# sourceMappingURL=rating.d.ts.map