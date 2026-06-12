import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth.guard';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@Public()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  /** Tournament-wide aggregates from real ingested results + model calibration. */
  @Get('overview')
  overview() {
    return this.service.overview();
  }

  /** Single-team deep dive: results, Elo trajectory, contributors, squad, model identity. */
  @Get('team/:code')
  team(@Param('code') code: string) {
    return this.service.team(code);
  }
}
