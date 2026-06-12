import { LEAGUE_STRENGTH, LEAGUE_STRENGTH_DEFAULT } from './constants';
import type { SquadPosition } from './types';
import { clamp } from './utils';

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

const POSITION_BASE: Record<SquadPosition, number> = { GK: 62, DF: 63, MF: 64, FW: 64 };

/** goals-per-cap considered "elite" for the position group */
const POSITION_GPG_NORM: Record<SquadPosition, number> = { GK: 0.005, DF: 0.12, MF: 0.35, FW: 0.65 };
const POSITION_GPG_POINTS: Record<SquadPosition, number> = { GK: 0, DF: 6, MF: 10, FW: 16 };

export function computePlayerRating(p: RatingInput): number {
  const base = POSITION_BASE[p.position];

  const experience = (14 * Math.log10(1 + p.caps)) / Math.log10(1 + 150);

  const gpg = p.internationalGoals / Math.max(8, p.caps);
  const scoring = POSITION_GPG_POINTS[p.position] * Math.min(1.15, gpg / POSITION_GPG_NORM[p.position]);

  const league = 12 * (p.clubCountry ? (LEAGUE_STRENGTH[p.clubCountry] ?? LEAGUE_STRENGTH_DEFAULT) : LEAGUE_STRENGTH_DEFAULT);

  const peak = p.position === 'GK' ? 30 : 27;
  const ageCurve = Math.max(-10, -0.35 * (p.age - peak) ** 2 + 2);

  const captain = p.captain ? 1.5 : 0;

  return clamp(Math.round((base + experience + scoring + league + ageCurve + captain) * 10) / 10, 45, 94);
}

/** Simple per-position fantasy "price" derived from rating, for UI display. */
export function fantasyPrice(rating: number): number {
  return Math.round((4 + ((rating - 45) / 49) * 9.5) * 2) / 2; // 4.0 .. 13.5
}
