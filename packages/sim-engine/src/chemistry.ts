import {
  CHEMISTRY_WEIGHTS,
  FORMATIONS,
  type ChemistryBreakdown,
  type FormationId,
  type LineupSlotAssignment,
  type TacticalFitBreakdown,
  type TacticalStyle,
  clamp,
  mean,
  round,
} from '@fifa/shared';
import type { SimPlayer } from './types';

/**
 * Chemistry: club links, league familiarity, experience and age balance.
 * National squads share nationality by construction, so cohesion derives
 * from who actually plays together week to week.
 */
export function computeChemistry(
  starters: SimPlayer[],
  captainId: number | null,
): ChemistryBreakdown {
  const W = CHEMISTRY_WEIGHTS;

  let clubPairs = 0;
  let leaguePairs = 0;
  for (let i = 0; i < starters.length; i++) {
    for (let j = i + 1; j < starters.length; j++) {
      if (starters[i].club && starters[i].club === starters[j].club) clubPairs++;
      else if (starters[i].clubCountry && starters[i].clubCountry === starters[j].clubCountry) leaguePairs++;
    }
  }
  const clubLinks = clamp(clubPairs * W.clubPairBonus, 0, 25);
  const leagueLinks = clamp(leaguePairs * W.leaguePairBonus, 0, 15);

  const avgCaps = mean(starters.map((p) => p.caps));
  const experienceBalance =
    avgCaps >= W.capsSweetSpotMin && avgCaps <= W.capsSweetSpotMax
      ? 25
      : avgCaps < W.capsSweetSpotMin
        ? clamp(25 - (W.capsSweetSpotMin - avgCaps) * 0.9, 5, 25)
        : clamp(25 - (avgCaps - W.capsSweetSpotMax) * 0.5, 10, 25);

  const avgAge = mean(starters.map((p) => p.age));
  const ageBalance =
    avgAge >= W.ageSweetSpotMin && avgAge <= W.ageSweetSpotMax
      ? 20
      : clamp(20 - Math.abs(avgAge - (W.ageSweetSpotMin + W.ageSweetSpotMax) / 2) * 3.2, 4, 20);

  const captain = starters.find((p) => p.id === captainId);
  const captainBonus = captain
    ? captain.captain
      ? 15
      : captain.caps >= W.captainSeniorityCapsMin
        ? 11
        : 6
    : 0;

  const total = round(clamp(clubLinks + leagueLinks + experienceBalance + ageBalance + captainBonus, 0, 100), 0);
  return { total, clubLinks: round(clubLinks, 1), leagueLinks: round(leagueLinks, 1), experienceBalance: round(experienceBalance, 1), ageBalance: round(ageBalance, 1), captainBonus };
}

/**
 * Tactical fit: are players in natural slots, does the formation suit the
 * manager's style, and is the XI built from familiar position groups?
 */
export function computeTacticalFit(
  formationId: FormationId,
  startingXi: LineupSlotAssignment[],
  squadById: Map<number, SimPlayer>,
  managerStyle: TacticalStyle,
): TacticalFitBreakdown {
  const formation = FORMATIONS[formationId];
  const warnings: string[] = [];

  let naturalCount = 0;
  for (const slot of formation.slots) {
    const assignment = startingXi.find((x) => x.slotId === slot.id);
    const player = assignment ? squadById.get(assignment.playerId) : undefined;
    if (!player) {
      warnings.push(`No player assigned to ${slot.id}.`);
      continue;
    }
    if (slot.natural.includes(player.position)) {
      naturalCount++;
    } else {
      warnings.push(`${player.name} (${player.position}) is out of position at ${slot.id}.`);
    }
  }
  const positionFit = (naturalCount / formation.slots.length) * 60;

  const STYLE_PREFERRED: Record<TacticalStyle, FormationId[]> = {
    possession: ['4-3-3', '4-2-3-1'],
    high_press: ['4-3-3', '4-2-3-1'],
    counter_attack: ['4-2-3-1', '5-3-2', '4-4-2'],
    direct: ['4-4-2', '3-5-2'],
    defensive_block: ['5-3-2', '4-4-2'],
  };
  const preferred = STYLE_PREFERRED[managerStyle];
  const styleFit = preferred[0] === formationId ? 25 : preferred.includes(formationId) ? 20 : 12;
  if (styleFit <= 12) {
    warnings.push(`${formationId} clashes with the manager's ${managerStyle.replace('_', ' ')} approach.`);
  }

  // familiarity: GK exactly 1 (enforced), bonus for ≥2 recognised FW in attacking formations
  const xiPlayers = startingXi
    .map((x) => squadById.get(x.playerId))
    .filter((p): p is SimPlayer => Boolean(p));
  const fwCount = xiPlayers.filter((p) => p.position === 'FW').length;
  const dfCount = xiPlayers.filter((p) => p.position === 'DF').length;
  let formationFamiliarity = 15;
  if (dfCount < 3) {
    formationFamiliarity -= 5;
    warnings.push('Fewer than three recognised defenders selected.');
  }
  if (fwCount === 0) {
    formationFamiliarity -= 4;
    warnings.push('No recognised forward in the XI.');
  }

  const total = round(clamp(positionFit + styleFit + formationFamiliarity, 0, 100), 0);
  return { total, positionFit: round(positionFit, 1), styleFit, formationFamiliarity, warnings: warnings.slice(0, 6) };
}
