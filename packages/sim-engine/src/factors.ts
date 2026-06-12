import { assessConditions, type VenueMeta } from './conditions';
import { computeTeamFatigue, type ItineraryStop } from './fatigue';
import { assessPsychology } from './psychology';
import type { MatchExtras } from './strength';
import type { H2HRecord, MatchContext, SimTeam } from './types';

/**
 * Assembles the full situational-factor bundle for a fixture from verified
 * inputs: the venue's reference data, each side's actual tournament itinerary
 * and the competitive situation. Pure and deterministic — the API layer feeds
 * it real schedule state.
 */

export interface ExtrasContext {
  venueId: string;
  venueMeta: VenueMeta;
  matchDate: Date;
  homeItinerary: ItineraryStop[];
  awayItinerary: ItineraryStop[];
  /** computed by the caller from live standings (matchday-3 elimination math) */
  mustWinHome?: boolean;
  mustWinAway?: boolean;
}

const HOST_OF: Record<string, 'USA' | 'MEX' | 'CAN'> = { USA: 'USA', MEX: 'MEX', CAN: 'CAN' };

export function assembleExtras(
  home: SimTeam,
  away: SimTeam,
  ctx: MatchContext,
  h2h: H2HRecord | null,
  x: ExtrasContext,
): MatchExtras {
  const conditions = assessConditions(x.venueId, x.venueMeta, home.code, away.code);
  const homeFatigue = computeTeamFatigue(home.code, x.homeItinerary, x.matchDate, x.venueId);
  const awayFatigue = computeTeamFatigue(away.code, x.awayItinerary, x.matchDate, x.venueId);

  const [c1] = [home.code, away.code].sort();
  const homePsych = assessPsychology({
    team: home,
    opponent: away,
    stage: ctx.stage,
    knockout: ctx.knockout,
    playingInOwnCountry: home.isHostNation && HOST_OF[home.code] === ctx.venueCountry,
    mustWin: x.mustWinHome ?? false,
    h2h,
    isCountry1: c1 === home.code,
  });
  const awayPsych = assessPsychology({
    team: away,
    opponent: home,
    stage: ctx.stage,
    knockout: ctx.knockout,
    playingInOwnCountry: away.isHostNation && HOST_OF[away.code] === ctx.venueCountry,
    mustWin: x.mustWinAway ?? false,
    h2h,
    isCountry1: c1 === away.code,
  });

  return { conditions, homeFatigue, awayFatigue, homePsych, awayPsych };
}
