import { Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import {
  countries,
  managers,
  matches,
  teamHeadToHead,
  teams,
  tournaments,
  venues,
} from '@fifa/db';
import { GROUPS, type GroupLetter } from '@fifa/shared';
import { computeStandings, mulberry32, rankThirdPlacedTeams, type GroupMatchRecord } from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LiveStateStore } from '../live/live-state.store';

@Injectable()
export class TournamentService {
  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly liveStore: LiveStateStore,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  async getTournament() {
    const [t] = await this.db.select().from(tournaments).where(eq(tournaments.year, 2026));
    if (!t) throw new NotFoundException('Tournament not seeded');
    const { thirdPlaceTable, ...format } = t.formatConfig as any;
    return { ...t, formatConfig: format };
  }

  async listCountries() {
    const [cs, ts, ms] = await Promise.all([
      this.db.select().from(countries),
      this.db.select().from(teams),
      this.db.select().from(managers),
    ]);
    const teamByCode = new Map(ts.map((t) => [t.countryCode, t]));
    const managerByCode = new Map(ms.map((m) => [m.countryCode, m]));
    return cs
      .map((c) => ({
        ...c,
        group: teamByCode.get(c.code)?.groupLetter ?? null,
        pot: teamByCode.get(c.code)?.groupPot ?? null,
        coach: managerByCode.get(c.code)?.name ?? null,
        preferredStyle: managerByCode.get(c.code)?.preferredStyle ?? null,
      }))
      .sort((a, b) => (a.fifaRanking ?? 999) - (b.fifaRanking ?? 999));
  }

  async getCountry(code: string) {
    const [c] = await this.db.select().from(countries).where(eq(countries.code, code.toUpperCase()));
    if (!c) throw new NotFoundException(`Unknown country ${code}`);
    const [t] = await this.db.select().from(teams).where(eq(teams.countryCode, c.code));
    const [m] = await this.db.select().from(managers).where(eq(managers.countryCode, c.code));
    return { ...c, team: t ?? null, manager: m ?? null };
  }

  async listVenues() {
    return this.db.select().from(venues);
  }

  async listMatches(filter: { stage?: string; group?: string; date?: string; team?: string }) {
    const rows = await this.db
      .select()
      .from(matches)
      .orderBy(asc(matches.matchNumber));
    const codeOf = (id: number | null) => (id ? this.engineData.codeOfTeamId(id) : null);
    return rows
      .map((m) => ({
        ...m,
        homeCode: codeOf(m.homeTeamId),
        awayCode: codeOf(m.awayTeamId),
        // real feed state for in-play / FT-pending-verification matches
        live: m.status === 'completed' ? null : this.liveStore.dto(m.matchNumber),
      }))
      .filter((m) => {
        if (filter.stage && m.stage !== filter.stage) return false;
        if (filter.group && m.groupLetter !== filter.group.toUpperCase()) return false;
        if (filter.date && m.localDate !== filter.date) return false;
        if (filter.team) {
          const t = filter.team.toUpperCase();
          if (m.homeCode !== t && m.awayCode !== t) return false;
        }
        return true;
      });
  }

  async getMatch(matchNumber: number) {
    const [m] = await this.db.select().from(matches).where(eq(matches.matchNumber, matchNumber));
    if (!m) throw new NotFoundException(`No match #${matchNumber}`);
    const [venue] = await this.db.select().from(venues).where(eq(venues.id, m.venueId));
    return {
      ...m,
      venue,
      homeCode: m.homeTeamId ? this.engineData.codeOfTeamId(m.homeTeamId) : null,
      awayCode: m.awayTeamId ? this.engineData.codeOfTeamId(m.awayTeamId) : null,
      live: m.status === 'completed' ? null : this.liveStore.dto(m.matchNumber),
    };
  }

  /**
   * Live group standings from COMPLETED real matches (admin-entered results).
   * Teams with no completed matches yet sort by draw position.
   */
  async groupStandings(): Promise<Record<string, any[]>> {
    const completed = await this.db
      .select()
      .from(matches)
      .where(and(eq(matches.stage, 'group'), eq(matches.status, 'completed')));

    const ts = await this.db.select().from(teams);
    const byGroup: Record<string, any[]> = {};
    const rng = mulberry32(20260611); // deterministic lots

    for (const g of GROUPS) {
      const groupTeams = ts.filter((t) => t.groupLetter === g).sort((a, b) => a.drawPosition - b.drawPosition);
      const codes = groupTeams.map((t) => t.countryCode);
      const records: GroupMatchRecord[] = completed
        .filter((m) => m.groupLetter === g && m.homeTeamId && m.awayTeamId)
        .map((m) => ({
          home: this.engineData.codeOfTeamId(m.homeTeamId!)!,
          away: this.engineData.codeOfTeamId(m.awayTeamId!)!,
          homeScore: m.homeScore ?? 0,
          awayScore: m.awayScore ?? 0,
          fairPlayHome: 0,
          fairPlayAway: 0,
        }));
      const standings = computeStandings(codes, records, rng);
      // pre-tournament: keep draw order for 0-played tables
      byGroup[g] = standings.every((s) => s.played === 0)
        ? codes.map((team, i) => ({ ...standings.find((s) => s.team === team)!, position: i + 1 }))
        : standings;
    }
    return byGroup;
  }

  async thirdPlaceRanking() {
    const standings = await this.groupStandings();
    const thirds = Object.values(standings)
      .map((rows) => rows[2])
      .filter((r) => r.played === 3);
    return rankThirdPlacedTeams(thirds, mulberry32(20260611));
  }

  /** Bracket state: knockout matches with resolved teams where known. */
  async bracket() {
    const rows = await this.listMatches({});
    return rows
      .filter((m) => m.stage !== 'group')
      .map((m) => ({
        matchNumber: m.matchNumber,
        stage: m.stage,
        matchDate: m.matchDate,
        venueId: m.venueId,
        home: m.homeCode ?? m.homeSlot,
        away: m.awayCode ?? m.awaySlot,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        homePenalties: m.homePenalties,
        awayPenalties: m.awayPenalties,
        status: m.status,
        winner: m.winnerTeamId ? this.engineData.codeOfTeamId(m.winnerTeamId) : null,
      }));
  }

  async headToHead(a: string, b: string) {
    const [c1, c2] = [a.toUpperCase(), b.toUpperCase()].sort();
    const [row] = await this.db
      .select()
      .from(teamHeadToHead)
      .where(and(eq(teamHeadToHead.country1, c1), eq(teamHeadToHead.country2, c2)));
    return row ?? { country1: c1, country2: c2, matchesPlayed: 0, country1Wins: 0, country2Wins: 0, draws: 0 };
  }
}
