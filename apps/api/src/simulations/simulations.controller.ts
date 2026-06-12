import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FORMATION_IDS, type FormationId } from '@fifa/shared';
import { CurrentUser, OptionalAuth, Public, type AuthUser } from '../common/auth.guard';
import { EngineDataService } from '../engine/engine-data.service';
import { IntelligenceService } from '../intelligence/intelligence.service';
import { SimulationsService } from './simulations.service';

class SlotDto {
  @IsString() slotId!: string;
  @IsString() role!: string;
  @IsInt() playerId!: number;
}

class LineupDto {
  @IsIn(FORMATION_IDS) formation!: FormationId;
  @IsArray() @ArrayMinSize(11) @ArrayMaxSize(11) @ValidateNested({ each: true }) @Type(() => SlotDto)
  startingXi!: SlotDto[];
}

class SimulateMatchDto {
  @IsOptional() @IsInt() @Min(1) @Max(104) matchNumber?: number;
  @IsOptional() @IsString() @Length(3, 3) homeCode?: string;
  @IsOptional() @IsString() @Length(3, 3) awayCode?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200_000) runs?: number;
  @IsOptional() @IsInt() seed?: number;
  @IsOptional() @IsBoolean() knockout?: boolean;
  @IsOptional() @ValidateNested() @Type(() => LineupDto) homeLineup?: LineupDto;
}

class TournamentJobDto {
  @IsOptional() @IsInt() @Min(10) @Max(1_000_000) runs?: number;
  @IsOptional() @IsInt() seed?: number;
  @IsOptional() @IsString() @Length(3, 3) pinnedTeam?: string;
  @IsOptional() @ValidateNested() @Type(() => LineupDto) pinnedLineup?: LineupDto;
}

@ApiTags('simulations')
@Controller('simulations')
export class SimulationsController {
  constructor(
    private readonly service: SimulationsService,
    private readonly engineData: EngineDataService,
    private readonly intelligence: IntelligenceService,
  ) {}

  /** Snapshot-backed v2 AI prediction (full intelligence, audited) — public. */
  @Public()
  @Get('predict/:matchNumber')
  async predict(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    const m = this.engineData.scheduledMatch(matchNumber);
    if (m.home.type !== 'team' || m.away.type !== 'team') {
      return { matchNumber, pending: true, reason: 'Participants not decided yet' };
    }
    const prediction = await this.intelligence.predictionFor(matchNumber);
    return { matchNumber, home: m.home.code, away: m.away.code, prediction };
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('match')
  simulateMatch(@CurrentUser() user: AuthUser | null, @Body() dto: SimulateMatchDto) {
    return this.service.simulateMatchEndpoint(user, {
      ...dto,
      homeLineup: dto.homeLineup as never,
    });
  }

  @OptionalAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('tournament')
  simulateTournament(@CurrentUser() user: AuthUser | null, @Body() dto: TournamentJobDto) {
    return this.service.startTournamentJob(user, {
      runs: dto.runs,
      seed: dto.seed,
      pinned:
        dto.pinnedTeam && dto.pinnedLineup
          ? { code: dto.pinnedTeam.toUpperCase(), formation: dto.pinnedLineup.formation, startingXi: dto.pinnedLineup.startingXi as never }
          : undefined,
    });
  }

  @Public()
  @Get('jobs/:jobId')
  jobStatus(@Param('jobId') jobId: string) {
    const job = this.service.getJob(jobId);
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      runs: job.runs,
      elapsedMs: Date.now() - job.startedAt,
      simulationId: job.simulationId ?? null,
      result: job.status === 'completed' ? job.result : null,
      error: job.error ?? null,
    };
  }

  /** Server-Sent Events progress stream (PRD §11.3). */
  @Public()
  @Get('jobs/:jobId/stream')
  stream(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = this.service.getJob(jobId);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (ev: { progress: number; status: string }) => {
      res.write(`data: ${JSON.stringify({ ...ev, jobId })}\n\n`);
      if (ev.status !== 'running') {
        job.listeners.delete(send);
        res.end();
      }
    };
    job.listeners.add(send);
    send({ progress: job.progress, status: job.status });

    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    res.on('close', () => {
      clearInterval(ping);
      job.listeners.delete(send);
    });
  }

  @Public()
  @Get('volume')
  async volume() {
    return { totalSimulations: await this.service.totalSimulationVolume() };
  }

  @ApiBearerAuth()
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query('limit') limit = '20') {
    return this.service.listMine(user.id, Number(limit));
  }

  @Public()
  @Get(':id')
  byId(@Param('id') id: string) {
    return this.service.getSimulation(id);
  }
}
