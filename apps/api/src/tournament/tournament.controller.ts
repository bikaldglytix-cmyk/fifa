import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth.guard';
import { TournamentService } from './tournament.service';
import { ModelService } from '../model/model.service';
import { LiveStateStore } from '../live/live-state.store';

@ApiTags('tournament')
@Public()
@Controller()
export class TournamentController {
  constructor(
    private readonly service: TournamentService,
    private readonly model: ModelService,
    private readonly liveStore: LiveStateStore,
  ) {}

  /** Elo + live tournament forecast + form blended into power rankings. */
  @Get('tournament/power-rankings')
  powerRankings() {
    return this.model.powerRankings();
  }

  /** Per-team qualification & progression probabilities (system Monte Carlo). */
  @Get('tournament/qualification')
  qualification() {
    return this.model.qualification();
  }

  @Get('tournament')
  tournament() {
    return this.service.getTournament();
  }

  @Get('countries')
  countries() {
    return this.service.listCountries();
  }

  @Get('countries/:code')
  country(@Param('code') code: string) {
    return this.service.getCountry(code);
  }

  @Get('venues')
  venues() {
    return this.service.listVenues();
  }

  @Get('matches')
  matches(
    @Query('stage') stage?: string,
    @Query('group') group?: string,
    @Query('date') date?: string,
    @Query('team') team?: string,
  ) {
    return this.service.listMatches({ stage, group, date, team });
  }

  /** Real live feed states for every in-play / verification-pending match.
   *  NOTE: declared before matches/:matchNumber so 'live' isn't parsed as a number. */
  @Get('matches/live')
  liveMatches() {
    return this.liveStore.dtos();
  }

  @Get('matches/:matchNumber')
  match(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    return this.service.getMatch(matchNumber);
  }

  /** Live feed state for one match (null when nothing is in play). */
  @Get('matches/:matchNumber/live')
  liveMatch(@Param('matchNumber', ParseIntPipe) matchNumber: number) {
    return { matchNumber, live: this.liveStore.dto(matchNumber) };
  }

  @Get('standings')
  standings() {
    return this.service.groupStandings();
  }

  @Get('standings/third-place')
  thirdPlace() {
    return this.service.thirdPlaceRanking();
  }

  @Get('bracket')
  bracket() {
    return this.service.bracket();
  }

  @Get('h2h/:a/:b')
  h2h(@Param('a') a: string, @Param('b') b: string) {
    return this.service.headToHead(a, b);
  }
}
