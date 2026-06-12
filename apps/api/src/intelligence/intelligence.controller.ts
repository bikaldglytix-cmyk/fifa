import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth.guard';
import { IntelligenceService } from './intelligence.service';
import { ModelService } from '../model/model.service';
import { ResultIngestionService } from '../ingestion/result-ingestion.service';

/**
 * Match intelligence API: the full multi-factor panel, the prediction audit
 * trail, and model calibration transparency.
 */
@ApiTags('intelligence')
@Controller('intelligence')
export class IntelligenceController {
  constructor(
    private readonly intelligence: IntelligenceService,
    private readonly model: ModelService,
    private readonly ingestion: ResultIngestionService,
  ) {}

  /** Compact snapshot-backed summaries for in-play + upcoming matches. */
  @Public()
  @Get('board')
  board() {
    return this.intelligence.board();
  }

  /** Full intelligence panel: prediction v2 + tactics + fatigue + upset + explainability. */
  @Public()
  @Get('match/:matchNumber')
  panel(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    return this.intelligence.panel(matchNumber);
  }

  /** Audit trail of every prediction change for a match, with triggers. */
  @Public()
  @Get('match/:matchNumber/history')
  history(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    return this.intelligence.snapshotHistory(matchNumber);
  }

  /** Model transparency: version, calibration (Brier history) and data sources. */
  @Public()
  @Get('model')
  async model_() {
    const cal = await this.model.calibration();
    return { ...cal, resultSources: this.ingestion.listSources() };
  }
}
