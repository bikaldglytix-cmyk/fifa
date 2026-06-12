import type { TeamFatigueInfo } from '@fifa/shared';
import { clamp, round } from '@fifa/shared';
import { venueDistanceKm, venueTzShift } from './geo';

/**
 * Fatigue engine: squad freshness from the team's actual tournament
 * itinerary — rest windows, match congestion, travel distance and time-zone
 * shifts between venues. Club-season minutes are not in the verified dataset,
 * so they are explicitly excluded (reported as proxy coverage, never faked).
 */

export interface ItineraryStop {
  /** kickoff time of a previous match this team played */
  date: Date;
  venueId: string;
}

export function computeTeamFatigue(
  team: string,
  itinerary: ItineraryStop[],
  matchDate: Date,
  venueId: string,
): TeamFatigueInfo {
  const past = itinerary
    .filter((s) => s.date.getTime() < matchDate.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const last = past[past.length - 1] ?? null;
  const dayMs = 86_400_000;
  const restDays = last ? (matchDate.getTime() - last.date.getTime()) / dayMs : null;
  const matches7d = past.filter((s) => matchDate.getTime() - s.date.getTime() <= 7 * dayMs).length;
  const matches14d = past.filter((s) => matchDate.getTime() - s.date.getTime() <= 14 * dayMs).length;
  const travelKm = last ? venueDistanceKm(last.venueId, venueId) : 0;
  const tzShift = last ? venueTzShift(last.venueId, venueId) : 0;

  const notes: string[] = [];
  let freshness = 100;

  if (restDays !== null) {
    if (restDays < 3) {
      freshness -= 22;
      notes.push(`Only ${restDays.toFixed(1)} days since their last match — heavy legs likely`);
    } else if (restDays < 4) {
      freshness -= 12;
      notes.push(`${restDays.toFixed(1)} days of rest — slightly short of ideal recovery`);
    } else if (restDays > 6) {
      notes.push(`${Math.floor(restDays)} days of rest — fully recovered squad`);
    }
  } else {
    notes.push('Tournament opener — fully rested squad');
  }

  if (matches7d >= 2) {
    freshness -= 10;
    notes.push(`${matches7d} matches inside 7 days — rotation pressure builds`);
  }
  if (matches14d >= 4) {
    freshness -= 8;
    notes.push(`${matches14d} matches in 14 days — cumulative load is real`);
  }

  if (travelKm > 3000) {
    freshness -= 10;
    notes.push(`${Math.round(travelKm).toLocaleString()} km travelled since the last match`);
  } else if (travelKm > 1500) {
    freshness -= 5;
    notes.push(`${Math.round(travelKm).toLocaleString()} km between venues`);
  }

  if (tzShift >= 3) {
    freshness -= 8;
    notes.push(`${tzShift}-hour time-zone shift — circadian disruption risk`);
  } else if (tzShift >= 2) {
    freshness -= 4;
    notes.push(`${tzShift}-hour time-zone change since last venue`);
  }

  freshness = clamp(freshness, 35, 100);
  const label: TeamFatigueInfo['label'] =
    freshness >= 88 ? 'fresh' : freshness >= 72 ? 'normal' : freshness >= 55 ? 'tired' : 'exhausted';

  return {
    team,
    restDays: restDays === null ? null : round(restDays, 1),
    matches7d,
    matches14d,
    travelKm: Math.round(travelKm),
    tzShift,
    freshness: Math.round(freshness),
    label,
    notes,
  };
}

/** Bounded λ multiplier from freshness: 100 → 1.0, 35 → ~0.93. */
export function fatigueLambdaFactor(info: TeamFatigueInfo): number {
  return clamp(1 - (100 - info.freshness) * 0.0011, 0.92, 1.0);
}
