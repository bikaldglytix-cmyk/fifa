import { Body, Controller, Get, NotFoundException, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { notifications, userPreferences, users } from '@fifa/db';
import { CurrentUser, type AuthUser } from '../common/auth.guard';
import { DbService } from '../common/db.service';
import { AuthService } from '../auth/auth.service';
import { desc, and, isNull } from 'drizzle-orm';

class UpdatePreferencesDto {
  @IsOptional() @IsIn(['dark', 'light']) theme?: string;
  @IsOptional() @IsBoolean() notificationsEnabled?: boolean;
  @IsOptional() @IsBoolean() emailDigest?: boolean;
  @IsOptional() @IsInt() @Min(100) @Max(100_000) defaultSimulationCount?: number;
  @IsOptional() @IsString() @Length(3, 3) favoriteTeamCountry?: string;
  @IsOptional() @IsBoolean() sharePredictions?: boolean;
}

class UpdateMeDto {
  @IsOptional() @IsString() @Length(3, 3) countryCode?: string;
  @IsOptional() @IsString() @Length(2, 10) preferredLanguage?: string;
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly dbs: DbService,
    private readonly auth: AuthService,
  ) {}

  private get db() {
    return this.dbs.db;
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    if (!row) throw new NotFoundException();
    const [prefs] = await this.db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
    return { ...this.auth.toPublic(row), premiumUntil: row.premiumUntil, preferences: prefs ?? null };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    const [row] = await this.db
      .update(users)
      .set({ ...dto, countryCode: dto.countryCode?.toUpperCase(), updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return this.auth.toPublic(row);
  }

  @Patch('me/preferences')
  async updatePreferences(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    const [existing] = await this.db.select().from(userPreferences).where(eq(userPreferences.userId, user.id));
    if (existing) {
      const [row] = await this.db
        .update(userPreferences)
        .set({ ...dto, favoriteTeamCountry: dto.favoriteTeamCountry?.toUpperCase() })
        .where(eq(userPreferences.userId, user.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(userPreferences)
      .values({ userId: user.id, ...dto, favoriteTeamCountry: dto.favoriteTeamCountry?.toUpperCase() })
      .returning();
    return row;
  }

  @Get('me/notifications')
  async myNotifications(@CurrentUser() user: AuthUser) {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  @Patch('me/notifications/read-all')
  async markAllRead(@CurrentUser() user: AuthUser) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { ok: true };
  }
}
