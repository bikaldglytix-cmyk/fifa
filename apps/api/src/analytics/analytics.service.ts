import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { countries, managers, matches, modelState, players, playerStatistics, teams, teamStatistics } from '@fifa/db';
import { tacticalAxes } from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { ModelService } from '../model/model.service';

interface EloEvent {
  matchNumber: number;
  home: string;
  away: string;
  deltaHome: number;
  deltaAway: number;
}

/**
 * Read-only aggregation layer for the Analytics page. Everything here is
 * derived from REAL ingested results (matches, team/player statistics, the
 * Elo delta ledger) plus the model's own calibration history — measured vs
 * model-derived fields are kept apart so the UI can label them honestly.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly model: ModelService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  private async calibrationState(): Promise<{ eloDeltas: Record<string, EloEvent>; history: any[]; brierMean: number | null }> {
    const [row] = await this.db.select().from(modelState).where(eq(modelState.id, 1));
    const cal = (row?.calibration as any) ?? {};
    return { eloDeltas: cal.eloDeltas ?? {}, history: cal.history ?? [], brierMean: cal.brierMean ?? null };
  }

  async overview() {
    const [allMatches, allCountries, allTeams, statRows, scorerRows, cal] = await Promise.all([
      this.db.select().from(matches).orderBy(asc(matches.matchNumber)),
      this.db.select().from(countries),
      this.db.select().from(teams),
      this.db.select().from(teamStatistics),
      this.db
        .select({ s: playerStatistics, name: players.name, code: players.countryCode })
        .from(playerStatistics)
        .innerJoin(players, eq(players.id, playerStatistics.playerId)),
      this.calibrationState(),
    ]);

    const codeOf = (id: number | null) => (id ? this.engineData.codeOfTeamId(id) : null);
    const completed = allMatches.filter((m) => m.status === 'completed' && m.homeScore != null && m.awayScore != null);

    // --- tournament totals ---------------------------------------------------
    let goals = 0;
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let attendanceTotal = 0;
    let attendanceCount = 0;
    for (const m of completed) {
      goals += m.homeScore! + m.awayScore!;
      if (m.homeScore! > m.awayScore!) homeWins++;
      else if (m.homeScore! < m.awayScore!) awayWins++;
      else draws++;
      if (m.attendance) {
        attendanceTotal += m.attendance;
        attendanceCount++;
      }
    }

    // --- goals per matchday ----------------------------------------------------
    const byDate = new Map<string, { goals: number; matches: number }>();
    for (const m of completed) {
      const d = m.localDate;
      const rec = byDate.get(d) ?? { goals: 0, matches: 0 };
      rec.goals += m.homeScore! + m.awayScore!;
      rec.matches++;
      byDate.set(d, rec);
    }
    const goalsByDate = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, r]) => ({ date, ...r }));

    // --- per-stage -------------------------------------------------------------
    const stageOrder = ['group', 'round32', 'round16', 'quarterfinal', 'semifinal', 'third_place', 'final'];
    const stages = stageOrder
      .map((stage) => {
        const ms = completed.filter((m) => m.stage === stage);
        const g = ms.reduce((a, m) => a + m.homeScore! + m.awayScore!, 0);
        return { stage, played: ms.length, goals: g, avgGoals: ms.length ? Number((g / ms.length).toFixed(2)) : 0 };
      })
      .filter((s) => s.played > 0);

    // --- scoreline distribution --------------------------------------------------
    const scoreCount = new Map<string, number>();
    for (const m of completed) {
      const [hi, lo] = m.homeScore! >= m.awayScore! ? [m.homeScore!, m.awayScore!] : [m.awayScore!, m.homeScore!];
      const key = `${hi}-${lo}`;
      scoreCount.set(key, (scoreCount.get(key) ?? 0) + 1);
    }
    const scorelines = [...scoreCount.entries()]
      .map(([score, count]) => ({ score, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // --- per-team aggregates -----------------------------------------------------
    const groupOf = new Map(allTeams.map((t) => [t.countryCode, t.groupLetter]));
    const statByTeamMatch = new Map(statRows.map((s) => [`${s.teamId}:${s.matchId}`, s]));
    const teamAgg = new Map<
      string,
      {
        played: number; w: number; d: number; l: number; gf: number; ga: number; cleanSheets: number;
        possessionSum: number; possessionN: number; xgSum: number; xgN: number;
      }
    >();
    const touch = (code: string) => {
      if (!teamAgg.has(code)) {
        teamAgg.set(code, { played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, cleanSheets: 0, possessionSum: 0, possessionN: 0, xgSum: 0, xgN: 0 });
      }
      return teamAgg.get(code)!;
    };
    for (const m of completed) {
      const sides = [
        { code: codeOf(m.homeTeamId), teamId: m.homeTeamId, gf: m.homeScore!, ga: m.awayScore! },
        { code: codeOf(m.awayTeamId), teamId: m.awayTeamId, gf: m.awayScore!, ga: m.homeScore! },
      ];
      for (const side of sides) {
        if (!side.code) continue;
        const rec = touch(side.code);
        rec.played++;
        rec.gf += side.gf;
        rec.ga += side.ga;
        if (side.gf > side.ga) rec.w++;
        else if (side.gf === side.ga) rec.d++;
        else rec.l++;
        if (side.ga === 0) rec.cleanSheets++;
        const stat = statByTeamMatch.get(`${side.teamId}:${m.id}`);
        if (stat?.possession != null) {
          rec.possessionSum += Number(stat.possession);
          rec.possessionN++;
        }
        if (stat?.xg != null) {
          rec.xgSum += Number(stat.xg);
          rec.xgN++;
        }
      }
    }

    // --- discipline (from real per-player stat lines) ------------------------------
    const cardsByTeam = new Map<string, { yellows: number; reds: number }>();
    for (const row of scorerRows) {
      const rec = cardsByTeam.get(row.code) ?? { yellows: 0, reds: 0 };
      rec.yellows += row.s.yellowCards;
      rec.reds += row.s.redCards;
      cardsByTeam.set(row.code, rec);
    }

    // --- Elo: current + net tournament change from the delta ledger -----------------
    const eloEvents: EloEvent[] = Object.values(cal.eloDeltas).sort((a, b) => a.matchNumber - b.matchNumber);
    const eloChange = new Map<string, number>();
    for (const ev of eloEvents) {
      eloChange.set(ev.home, (eloChange.get(ev.home) ?? 0) + ev.deltaHome);
      eloChange.set(ev.away, (eloChange.get(ev.away) ?? 0) + ev.deltaAway);
    }

    const teamRows = allCountries
      .map((c) => {
        const a = teamAgg.get(c.code);
        const cards = cardsByTeam.get(c.code);
        return {
          code: c.code,
          name: c.name,
          group: groupOf.get(c.code) ?? null,
          played: a?.played ?? 0,
          w: a?.w ?? 0,
          d: a?.d ?? 0,
          l: a?.l ?? 0,
          gf: a?.gf ?? 0,
          ga: a?.ga ?? 0,
          gd: (a?.gf ?? 0) - (a?.ga ?? 0),
          cleanSheets: a?.cleanSheets ?? 0,
          yellows: cards?.yellows ?? 0,
          reds: cards?.reds ?? 0,
          elo: c.eloRating,
          eloChange: eloChange.get(c.code) ?? 0,
          possessionAvg: a && a.possessionN > 0 ? Number((a.possessionSum / a.possessionN).toFixed(1)) : null,
          xgFor: a && a.xgN > 0 ? Number(a.xgSum.toFixed(2)) : null,
        };
      })
      .sort((a, b) => b.gd - a.gd || b.gf - a.gf);

    // --- top scorers (real ingested stat lines only) ---------------------------------
    const byPlayer = new Map<number, { playerId: number; name: string; code: string; goals: number; assists: number }>();
    for (const row of scorerRows) {
      const rec = byPlayer.get(row.s.playerId) ?? { playerId: row.s.playerId, name: row.name, code: row.code, goals: 0, assists: 0 };
      rec.goals += row.s.goals;
      rec.assists += row.s.assists;
      byPlayer.set(row.s.playerId, rec);
    }
    const topScorers = [...byPlayer.values()]
      .filter((p) => p.goals > 0 || p.assists > 0)
      .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
      .slice(0, 12);

    return {
      updatedAt: new Date().toISOString(),
      totals: {
        completed: completed.length,
        total: allMatches.length,
        goals,
        avgGoals: completed.length ? Number((goals / completed.length).toFixed(2)) : 0,
        homeWins,
        awayWins,
        draws,
        attendanceTotal,
        attendanceAvg: attendanceCount ? Math.round(attendanceTotal / attendanceCount) : null,
      },
      goalsByDate,
      stages,
      scorelines,
      teams: teamRows,
      topScorers,
      eloEvents,
      calibration: { brierMean: cal.brierMean, scored: cal.history.length, history: cal.history },
    };
  }

  async team(code: string) {
    const upper = code.toUpperCase();
    const [c] = await this.db.select().from(countries).where(eq(countries.code, upper));
    if (!c) throw new NotFoundException(`Unknown country ${code}`);

    const [[teamRow], [managerRow], allMatches, cal, qual] = await Promise.all([
      this.db.select().from(teams).where(eq(teams.countryCode, upper)),
      this.db.select().from(managers).where(eq(managers.countryCode, upper)),
      this.db.select().from(matches).orderBy(asc(matches.matchNumber)),
      this.calibrationState(),
      this.model.qualification(),
    ]);
    if (!teamRow) throw new NotFoundException(`${upper} is not in the tournament`);

    const statRows = await this.db.select().from(teamStatistics).where(eq(teamStatistics.teamId, teamRow.id));
    const statByMatch = new Map(statRows.map((s) => [s.matchId, s]));
    const codeOf = (id: number | null) => (id ? this.engineData.codeOfTeamId(id) : null);
    const nameOf = (cc: string | null) => (cc ? this.engineData.team(cc).name : null);

    const teamMatches = allMatches
      .filter((m) => m.homeTeamId === teamRow.id || m.awayTeamId === teamRow.id)
      .map((m) => {
        const home = m.homeTeamId === teamRow.id;
        const oppCode = codeOf(home ? m.awayTeamId : m.homeTeamId);
        const gf = home ? m.homeScore : m.awayScore;
        const ga = home ? m.awayScore : m.homeScore;
        const stat = statByMatch.get(m.id);
        return {
          matchNumber: m.matchNumber,
          stage: m.stage,
          date: m.localDate,
          home,
          opponent: oppCode,
          opponentName: nameOf(oppCode),
          status: m.status,
          gf,
          ga,
          result: m.status === 'completed' && gf != null && ga != null ? (gf > ga ? 'W' : gf === ga ? 'D' : 'L') : null,
          possession: stat?.possession != null ? Number(stat.possession) : null,
          shots: stat?.shots ?? null,
          shotsOnTarget: stat?.shotsOnTarget ?? null,
          xg: stat?.xg != null ? Number(stat.xg) : null,
        };
      });

    // Elo series reconstructed backwards from the current rating + delta ledger
    const events = Object.values(cal.eloDeltas)
      .filter((ev) => ev.home === upper || ev.away === upper)
      .sort((a, b) => a.matchNumber - b.matchNumber);
    const netChange = events.reduce((a, ev) => a + (ev.home === upper ? ev.deltaHome : ev.deltaAway), 0);
    let running = c.eloRating - netChange;
    const eloSeries = [{ label: 'start', elo: running }];
    for (const ev of events) {
      running += ev.home === upper ? ev.deltaHome : ev.deltaAway;
      eloSeries.push({ label: `M${ev.matchNumber}`, elo: running });
    }

    // real per-player tournament output for this squad
    const scorerRows = await this.db
      .select({ s: playerStatistics, name: players.name, code: players.countryCode })
      .from(playerStatistics)
      .innerJoin(players, eq(players.id, playerStatistics.playerId))
      .where(eq(players.countryCode, upper));
    const byPlayer = new Map<number, { playerId: number; name: string; goals: number; assists: number; yellows: number; reds: number }>();
    for (const row of scorerRows) {
      const rec = byPlayer.get(row.s.playerId) ?? { playerId: row.s.playerId, name: row.name, goals: 0, assists: 0, yellows: 0, reds: 0 };
      rec.goals += row.s.goals;
      rec.assists += row.s.assists;
      rec.yellows += row.s.yellowCards;
      rec.reds += row.s.redCards;
      byPlayer.set(row.s.playerId, rec);
    }
    const contributors = [...byPlayer.values()].sort((a, b) => b.goals - a.goals || b.assists - a.assists);

    const squadRows = await this.db.select().from(players).where(eq(players.countryCode, upper));
    const squad = squadRows
      .filter((p) => p.isActive)
      .map((p) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        age: p.age,
        rating: p.rating,
        caps: p.caps,
        club: p.club,
        jerseyNumber: p.jerseyNumber,
        injuryStatus: p.injuryStatus,
      }));

    const style = managerRow?.preferredStyle ?? 'possession';
    return {
      country: {
        code: c.code,
        name: c.name,
        group: teamRow.groupLetter,
        fifaRanking: c.fifaRanking,
        elo: c.eloRating,
        eloChange: netChange,
        worldCupAppearances: c.worldCupAppearances,
        coach: managerRow?.name ?? null,
        style,
      },
      /** model-derived tactical identity (style + default shape), not measured data */
      axes: tacticalAxes(style as never, '4-3-3'),
      matches: teamMatches,
      eloSeries,
      contributors,
      squad,
      qualification: qual.teams.find((t) => t.team === upper) ?? null,
      qualificationComputedAt: qual.computedAt,
    };
  }
}
