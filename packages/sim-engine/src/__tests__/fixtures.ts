/** Test fixtures assembled from the REAL seed dataset in packages/db/data. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ageOn, computePlayerRating, HOST_COUNTRIES, TOURNAMENT_START, type ScheduledMatch } from '@fifa/shared';
import type { H2HRecord, ManagerProfile, SimTeam } from '../types';
import type { ThirdPlaceTable } from '../bracket';
import { formScore } from '../strength';
import type { TournamentInputs } from '../tournament';

const DATA = join(__dirname, '..', '..', '..', 'db', 'data');
const load = <T,>(f: string): T => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

let cached: TournamentInputs | null = null;
let pidCounter = 1;

export function realTournamentInputs(): TournamentInputs {
  if (cached) return cached;
  const countries = load<any[]>('countries.json');
  const squads = load<Record<string, any>>('squads.json');
  const matches = load<ScheduledMatch[]>('matches.json');
  const h2hJson = load<Record<string, any>>('h2h.json');
  const form = load<Record<string, any[]>>('recent-form.json');
  const thirdPlaceTable = load<ThirdPlaceTable>('third-place-table.json');
  const venues = load<Record<string, any>>('venues.json');

  const teams = new Map<string, SimTeam>();
  for (const c of countries) {
    const squad = squads[c.code];
    const eloPct = Math.max(0, Math.min(1, (c.eloRating - 1300) / (2160 - 1300)));
    const p24 = c.profile24mo;
    const winRate = p24.wins / Math.max(1, p24.played);
    const manager: ManagerProfile = {
      name: c.coach,
      tacticalRating: Math.round(45 + eloPct * 50),
      adaptabilityRating: Math.round(40 + winRate * 55),
      substitutionRating: Math.round(45 + winRate * 40 + eloPct * 10),
      pressureHandling: Math.round(40 + eloPct * 35 + Math.min(15, (c.worldCupAppearances ?? 0) * 1.2)),
      knockoutRating: Math.round(40 + eloPct * 35 + (c.shootouts.taken > 0 ? (c.shootouts.won / c.shootouts.taken) * 20 : 8)),
      preferredStyle:
        p24.gf / Math.max(1, p24.played) >= 1.9 && p24.ga / Math.max(1, p24.played) <= 1.0
          ? c.eloRating >= 1900 ? 'possession' : 'high_press'
          : p24.gf / Math.max(1, p24.played) < 1.25
            ? 'defensive_block'
            : 'counter_attack',
    };
    const results = (form[c.code] ?? [])
      .map((f: any) => (f.gf > f.ga ? 'W' : f.gf === f.ga ? 'D' : 'L'))
      .join('');
    teams.set(c.code, {
      code: c.code,
      name: c.name,
      elo: c.eloRating,
      fifaRanking: c.fifaRanking,
      confederation: c.confederation,
      group: c.group,
      isHostNation: (HOST_COUNTRIES as readonly string[]).includes(c.code),
      manager,
      squad: squad.players.map((p: any) => {
        const age = ageOn(p.dateOfBirth, TOURNAMENT_START);
        return {
          id: pidCounter++,
          name: p.name,
          position: p.position,
          rating: computePlayerRating({
            position: p.position, caps: p.caps, internationalGoals: p.goals,
            age, clubCountry: p.clubCountry, captain: p.captain,
          }),
          caps: p.caps,
          internationalGoals: p.goals,
          age,
          club: p.club,
          clubCountry: p.clubCountry,
          captain: p.captain,
          jerseyNumber: p.number,
          fitness: 100,
        };
      }),
      form: { results, score: formScore(results) },
      shootouts: c.shootouts,
    });
  }

  const h2h = new Map<string, H2HRecord>();
  for (const [key, v] of Object.entries<any>(h2hJson)) {
    const [c1, c2] = key.split('-');
    h2h.set(key, {
      played: v.played,
      wins1: v.wins[c1] ?? 0,
      wins2: v.wins[c2] ?? 0,
      draws: v.draws,
      goals1: v.goals[c1] ?? 0,
      goals2: v.goals[c2] ?? 0,
      wcMeetings: v.wcMeetings ?? 0,
      lastMeeting: v.lastMeeting ? { date: v.lastMeeting.date, score: v.lastMeeting.score, tournament: v.lastMeeting.tournament } : null,
    });
  }

  const venueCountryByMatch = new Map<number, 'USA' | 'MEX' | 'CAN'>();
  for (const m of matches) {
    const v = venues[m.venueId];
    venueCountryByMatch.set(
      m.matchNumber,
      v.country === 'Mexico' ? 'MEX' : v.country === 'Canada' ? 'CAN' : 'USA',
    );
  }

  cached = { teams, schedule: matches, thirdPlaceTable, h2h, venueCountryByMatch };
  return cached;
}

export const teamPair = (a: string, b: string) => {
  const inputs = realTournamentInputs();
  return { home: inputs.teams.get(a)!, away: inputs.teams.get(b)!, h2h: inputs.h2h.get([a, b].sort().join('-')) ?? null };
};
