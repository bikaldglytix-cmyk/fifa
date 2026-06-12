import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  countries,
  managers,
  matches as matchesTable,
  players,
  teamHeadToHead,
  teams,
  tournaments,
  venues,
} from '@fifa/db';
import {
  HOST_COUNTRIES,
  type FormationId,
  type LineupSlotAssignment,
  type MatchSlot,
  type ScheduledMatch,
} from '@fifa/shared';
import type { H2HRecord, SimTeam, SimPlayer } from '@fifa/sim-engine';
import { formScore } from '@fifa/sim-engine';
import type { TournamentInputs, ThirdPlaceTable } from '@fifa/sim-engine';
import { DbService } from '../common/db.service';

/**
 * Loads the (static) tournament dataset into memory once and assembles the
 * inputs the simulation engine consumes. Player/team mutations (injuries,
 * admin edits) call `refresh()` to rebuild.
 */
@Injectable()
export class EngineDataService implements OnModuleInit {
  private readonly logger = new Logger(EngineDataService.name);

  tournamentId!: number;
  private teamsByCode = new Map<string, SimTeam>();
  private h2h = new Map<string, H2HRecord>();
  private schedule: ScheduledMatch[] = [];
  private thirdPlaceTable: ThirdPlaceTable = {};
  private venueCountryByMatch = new Map<number, 'USA' | 'MEX' | 'CAN'>();
  private teamIdByCode = new Map<string, number>();
  private codeByTeamId = new Map<number, string>();
  playersById = new Map<number, SimPlayer & { countryCode: string }>();

  constructor(private readonly dbs: DbService) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    await this.dbs.ensureReady();
    const db = this.dbs.db;
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.year, 2026));
    if (!tournament) throw new Error('Tournament 2026 not seeded — run `npm run db:seed`');
    this.tournamentId = tournament.id;
    this.thirdPlaceTable = (tournament.formatConfig as any).thirdPlaceTable as ThirdPlaceTable;

    const [countryRows, teamRows, managerRows, playerRows, matchRows, venueRows, h2hRows] = await Promise.all([
      db.select().from(countries),
      db.select().from(teams).where(eq(teams.tournamentId, tournament.id)),
      db.select().from(managers),
      db.select().from(players),
      db.select().from(matchesTable).where(eq(matchesTable.tournamentId, tournament.id)),
      db.select().from(venues),
      db.select().from(teamHeadToHead),
    ]);

    const managerByCode = new Map(managerRows.map((m) => [m.countryCode, m]));
    const countryByCode = new Map(countryRows.map((c) => [c.code, c]));
    this.teamIdByCode = new Map(teamRows.map((t) => [t.countryCode, t.id]));
    this.codeByTeamId = new Map(teamRows.map((t) => [t.id, t.countryCode]));

    this.teamsByCode.clear();
    this.playersById.clear();

    for (const team of teamRows) {
      const c = countryByCode.get(team.countryCode)!;
      const m = managerByCode.get(team.countryCode)!;
      const squadRows = playerRows.filter((p) => p.countryCode === team.countryCode && p.isActive);
      const profile: any = c.profile ?? {};
      const results: string = (profile.recentForm ?? []).map((f: any) => f.result).join('');

      const squad: SimPlayer[] = squadRows.map((p) => {
        const sp: SimPlayer & { countryCode: string } = {
          id: p.id,
          name: p.name,
          position: p.position,
          rating: p.rating ?? 60,
          caps: p.caps,
          internationalGoals: p.internationalGoals,
          age: p.age ?? 26,
          club: p.club,
          clubCountry: p.clubCountry,
          captain: p.isCaptain,
          jerseyNumber: p.jerseyNumber ?? 0,
          fitness: p.fitnessPercentage,
          injured: p.injuryStatus === 'out',
          countryCode: p.countryCode,
        };
        this.playersById.set(p.id, sp);
        return sp;
      });

      this.teamsByCode.set(team.countryCode, {
        code: team.countryCode,
        name: c.name,
        elo: c.eloRating,
        fifaRanking: c.fifaRanking ?? 99,
        confederation: c.confederation,
        group: team.groupLetter as never,
        isHostNation: (HOST_COUNTRIES as readonly string[]).includes(team.countryCode),
        manager: {
          name: m.name,
          tacticalRating: m.tacticalRating ?? 60,
          adaptabilityRating: m.adaptabilityRating ?? 60,
          substitutionRating: m.substitutionRating ?? 60,
          pressureHandling: m.pressureHandling ?? 60,
          knockoutRating: m.knockoutRating ?? 60,
          preferredStyle: (m.preferredStyle ?? 'counter_attack') as never,
        },
        squad,
        form: { results, score: formScore(results) },
        shootouts: profile.shootouts ?? { taken: 0, won: 0 },
      });
    }

    this.h2h.clear();
    for (const r of h2hRows) {
      this.h2h.set(`${r.country1}-${r.country2}`, {
        played: r.matchesPlayed,
        wins1: r.country1Wins,
        wins2: r.country2Wins,
        draws: r.draws,
        goals1: r.country1Goals,
        goals2: r.country2Goals,
        wcMeetings: r.worldCupMeetings,
        lastMeeting: (r.lastMeeting as any) ?? null,
      });
    }

    const venueById = new Map(venueRows.map((v) => [v.id, v]));
    this.schedule = matchRows
      .sort((a, b) => a.matchNumber - b.matchNumber)
      .map((m) => ({
        matchNumber: m.matchNumber,
        stage: m.stage,
        group: (m.groupLetter as never) ?? null,
        matchday: m.matchday ?? undefined,
        kickoffUtc: m.matchDate.toISOString(),
        localDate: m.localDate,
        localTime: m.localTime,
        utcOffset: 0,
        venueId: m.venueId,
        home: (m.homeSlot as MatchSlot) ?? { type: 'team', code: this.codeByTeamId.get(m.homeTeamId!)! },
        away: (m.awaySlot as MatchSlot) ?? { type: 'team', code: this.codeByTeamId.get(m.awayTeamId!)! },
      }));
    this.venueCountryByMatch = new Map(
      matchRows.map((m) => {
        const v = venueById.get(m.venueId)!;
        return [m.matchNumber, v.country === 'Mexico' ? 'MEX' : v.country === 'Canada' ? 'CAN' : 'USA'];
      }),
    );

    this.logger.log(`engine data ready: ${this.teamsByCode.size} teams, ${this.playersById.size} players, ${this.schedule.length} matches`);
  }

  // --- accessors -------------------------------------------------------------

  team(code: string): SimTeam {
    const t = this.teamsByCode.get(code.toUpperCase());
    if (!t) throw new NotFoundException(`Unknown team ${code}`);
    return t;
  }

  /** Clone a team with a user lineup pinned (does not mutate the cache). */
  teamWithLineup(code: string, formation: FormationId, startingXi: LineupSlotAssignment[]): SimTeam {
    return { ...this.team(code), pinnedLineup: { formation, startingXi } };
  }

  allTeams(): SimTeam[] {
    return [...this.teamsByCode.values()];
  }

  h2hFor(a: string, b: string): H2HRecord | null {
    return this.h2h.get([a.toUpperCase(), b.toUpperCase()].sort().join('-')) ?? null;
  }

  scheduledMatch(matchNumber: number): ScheduledMatch {
    const m = this.schedule.find((x) => x.matchNumber === matchNumber);
    if (!m) throw new NotFoundException(`No match #${matchNumber}`);
    return m;
  }

  venueCountry(matchNumber: number): 'USA' | 'MEX' | 'CAN' {
    return this.venueCountryByMatch.get(matchNumber) ?? 'USA';
  }

  tournamentInputs(pinned?: { code: string; formation: FormationId; startingXi: LineupSlotAssignment[] }): TournamentInputs {
    const teamsMap = new Map(this.teamsByCode);
    if (pinned) {
      teamsMap.set(pinned.code, this.teamWithLineup(pinned.code, pinned.formation, pinned.startingXi));
    }
    return {
      teams: teamsMap,
      schedule: this.schedule,
      thirdPlaceTable: this.thirdPlaceTable,
      h2h: this.h2h,
      venueCountryByMatch: this.venueCountryByMatch,
    };
  }

  teamId(code: string): number {
    const id = this.teamIdByCode.get(code.toUpperCase());
    if (!id) throw new NotFoundException(`Unknown team ${code}`);
    return id;
  }

  codeOfTeamId(teamId: number): string | null {
    return this.codeByTeamId.get(teamId) ?? null;
  }
}
