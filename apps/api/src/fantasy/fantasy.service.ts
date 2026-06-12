import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { matches, players, userLineups, userTeams } from '@fifa/db';
import {
  FORMATIONS,
  LINEUP_LOCK_MINUTES_BEFORE_KICKOFF,
  type FormationId,
  type LineupSlotAssignment,
} from '@fifa/shared';
import { computeChemistry, computeTacticalFit, autoSelectLineup } from '@fifa/sim-engine';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';

@Injectable()
export class FantasyService {
  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  async myTeam(userId: string) {
    const [team] = await this.db
      .select()
      .from(userTeams)
      .where(and(eq(userTeams.userId, userId), eq(userTeams.tournamentId, this.engineData.tournamentId)));
    if (!team) return null;
    const squad = await this.squadOf(team.countryCode);
    const lineups = await this.db.select().from(userLineups).where(eq(userLineups.userTeamId, team.id));
    const country = this.engineData.team(team.countryCode);
    return {
      ...team,
      country: { code: country.code, name: country.name, fifaRanking: country.fifaRanking, group: country.group, coach: country.manager.name },
      squad,
      lineups: lineups.map((l) => ({ ...l })),
    };
  }

  async selectCountry(userId: string, countryCode: string, teamName?: string) {
    const code = countryCode.toUpperCase();
    this.engineData.team(code); // validates
    const existing = await this.db
      .select()
      .from(userTeams)
      .where(and(eq(userTeams.userId, userId), eq(userTeams.tournamentId, this.engineData.tournamentId)));

    if (existing.length) {
      // switching country is allowed until that country's first match locks
      const firstMatch = await this.firstMatchOf(existing[0].countryCode);
      if (firstMatch && this.isLocked(firstMatch.matchDate)) {
        throw new ConflictException('Your tournament has started — country switch is locked');
      }
      const [updated] = await this.db
        .update(userTeams)
        .set({ countryCode: code, teamName: teamName ?? existing[0].teamName, updatedAt: new Date() })
        .where(eq(userTeams.id, existing[0].id))
        .returning();
      await this.db.delete(userLineups).where(eq(userLineups.userTeamId, existing[0].id));
      return updated;
    }

    const [created] = await this.db
      .insert(userTeams)
      .values({
        userId,
        tournamentId: this.engineData.tournamentId,
        countryCode: code,
        teamName: teamName ?? null,
      })
      .returning();
    void this.leaderboard.recomputeUser(userId).catch(() => undefined);
    return created;
  }

  async squadOf(countryCode: string) {
    return this.db
      .select()
      .from(players)
      .where(and(eq(players.countryCode, countryCode.toUpperCase()), eq(players.isActive, true)))
      .orderBy(asc(players.jerseyNumber));
  }

  /** Upcoming matches of the user's country with lineup/lock state. */
  async myFixtures(userId: string) {
    const team = await this.requireTeam(userId);
    const teamId = this.engineData.teamId(team.countryCode);
    const rows = await this.db
      .select()
      .from(matches)
      .orderBy(asc(matches.matchNumber));
    const mine = rows.filter((m) => m.homeTeamId === teamId || m.awayTeamId === teamId);
    const lineups = await this.db.select().from(userLineups).where(eq(userLineups.userTeamId, team.id));
    return mine.map((m) => {
      const lineup = lineups.find((l) => l.matchId === m.id) ?? null;
      return {
        matchId: m.id,
        matchNumber: m.matchNumber,
        stage: m.stage,
        kickoffUtc: m.matchDate,
        status: m.status,
        isHome: m.homeTeamId === teamId,
        opponent:
          (m.homeTeamId === teamId ? m.awayTeamId && this.engineData.codeOfTeamId(m.awayTeamId) : m.homeTeamId && this.engineData.codeOfTeamId(m.homeTeamId)) ??
          null,
        locked: this.isLocked(m.matchDate),
        lockAt: new Date(m.matchDate.getTime() - LINEUP_LOCK_MINUTES_BEFORE_KICKOFF * 60_000),
        lineup,
      };
    });
  }

  async saveLineup(
    userId: string,
    dto: {
      matchNumber: number;
      formation: FormationId;
      startingXi: LineupSlotAssignment[];
      substitutes: number[];
      captainId: number;
      viceCaptainId: number;
    },
  ) {
    const team = await this.requireTeam(userId);
    const [match] = await this.db.select().from(matches).where(eq(matches.matchNumber, dto.matchNumber));
    if (!match) throw new NotFoundException(`No match #${dto.matchNumber}`);

    const teamId = this.engineData.teamId(team.countryCode);
    if (match.homeTeamId !== teamId && match.awayTeamId !== teamId) {
      throw new BadRequestException(`Match ${dto.matchNumber} does not involve ${team.countryCode}`);
    }
    if (this.isLocked(match.matchDate)) {
      throw new ConflictException(`Lineups locked ${LINEUP_LOCK_MINUTES_BEFORE_KICKOFF} minutes before kickoff`);
    }

    // --- validation ---------------------------------------------------------
    const formation = FORMATIONS[dto.formation];
    if (!formation) throw new BadRequestException('Unknown formation');
    const squad = await this.squadOf(team.countryCode);
    const squadIds = new Set(squad.map((p) => p.id));
    const xiIds = dto.startingXi.map((s) => s.playerId);

    if (dto.startingXi.length !== 11) throw new BadRequestException('Starting XI must have 11 players');
    if (new Set(xiIds).size !== 11) throw new BadRequestException('Duplicate player in starting XI');
    for (const id of [...xiIds, ...dto.substitutes]) {
      if (!squadIds.has(id)) throw new BadRequestException(`Player ${id} is not in the ${team.countryCode} squad`);
    }
    const slotIds = new Set(formation.slots.map((s) => s.id));
    for (const a of dto.startingXi) {
      if (!slotIds.has(a.slotId)) throw new BadRequestException(`Slot ${a.slotId} not in ${dto.formation}`);
    }
    if (new Set(dto.startingXi.map((a) => a.slotId)).size !== 11) {
      throw new BadRequestException('Each formation slot must be filled exactly once');
    }
    const gkSlot = dto.startingXi.find((a) => a.slotId === 'GK')!;
    const gk = squad.find((p) => p.id === gkSlot.playerId)!;
    if (gk.position !== 'GK') throw new BadRequestException('GK slot must contain a goalkeeper');
    if (!xiIds.includes(dto.captainId)) throw new BadRequestException('Captain must be in the starting XI');
    if (!xiIds.includes(dto.viceCaptainId) || dto.viceCaptainId === dto.captainId) {
      throw new BadRequestException('Vice-captain must be a different starter');
    }
    if (dto.substitutes.some((id) => xiIds.includes(id))) {
      throw new BadRequestException('Substitutes cannot also start');
    }

    // --- chemistry & tactical fit -------------------------------------------
    const engineTeam = this.engineData.team(team.countryCode);
    const byId = new Map(engineTeam.squad.map((p) => [p.id, p]));
    const starters = xiIds.map((id) => byId.get(id)!).filter(Boolean);
    const chemistry = computeChemistry(starters, dto.captainId);
    const fit = computeTacticalFit(dto.formation, dto.startingXi, byId, engineTeam.manager.preferredStyle);

    const values = {
      formation: dto.formation,
      startingXi: dto.startingXi as never,
      substitutes: dto.substitutes as never,
      captainPlayerId: dto.captainId,
      viceCaptainPlayerId: dto.viceCaptainId,
      teamChemistry: chemistry.total,
      tacticalFit: fit.total,
      updatedAt: new Date(),
    };

    const [existing] = await this.db
      .select()
      .from(userLineups)
      .where(and(eq(userLineups.userTeamId, team.id), eq(userLineups.matchId, match.id)));

    const [saved] = existing
      ? await this.db.update(userLineups).set(values).where(eq(userLineups.id, existing.id)).returning()
      : await this.db
          .insert(userLineups)
          .values({ userTeamId: team.id, matchId: match.id, ...values })
          .returning();

    await this.db
      .update(userTeams)
      .set({ formation: dto.formation, updatedAt: new Date() })
      .where(eq(userTeams.id, team.id));

    return { ...saved, chemistry, tacticalFit: fit };
  }

  /** Engine's suggested best XI for the user's country (or any country). */
  async suggestLineup(countryCode: string, formation?: FormationId) {
    const team = this.engineData.team(countryCode);
    const f = formation ?? undefined;
    const lineup = f
      ? autoSelectLineup(team, f)
      : autoSelectLineup(team, '4-3-3');
    return {
      formation: lineup.formation.id,
      startingXi: lineup.assignments.map((a) => ({ slotId: a.slot.id, role: a.slot.role, playerId: a.player.id })),
      players: lineup.assignments.map((a) => ({
        slotId: a.slot.id,
        role: a.slot.role,
        playerId: a.player.id,
        name: a.player.name,
        rating: a.player.rating,
        position: a.player.position,
      })),
      strength: lineup.strength,
      suggestedCaptain: lineup.captain.id,
    };
  }

  async lineupAnalysis(userId: string, dto: { formation: FormationId; startingXi: LineupSlotAssignment[]; captainId: number }) {
    const team = await this.requireTeam(userId);
    const engineTeam = this.engineData.team(team.countryCode);
    const byId = new Map(engineTeam.squad.map((p) => [p.id, p]));
    const starters = dto.startingXi.map((s) => byId.get(s.playerId)!).filter(Boolean);
    if (starters.length !== 11) throw new BadRequestException('Provide 11 valid players');
    return {
      chemistry: computeChemistry(starters, dto.captainId),
      tacticalFit: computeTacticalFit(dto.formation, dto.startingXi, byId, engineTeam.manager.preferredStyle),
    };
  }

  private isLocked(kickoff: Date): boolean {
    return Date.now() >= kickoff.getTime() - LINEUP_LOCK_MINUTES_BEFORE_KICKOFF * 60_000;
  }

  private async firstMatchOf(countryCode: string) {
    const teamId = this.engineData.teamId(countryCode);
    const rows = await this.db.select().from(matches).orderBy(asc(matches.matchDate));
    return rows.find((m) => m.homeTeamId === teamId || m.awayTeamId === teamId) ?? null;
  }

  async requireTeam(userId: string) {
    const [team] = await this.db
      .select()
      .from(userTeams)
      .where(and(eq(userTeams.userId, userId), eq(userTeams.tournamentId, this.engineData.tournamentId)));
    if (!team) throw new NotFoundException('Select a country first (POST /api/v1/fantasy/select-country)');
    return team;
  }
}
