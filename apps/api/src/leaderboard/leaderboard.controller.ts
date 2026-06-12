import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, type AuthUser } from '../common/auth.guard';
import { LeaderboardService } from './leaderboard.service';

@ApiTags('leaderboards')
@Controller('leaderboards')
export class LeaderboardController {
  constructor(private readonly service: LeaderboardService) {}

  @Public()
  @Get('global')
  global(@Query('limit') limit = '100', @Query('offset') offset = '0') {
    return this.service.top('global', 'global', Number(limit), Number(offset));
  }

  @Public()
  @Get('country/:code')
  country(@Param('code') code: string, @Query('limit') limit = '100') {
    return this.service.top('country', code.toUpperCase(), Number(limit));
  }

  @ApiBearerAuth()
  @Get('friends')
  friends(@CurrentUser() user: AuthUser) {
    return this.service.friends(user.id);
  }
}
