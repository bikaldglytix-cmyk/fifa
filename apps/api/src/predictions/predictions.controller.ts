import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CurrentUser, Public, type AuthUser } from '../common/auth.guard';
import { PredictionsService } from './predictions.service';

class SubmitPredictionDto {
  @IsInt() @Min(1) @Max(104) matchNumber!: number;
  @IsInt() @Min(0) @Max(15) homeScore!: number;
  @IsInt() @Min(0) @Max(15) awayScore!: number;
  @IsOptional() @IsInt() firstGoalscorerId?: number | null;
  @IsOptional() @IsString() @Length(3, 3) cleanSheetTeam?: string | null;
  @IsOptional() @IsInt() @Min(0) submissionMs?: number;
}

@ApiTags('predictions')
@Controller('predictions')
export class PredictionsController {
  constructor(private readonly service: PredictionsService) {}

  @ApiBearerAuth()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  submit(@CurrentUser() user: AuthUser, @Body() dto: SubmitPredictionDto) {
    return this.service.submit(user.id, dto);
  }

  @ApiBearerAuth()
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.service.mine(user.id);
  }

  @Public()
  @Get('community/:matchNumber')
  community(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    return this.service.communityIntelligence(matchNumber);
  }
}
