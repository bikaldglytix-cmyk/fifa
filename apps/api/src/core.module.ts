import { Global, Module } from '@nestjs/common';
import { DbService } from './common/db.service';
import { EventBusService } from './common/event-bus.service';
import { SupabaseAuthService } from './common/supabase-auth.service';
import { EngineDataService } from './engine/engine-data.service';
import { AuthService } from './auth/auth.service';
import { TournamentService } from './tournament/tournament.service';
import { SimulationsService } from './simulations/simulations.service';
import { PredictionsService } from './predictions/predictions.service';
import { LeaderboardService } from './leaderboard/leaderboard.service';
import { FantasyService } from './fantasy/fantasy.service';
import { FraudService } from './security/fraud.service';
import { ResultsService } from './admin/results.service';
import { ResultIngestionService } from './ingestion/result-ingestion.service';
import { MatchLifecycleService } from './lifecycle/match-lifecycle.service';
import { ModelService } from './model/model.service';
import { IntelligenceService } from './intelligence/intelligence.service';
import { LiveGateway } from './live/live.gateway';
import { LiveStateStore } from './live/live-state.store';
import { LiveScoreService } from './live/live-score.service';
import { AnalyticsService } from './analytics/analytics.service';

/**
 * Global provider module: every domain service is a singleton shared by REST
 * controllers, the GraphQL resolvers and the WebSocket gateway. The
 * autonomous spine (event bus → lifecycle → ingestion → model) lives here.
 */
@Global()
@Module({
  providers: [
    DbService,
    EventBusService,
    SupabaseAuthService,
    EngineDataService,
    AuthService,
    TournamentService,
    SimulationsService,
    PredictionsService,
    LeaderboardService,
    FantasyService,
    FraudService,
    ResultsService,
    ResultIngestionService,
    MatchLifecycleService,
    IntelligenceService,
    ModelService,
    LiveGateway,
    LiveStateStore,
    LiveScoreService,
    AnalyticsService,
  ],
  exports: [
    DbService,
    EventBusService,
    SupabaseAuthService,
    EngineDataService,
    AuthService,
    TournamentService,
    SimulationsService,
    PredictionsService,
    LeaderboardService,
    FantasyService,
    FraudService,
    ResultsService,
    ResultIngestionService,
    MatchLifecycleService,
    IntelligenceService,
    ModelService,
    LiveGateway,
    LiveStateStore,
    LiveScoreService,
    AnalyticsService,
  ],
})
export class CoreModule {}
