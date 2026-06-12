import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { FORMATION_IDS, FORMATIONS, type FormationId } from '@fifa/shared';
import { CurrentUser, Public, type AuthUser } from '../common/auth.guard';
import { FantasyService } from './fantasy.service';

class SlotAssignmentDto {
  @IsString() slotId!: string;
  @IsString() role!: string;
  @IsInt() playerId!: number;
}

class SaveLineupDto {
  @IsInt() @Min(1) @Max(104) matchNumber!: number;
  @IsIn(FORMATION_IDS) formation!: FormationId;
  @IsArray() @ArrayMinSize(11) @ArrayMaxSize(11) @ValidateNested({ each: true }) @Type(() => SlotAssignmentDto)
  startingXi!: SlotAssignmentDto[];
  @IsArray() @ArrayMaxSize(15) @IsInt({ each: true }) substitutes!: number[];
  @IsInt() captainId!: number;
  @IsInt() viceCaptainId!: number;
}

class SelectCountryDto {
  @IsString() @Length(3, 3) countryCode!: string;
  @IsOptional() @IsString() @MaxLength(100) teamName?: string;
}

class AnalyzeLineupDto {
  @IsIn(FORMATION_IDS) formation!: FormationId;
  @IsArray() @ArrayMinSize(11) @ArrayMaxSize(11) @ValidateNested({ each: true }) @Type(() => SlotAssignmentDto)
  startingXi!: SlotAssignmentDto[];
  @IsInt() captainId!: number;
}

@ApiTags('fantasy')
@ApiBearerAuth()
@Controller('fantasy')
export class FantasyController {
  constructor(private readonly service: FantasyService) {}

  @Public()
  @Get('formations')
  formations() {
    return Object.values(FORMATIONS);
  }

  @Get('my-team')
  myTeam(@CurrentUser() user: AuthUser) {
    return this.service.myTeam(user.id);
  }

  @Post('select-country')
  selectCountry(@CurrentUser() user: AuthUser, @Body() dto: SelectCountryDto) {
    return this.service.selectCountry(user.id, dto.countryCode, dto.teamName);
  }

  @Public()
  @Get('squads/:countryCode')
  squad(@Param('countryCode') countryCode: string) {
    return this.service.squadOf(countryCode);
  }

  @Get('fixtures')
  fixtures(@CurrentUser() user: AuthUser) {
    return this.service.myFixtures(user.id);
  }

  @Put('lineup')
  saveLineup(@CurrentUser() user: AuthUser, @Body() dto: SaveLineupDto) {
    return this.service.saveLineup(user.id, dto as never);
  }

  @Post('lineup/analyze')
  analyze(@CurrentUser() user: AuthUser, @Body() dto: AnalyzeLineupDto) {
    return this.service.lineupAnalysis(user.id, dto as never);
  }

  @Public()
  @Get('suggest/:countryCode')
  suggest(@Param('countryCode') countryCode: string, @Query('formation') formation?: string) {
    return this.service.suggestLineup(
      countryCode,
      formation && (FORMATION_IDS as readonly string[]).includes(formation) ? (formation as FormationId) : undefined,
    );
  }
}
