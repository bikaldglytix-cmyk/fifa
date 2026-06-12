import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { verify } from 'jsonwebtoken';
import { GraphQLError, GraphQLScalarType, Kind, type ValueNode } from 'graphql';

/** Permissive JSON scalar (inline — no extra dependency). */
const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: function parse(ast: ValueNode): unknown {
    switch (ast.kind) {
      case Kind.STRING:
        return ast.value;
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
        return Number(ast.value);
      case Kind.FLOAT:
        return Number(ast.value);
      case Kind.NULL:
        return null;
      case Kind.LIST:
        return ast.values.map((v) => parse(v));
      case Kind.OBJECT: {
        const o: Record<string, unknown> = {};
        for (const f of ast.fields) o[f.name.value] = parse(f.value);
        return o;
      }
      default:
        return null;
    }
  },
});
import { loadOrCreateKeys } from '../common/keys';
import { CoreModule } from '../core.module';
import { TournamentService } from '../tournament/tournament.service';
import { SimulationsService } from '../simulations/simulations.service';
import { PredictionsService } from '../predictions/predictions.service';
import { LeaderboardService } from '../leaderboard/leaderboard.service';
import { FantasyService } from '../fantasy/fantasy.service';
import { AuthService } from '../auth/auth.service';
import { EngineDataService } from '../engine/engine-data.service';
import { predictMatch } from '@fifa/sim-engine';
import type { AuthUser } from '../common/auth.guard';

/**
 * GraphQL API (PRD §8.1). Schema-first with a resolvers map delegating to the
 * same domain services as REST. Realtime subscriptions are delivered over the
 * socket.io gateway (see shared WS_EVENTS protocol) rather than graphql-ws.
 */
const typeDefs = /* GraphQL */ `
  scalar JSON

  type Query {
    me: User
    tournament: Tournament!
    countries: [Country!]!
    country(code: String!): Country
    matches(stage: String, group: String, team: String): [Match!]!
    match(matchNumber: Int!): Match
    standings: JSON!
    bracket: JSON!
    players(countryCode: String, position: String, search: String, limit: Int): JSON!
    player(id: Int!): JSON
    aiPrediction(matchNumber: Int!): JSON!
    communityIntelligence(matchNumber: Int!): JSON!
    leaderboard(type: String = "global", scope: String = "global", limit: Int = 100): [LeaderboardEntry!]!
    myTeam: JSON
    mySimulations(limit: Int = 20): JSON!
  }

  type Mutation {
    register(email: String!, username: String!, password: String!, countryCode: String): AuthPayload!
    login(email: String!, password: String!): LoginResult!
    refreshToken(refreshToken: String!): Tokens!
    selectCountry(countryCode: String!, teamName: String): JSON!
    updateLineup(input: LineupInput!): JSON!
    createPrediction(input: PredictionInput!): JSON!
    simulateMatch(input: SimulateMatchInput!): JSON!
    runMonteCarlo(runs: Int = 1000, pinnedTeam: String): MonteCarloJob!
  }

  type User {
    id: ID!
    username: String!
    email: String!
    role: String!
    countryCode: String
    mfaEnabled: Boolean!
    createdAt: String!
  }

  type Tokens {
    accessToken: String!
    refreshToken: String!
    expiresIn: Int!
  }

  type AuthPayload {
    user: User!
    tokens: Tokens!
  }

  type LoginResult {
    user: User
    tokens: Tokens
    requiresMfa: Boolean
    mfaToken: String
  }

  type Tournament {
    id: Int!
    year: Int!
    name: String!
    hostCountry: String!
    startDate: String!
    endDate: String!
    status: String!
  }

  type Country {
    code: String!
    name: String!
    confederation: String!
    fifaRanking: Int
    eloRating: Int!
    flagUrl: String
    group: String
    pot: Int
    coach: String
    worldCupAppearances: Int
  }

  type Match {
    id: Int!
    matchNumber: Int!
    stage: String!
    groupLetter: String
    matchday: Int
    homeCode: String
    awayCode: String
    homeScore: Int
    awayScore: Int
    status: String!
    matchDate: String!
    localDate: String!
    localTime: String!
    venueId: String!
    """Real live feed state (minute, score, goal events) while in play."""
    liveStats: JSON
  }

  type LeaderboardEntry {
    rank: Int!
    userId: ID!
    username: String!
    countryCode: String
    totalPoints: Int!
    predictionAccuracy: Float!
    exactScoreAccuracy: Float!
    simulationsRun: Int!
    reputationScore: Float!
  }

  type MonteCarloJob {
    jobId: ID!
    runs: Int!
  }

  input LineupInput {
    matchNumber: Int!
    formation: String!
    startingXi: JSON!
    substitutes: [Int!]!
    captainId: Int!
    viceCaptainId: Int!
  }

  input PredictionInput {
    matchNumber: Int!
    homeScore: Int!
    awayScore: Int!
    firstGoalscorerId: Int
    cleanSheetTeam: String
  }

  input SimulateMatchInput {
    matchNumber: Int
    homeCode: String
    awayCode: String
    runs: Int
  }
`;

interface GqlContext {
  user: AuthUser | null;
}

const requireUser = (ctx: GqlContext): AuthUser => {
  if (!ctx.user) throw new GraphQLError('Unauthenticated', { extensions: { code: 'UNAUTHENTICATED' } });
  return ctx.user;
};

@Module({
  imports: [
    NestGraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      imports: [CoreModule],
      inject: [
        TournamentService,
        SimulationsService,
        PredictionsService,
        LeaderboardService,
        FantasyService,
        AuthService,
        EngineDataService,
      ],
      useFactory: (
        tournament: TournamentService,
        simulations: SimulationsService,
        predictions: PredictionsService,
        leaderboard: LeaderboardService,
        fantasy: FantasyService,
        auth: AuthService,
        engineData: EngineDataService,
      ): ApolloDriverConfig => {
        const publicKey = loadOrCreateKeys().publicKey;
        return {
          typeDefs,
          path: '/graphql',
          context: ({ req }: { req: any }): GqlContext => {
            const header: string | undefined = req?.headers?.authorization;
            const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
            if (!token) return { user: null };
            try {
              const p = verify(token, publicKey, { algorithms: ['RS256'] }) as any;
              return { user: { id: p.sub, email: p.email, role: p.role, username: p.username } };
            } catch {
              return { user: null };
            }
          },
          resolvers: {
            JSON: JSONScalar,
            Match: {
              // tournament rows embed the feed state as `live`; PRD names it liveStats
              liveStats: (m: { live?: unknown }) => m.live ?? null,
            },
            Query: {
              me: async (_: unknown, __: unknown, ctx: GqlContext) => (ctx.user ? { ...ctx.user, mfaEnabled: false, createdAt: '' } : null),
              tournament: () => tournament.getTournament(),
              countries: () => tournament.listCountries(),
              country: (_: unknown, a: { code: string }) => tournament.getCountry(a.code),
              matches: (_: unknown, a: { stage?: string; group?: string; team?: string }) => tournament.listMatches(a),
              match: (_: unknown, a: { matchNumber: number }) => tournament.getMatch(a.matchNumber),
              standings: () => tournament.groupStandings(),
              bracket: () => tournament.bracket(),
              players: async (_: unknown, a: { countryCode?: string; search?: string }) => {
                // served from the engine cache (REST has the fully filterable endpoint)
                const all = [...engineData.playersById.values()];
                let filtered = all;
                if (a.countryCode) filtered = filtered.filter((p) => p.countryCode === a.countryCode!.toUpperCase());
                if (a.search) filtered = filtered.filter((p) => p.name.toLowerCase().includes(a.search!.toLowerCase()));
                return filtered.slice(0, 100);
              },
              player: (_: unknown, a: { id: number }) => engineData.playersById.get(a.id) ?? null,
              aiPrediction: (_: unknown, a: { matchNumber: number }) => {
                const m = engineData.scheduledMatch(a.matchNumber);
                if (m.home.type !== 'team' || m.away.type !== 'team') return { pending: true };
                return predictMatch({
                  home: engineData.team(m.home.code),
                  away: engineData.team(m.away.code),
                  ctx: { stage: m.stage, matchNumber: a.matchNumber, venueCountry: engineData.venueCountry(a.matchNumber), knockout: m.stage !== 'group' },
                  h2h: engineData.h2hFor(m.home.code, m.away.code),
                });
              },
              communityIntelligence: (_: unknown, a: { matchNumber: number }) => predictions.communityIntelligence(a.matchNumber),
              leaderboard: (_: unknown, a: { type: string; scope: string; limit: number }) =>
                leaderboard.top(a.type === 'country' ? 'country' : 'global', a.scope, a.limit),
              myTeam: (_: unknown, __: unknown, ctx: GqlContext) => fantasy.myTeam(requireUser(ctx).id),
              mySimulations: (_: unknown, a: { limit: number }, ctx: GqlContext) => simulations.listMine(requireUser(ctx).id, a.limit),
            },
            Mutation: {
              register: (_: unknown, a: { email: string; username: string; password: string; countryCode?: string }) =>
                auth.register(a as never, {}),
              login: (_: unknown, a: { email: string; password: string }) => auth.login(a as never, {}),
              refreshToken: (_: unknown, a: { refreshToken: string }) => auth.refresh(a.refreshToken, {}),
              selectCountry: (_: unknown, a: { countryCode: string; teamName?: string }, ctx: GqlContext) =>
                fantasy.selectCountry(requireUser(ctx).id, a.countryCode, a.teamName),
              updateLineup: (_: unknown, a: { input: any }, ctx: GqlContext) =>
                fantasy.saveLineup(requireUser(ctx).id, {
                  matchNumber: a.input.matchNumber,
                  formation: a.input.formation,
                  startingXi: a.input.startingXi,
                  substitutes: a.input.substitutes,
                  captainId: a.input.captainId,
                  viceCaptainId: a.input.viceCaptainId,
                }),
              createPrediction: (_: unknown, a: { input: any }, ctx: GqlContext) =>
                predictions.submit(requireUser(ctx).id, a.input),
              simulateMatch: (_: unknown, a: { input: any }, ctx: GqlContext) =>
                simulations.simulateMatchEndpoint(ctx.user, a.input),
              runMonteCarlo: (_: unknown, a: { runs: number; pinnedTeam?: string }, ctx: GqlContext) =>
                simulations.startTournamentJob(ctx.user, { runs: a.runs }),
            },
          },
        };
      },
    }),
  ],
})
export class GraphqlApiModule {}
