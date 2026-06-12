import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core.module';
import { GraphqlApiModule } from './graphql/graphql.module';
import { AuthGuard } from './common/auth.guard';
import { AuditInterceptor } from './common/audit.interceptor';
import { HealthController } from './health.controller';
import { AuthController } from './auth/auth.controller';
import { UsersController } from './users/users.controller';
import { TournamentController } from './tournament/tournament.controller';
import { PlayersController } from './players/players.controller';
import { FantasyController } from './fantasy/fantasy.controller';
import { SimulationsController } from './simulations/simulations.controller';
import { PredictionsController } from './predictions/predictions.controller';
import { LeaderboardController } from './leaderboard/leaderboard.controller';
import { SocialController } from './social/social.controller';
import { AdminController } from './admin/admin.controller';
import { IntelligenceController } from './intelligence/intelligence.controller';
import { AnalyticsController } from './analytics/analytics.controller';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 200 }]),
    CoreModule,
    GraphqlApiModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    UsersController,
    TournamentController,
    PlayersController,
    FantasyController,
    SimulationsController,
    PredictionsController,
    LeaderboardController,
    SocialController,
    AdminController,
    IntelligenceController,
    AnalyticsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
