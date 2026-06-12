import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { players } from '@fifa/db';
import { analyzeMatchup } from '@fifa/sim-engine';
import { fantasyPrice } from '@fifa/shared';
import { Public } from '../common/auth.guard';
import { DbService } from '../common/db.service';
import { EngineDataService } from '../engine/engine-data.service';

@ApiTags('players')
@Public()
@Controller('players')
export class PlayersController {
  constructor(
    private readonly dbs: DbService,
    private readonly engineData: EngineDataService,
  ) {}

  @Get()
  async list(
    @Query('country') country?: string,
    @Query('position') position?: string,
    @Query('search') search?: string,
    @Query('sort') sort: 'rating' | 'caps' | 'goals' | 'age' = 'rating',
    @Query('limit') limit = '60',
    @Query('offset') offset = '0',
  ) {
    const conditions = [eq(players.isActive, true)];
    if (country) conditions.push(eq(players.countryCode, country.toUpperCase()));
    if (position && ['GK', 'DF', 'MF', 'FW'].includes(position.toUpperCase())) {
      conditions.push(eq(players.position, position.toUpperCase() as never));
    }
    if (search) conditions.push(ilike(players.name, `%${search}%`));

    const orderCol =
      sort === 'caps' ? players.caps : sort === 'goals' ? players.internationalGoals : sort === 'age' ? players.age : players.rating;

    const rows = await this.dbs.db
      .select()
      .from(players)
      .where(and(...conditions))
      .orderBy(sort === 'age' ? asc(orderCol) : desc(orderCol))
      .limit(Math.min(200, Number(limit)))
      .offset(Number(offset));

    const [{ count }] = await this.dbs.db
      .select({ count: sql<number>`count(*)::int` })
      .from(players)
      .where(and(...conditions));

    return {
      total: count,
      players: rows.map((p) => ({ ...p, fantasyPrice: fantasyPrice(p.rating ?? 60) })),
    };
  }

  @Get(':id')
  async byId(@Param('id', ParseIntPipe) id: number) {
    const [p] = await this.dbs.db.select().from(players).where(eq(players.id, id));
    if (!p) throw new NotFoundException(`No player ${id}`);
    const team = this.engineData.team(p.countryCode);
    return {
      ...p,
      fantasyPrice: fantasyPrice(p.rating ?? 60),
      country: { code: team.code, name: team.name, fifaRanking: team.fifaRanking, group: team.group },
      goalsPerCap: p.caps > 0 ? Number((p.internationalGoals / p.caps).toFixed(3)) : 0,
    };
  }

  @Get(':id/vs/:otherId')
  matchup(@Param('id', ParseIntPipe) id: number, @Param('otherId', ParseIntPipe) otherId: number) {
    const p1 = this.engineData.playersById.get(id);
    const p2 = this.engineData.playersById.get(otherId);
    if (!p1 || !p2) throw new NotFoundException('Unknown player');
    return analyzeMatchup(p1, p2);
  }
}
