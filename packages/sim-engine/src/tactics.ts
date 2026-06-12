import type { KeyBattle, TacticalAxes, TacticalComparison, TacticalStyle } from '@fifa/shared';
import { styleMatchupFactor } from './managers';
import type { EffectiveLineup } from './lineup';
import type { SimTeam } from './types';

/**
 * Tactical intelligence: each manager's preferred style maps to trait axes
 * (pressing intensity, possession share, directness, counter-attack threat,
 * set-piece emphasis, defensive-block solidity), refined by the formation
 * actually on the pitch. Matchup analysis surfaces where each side's plan
 * collides with the other's weaknesses.
 */

const STYLE_AXES: Record<TacticalStyle, TacticalAxes> = {
  possession:      { pressing: 55, possession: 85, directness: 25, counterAttack: 35, setPieces: 50, defensiveBlock: 45 },
  high_press:      { pressing: 90, possession: 65, directness: 45, counterAttack: 55, setPieces: 50, defensiveBlock: 40 },
  counter_attack:  { pressing: 40, possession: 35, directness: 75, counterAttack: 90, setPieces: 55, defensiveBlock: 70 },
  direct:          { pressing: 50, possession: 35, directness: 90, counterAttack: 55, setPieces: 75, defensiveBlock: 55 },
  defensive_block: { pressing: 28, possession: 30, directness: 60, counterAttack: 65, setPieces: 65, defensiveBlock: 92 },
};

/** Formation nudges on top of the style baseline. */
const FORMATION_AXIS_NUDGE: Record<string, Partial<TacticalAxes>> = {
  '4-3-3':   { pressing: +5, possession: +5 },
  '4-2-3-1': { counterAttack: +5, defensiveBlock: +3 },
  '3-5-2':   { possession: +4, setPieces: +4 },
  '4-4-2':   { directness: +6, setPieces: +3 },
  '5-3-2':   { defensiveBlock: +8, counterAttack: +5, possession: -5 },
};

export function tacticalAxes(style: TacticalStyle, formationId: string): TacticalAxes {
  const base = { ...STYLE_AXES[style] };
  const nudge = FORMATION_AXIS_NUDGE[formationId] ?? {};
  for (const k of Object.keys(nudge) as Array<keyof TacticalAxes>) {
    base[k] = Math.max(0, Math.min(100, base[k] + (nudge[k] ?? 0)));
  }
  return base;
}

export function compareTactics(home: SimTeam, homeLineup: EffectiveLineup, away: SimTeam, awayLineup: EffectiveLineup): TacticalComparison {
  const homeStyle = home.manager.preferredStyle;
  const awayStyle = away.manager.preferredStyle;
  const h = tacticalAxes(homeStyle, homeLineup.formation.id);
  const a = tacticalAxes(awayStyle, awayLineup.formation.id);

  const homeEdgeFactor = styleMatchupFactor(homeStyle, awayStyle);
  const awayEdgeFactor = styleMatchupFactor(awayStyle, homeStyle);
  const styleEdge = homeEdgeFactor > awayEdgeFactor ? 'home' : awayEdgeFactor > homeEdgeFactor ? 'away' : null;

  const edges: string[] = [];
  const label = (s: TacticalStyle) => s.replace(/_/g, ' ');

  if (styleEdge) {
    const winner = styleEdge === 'home' ? home : away;
    const loser = styleEdge === 'home' ? away : home;
    edges.push(
      `${winner.name}'s ${label(winner.manager.preferredStyle)} is a natural counter to ${label(loser.manager.preferredStyle)} — style beats strength in matches like this`,
    );
  }
  if (h.pressing >= 75 && a.possession >= 70) {
    edges.push(`${home.name}'s press attacks the very thing ${away.name} want: time on the ball`);
  }
  if (a.pressing >= 75 && h.possession >= 70) {
    edges.push(`${away.name}'s press targets ${home.name}'s build-up patterns directly`);
  }
  if (h.counterAttack >= 75 && a.defensiveBlock <= 50) {
    edges.push(`${home.name} break at pace into space ${away.name} habitually leave behind`);
  }
  if (a.counterAttack >= 75 && h.defensiveBlock <= 50) {
    edges.push(`${away.name}'s transitions are the classic undoing of an open ${label(homeStyle)} side`);
  }
  if (Math.max(h.setPieces, a.setPieces) >= 70) {
    const better = h.setPieces >= a.setPieces ? home : away;
    edges.push(`${better.name} carry a genuine set-piece threat — dead balls could decide a tight game`);
  }

  return {
    home: { style: homeStyle, formation: homeLineup.formation.id as TacticalComparison['home']['formation'], axes: h },
    away: { style: awayStyle, formation: awayLineup.formation.id as TacticalComparison['away']['formation'], axes: a },
    styleEdge,
    edges: edges.slice(0, 4),
  };
}

/** Positional duels between the best players in each zone of the pitch. */
export function keyBattles(home: SimTeam, homeLineup: EffectiveLineup, away: SimTeam, awayLineup: EffectiveLineup): KeyBattle[] {
  const topByGroup = (lineup: EffectiveLineup, group: 'FW' | 'MF' | 'DF' | 'GK') =>
    lineup.assignments
      .map((x) => x.player)
      .filter((p) => p.position === group)
      .sort((x, y) => y.rating - x.rating)[0] ?? null;

  const zones: Array<{ zone: string; homeGroup: 'FW' | 'MF' | 'DF' | 'GK'; awayGroup: 'FW' | 'MF' | 'DF' | 'GK'; note: (h: string, a: string) => string }> = [
    { zone: 'Attack vs Defence', homeGroup: 'FW', awayGroup: 'DF', note: (h, a) => `${h} running at ${a} is the matchup that decides most nights` },
    { zone: 'Midfield control', homeGroup: 'MF', awayGroup: 'MF', note: (h, a) => `${h} and ${a} contest the game's engine room` },
    { zone: 'Defence vs Attack', homeGroup: 'DF', awayGroup: 'FW', note: (h, a) => `${h} must contain ${a} — one lapse changes everything` },
  ];

  const battles: KeyBattle[] = [];
  for (const z of zones) {
    const hp = topByGroup(homeLineup, z.homeGroup);
    const ap = topByGroup(awayLineup, z.awayGroup);
    if (!hp || !ap) continue;
    const diff = hp.rating - ap.rating;
    battles.push({
      zone: z.zone,
      home: { playerId: hp.id, name: hp.name, rating: Math.round(hp.rating), position: hp.position },
      away: { playerId: ap.id, name: ap.name, rating: Math.round(ap.rating), position: ap.position },
      edge: diff > 3 ? 'home' : diff < -3 ? 'away' : 'even',
      note: z.note(hp.name, ap.name),
    });
  }
  return battles;
}
