import type { MatchConditionsInfo } from '@fifa/shared';
import { clamp } from '@fifa/shared';
import { VENUE_GEO } from './geo';

/**
 * Venue intelligence: altitude, heat/humidity and crowd context translated
 * into small, bounded expected-goal modifiers. Climatology only — no
 * fabricated live weather.
 */

/** Nations whose national-team environment is high-altitude (acclimatized). */
const ALTITUDE_NATIVE = new Set(['MEX', 'ECU', 'COL', 'PER', 'BOL']);

export interface VenueMeta {
  name: string;
  city: string;
  capacity: number;
}

export interface ConditionsAssessment {
  info: MatchConditionsInfo;
  /** multiplicative λ adjustments (bounded ~±6%) */
  lambdaFactorHome: number;
  lambdaFactorAway: number;
  /** extra late-game fatigue pressure from heat/altitude, 0..1 */
  staminaDrain: number;
}

export function assessConditions(
  venueId: string,
  meta: VenueMeta,
  homeCode: string,
  awayCode: string,
): ConditionsAssessment | null {
  const geo = VENUE_GEO[venueId];
  if (!geo) return null;

  const notes: string[] = [];
  let home = 1;
  let away = 1;
  let staminaDrain = 0;

  // --- altitude --------------------------------------------------------------
  if (geo.altitudeM >= 1400) {
    const severity = geo.altitudeM >= 2000 ? 0.06 : 0.035;
    const homeNative = ALTITUDE_NATIVE.has(homeCode);
    const awayNative = ALTITUDE_NATIVE.has(awayCode);
    if (!homeNative) home *= 1 - severity;
    if (!awayNative) away *= 1 - severity;
    staminaDrain += geo.altitudeM >= 2000 ? 0.35 : 0.2;
    notes.push(
      `${meta.city} sits at ${geo.altitudeM.toLocaleString()} m — thinner air punishes unacclimatized sides` +
        (homeNative !== awayNative
          ? ` (${homeNative ? homeCode : awayCode} are altitude-accustomed, ${homeNative ? awayCode : homeCode} are not)`
          : ''),
    );
  }

  // --- heat & humidity ---------------------------------------------------------
  if (geo.avgHighC >= 32) {
    home *= 0.975;
    away *= 0.975;
    staminaDrain += 0.25;
    notes.push(`Climatological June high of ${geo.avgHighC}°C slows tempo — expect more game management`);
  }
  if (geo.avgHumidityPct >= 70) {
    staminaDrain += 0.15;
    notes.push(`High humidity (~${geo.avgHumidityPct}%) accelerates late-game fatigue`);
  }

  // --- crowd scale --------------------------------------------------------------
  if (meta.capacity >= 80000) {
    notes.push(`${meta.capacity.toLocaleString()}-seat cauldron — big-stage atmosphere favours tournament-hardened squads`);
  }

  return {
    info: {
      venueId,
      venueName: meta.name,
      city: meta.city,
      altitudeM: geo.altitudeM,
      avgHighC: geo.avgHighC,
      avgHumidityPct: geo.avgHumidityPct,
      capacity: meta.capacity,
      timezoneOffsetHours: geo.tzOffsetHours,
      notes,
    },
    lambdaFactorHome: clamp(home, 0.9, 1.05),
    lambdaFactorAway: clamp(away, 0.9, 1.05),
    staminaDrain: clamp(staminaDrain, 0, 1),
  };
}
