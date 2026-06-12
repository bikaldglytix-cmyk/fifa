/**
 * FIFA 2026 platform — PostgreSQL schema (Drizzle ORM).
 * Mirrors PRD §6 with production notes:
 *  - `player_statistics` becomes a TimescaleDB hypertable in production
 *    (infra/sql/timescale.sql); plain table on PGlite/vanilla PG.
 *  - `simulations` is range-partitioned by month in production
 *    (infra/sql/partitions.sql).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  serial,
  bigserial,
  timestamp,
  date,
  decimal,
  jsonb,
  char,
  primaryKey,
  index,
  uniqueIndex,
  doublePrecision,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', ['guest', 'registered', 'premium', 'admin']);
export const matchStageEnum = pgEnum('match_stage', [
  'group', 'round32', 'round16', 'quarterfinal', 'semifinal', 'third_place', 'final',
]);
export const matchStatusEnum = pgEnum('match_status', [
  'scheduled', 'pre_match', 'live', 'half_time', 'extra_time', 'penalties',
  'awaiting_result', 'completed', 'postponed', 'cancelled',
]);
export const formationEnum = pgEnum('formation_type', ['4-3-3', '4-2-3-1', '3-5-2', '4-4-2', '5-3-2']);
export const squadPositionEnum = pgEnum('squad_position', ['GK', 'DF', 'MF', 'FW']);
export const tacticalStyleEnum = pgEnum('tactical_style', [
  'possession', 'high_press', 'counter_attack', 'direct', 'defensive_block',
]);
export const simulationTypeEnum = pgEnum('simulation_type', [
  'single_match', 'group_stage', 'tournament', 'monte_carlo',
]);
export const leaderboardTypeEnum = pgEnum('leaderboard_type', ['global', 'country', 'friends']);
export const notificationTypeEnum = pgEnum('notification_type', [
  'lineup_official', 'match_result', 'prediction_scored', 'rank_change', 'league_invite', 'system',
]);

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: varchar('email', { length: 255 }).notNull(),
    username: varchar('username', { length: 50 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }),
    role: userRoleEnum('role').notNull().default('registered'),
    countryCode: char('country_code', { length: 3 }),
    preferredLanguage: varchar('preferred_language', { length: 10 }).notNull().default('en'),
    emailVerified: boolean('email_verified').notNull().default(false),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    mfaSecret: varchar('mfa_secret', { length: 255 }),
    premiumUntil: timestamp('premium_until', { withTimezone: true }),
    stripeCustomerId: varchar('stripe_customer_id', { length: 100 }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspensionReason: text('suspension_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLogin: timestamp('last_login', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('users_username_unique').on(sql`lower(${t.username})`),
    index('idx_users_role').on(t.role),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 128 }).notNull(),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 64 }),
    deviceFingerprint: varchar('device_fingerprint', { length: 128 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_sessions_user').on(t.userId),
    uniqueIndex('idx_sessions_token').on(t.refreshTokenHash),
    index('idx_sessions_expires').on(t.expiresAt),
  ],
);

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 20 }).notNull().default('dark'),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  emailDigest: boolean('email_digest').notNull().default(true),
  defaultSimulationCount: integer('default_simulation_count').notNull().default(1000),
  favoriteTeamCountry: char('favorite_team_country', { length: 3 }),
  sharePredictions: boolean('share_predictions').notNull().default(true),
});

// ---------------------------------------------------------------------------
// Tournament & teams
// ---------------------------------------------------------------------------

export const tournaments = pgTable(
  'tournaments',
  {
    id: serial('id').primaryKey(),
    year: integer('year').notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    hostCountry: varchar('host_country', { length: 100 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: varchar('status', { length: 20 }).notNull().default('upcoming'),
    formatConfig: jsonb('format_config').notNull(),
  },
  (t) => [index('idx_tournaments_status').on(t.status)],
);

export const countries = pgTable(
  'countries',
  {
    code: char('code', { length: 3 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    confederation: varchar('confederation', { length: 10 }).notNull(),
    fifaRanking: integer('fifa_ranking'),
    fifaPoints: doublePrecision('fifa_points'),
    eloRating: integer('elo_rating').notNull().default(1500),
    eloRank: integer('elo_rank'),
    flagUrl: text('flag_url'),
    worldCupAppearances: integer('world_cup_appearances'),
    /** computed pre-tournament aggregates (recent form etc.) */
    profile: jsonb('profile'),
  },
  (t) => [index('idx_countries_ranking').on(t.fifaRanking)],
);

export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    countryCode: char('country_code', { length: 3 }).notNull().references(() => countries.code),
    groupLetter: char('group_letter', { length: 1 }).notNull(),
    drawPosition: integer('draw_position').notNull(),
    groupPot: integer('group_pot').notNull(),
    seedingRank: integer('seeding_rank'),
    status: varchar('status', { length: 20 }).notNull().default('qualified'),
  },
  (t) => [
    uniqueIndex('teams_tournament_country').on(t.tournamentId, t.countryCode),
    index('idx_teams_group').on(t.tournamentId, t.groupLetter),
  ],
);

export const venues = pgTable('venues', {
  id: varchar('id', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  city: varchar('city', { length: 100 }).notNull(),
  country: varchar('country', { length: 100 }).notNull(),
  capacity: integer('capacity').notNull(),
  timezone: varchar('timezone', { length: 50 }).notNull(),
});

export const matches = pgTable(
  'matches',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    stage: matchStageEnum('stage').notNull(),
    matchNumber: integer('match_number').notNull().unique(),
    groupLetter: char('group_letter', { length: 1 }),
    matchday: integer('matchday'),
    homeTeamId: integer('home_team_id').references(() => teams.id),
    awayTeamId: integer('away_team_id').references(() => teams.id),
    /** unresolved bracket slots (groupWinner/runnerUp/thirdPlace/matchWinner...) */
    homeSlot: jsonb('home_slot'),
    awaySlot: jsonb('away_slot'),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    homeScoreEt: integer('home_score_et'),
    awayScoreEt: integer('away_score_et'),
    homePenalties: integer('home_penalties'),
    awayPenalties: integer('away_penalties'),
    winnerTeamId: integer('winner_team_id').references(() => teams.id),
    matchDate: timestamp('match_date', { withTimezone: true }).notNull(),
    localDate: date('local_date').notNull(),
    localTime: varchar('local_time', { length: 5 }).notNull(),
    venueId: varchar('venue_id', { length: 64 }).notNull().references(() => venues.id),
    attendance: integer('attendance'),
    status: matchStatusEnum('status').notNull().default('scheduled'),
  },
  (t) => [
    index('idx_matches_tournament').on(t.tournamentId),
    index('idx_matches_date').on(t.matchDate),
    index('idx_matches_stage').on(t.stage),
    index('idx_matches_teams').on(t.homeTeamId, t.awayTeamId),
  ],
);

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export const players = pgTable(
  'players',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    externalId: varchar('external_id', { length: 100 }),
    dataSource: varchar('data_source', { length: 50 }).notNull().default('fifa_squad_list'),
    name: varchar('name', { length: 100 }).notNull(),
    countryCode: char('country_code', { length: 3 }).notNull().references(() => countries.code),
    position: squadPositionEnum('position').notNull(),
    club: varchar('club', { length: 100 }),
    clubCountry: char('club_country', { length: 3 }),
    dateOfBirth: date('date_of_birth'),
    age: integer('age'),
    jerseyNumber: integer('jersey_number'),
    caps: integer('caps').notNull().default(0),
    internationalGoals: integer('international_goals').notNull().default(0),
    isCaptain: boolean('is_captain').notNull().default(false),
    /** modeled 0..100 overall used by the engine (derivation in sim-engine/ratings) */
    rating: doublePrecision('rating'),
    injuryStatus: varchar('injury_status', { length: 20 }).notNull().default('fit'),
    injuryDescription: text('injury_description'),
    fitnessPercentage: integer('fitness_percentage').notNull().default(100),
    suspensionRisk: boolean('suspension_risk').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_players_country').on(t.countryCode),
    index('idx_players_position').on(t.position),
    index('idx_players_club').on(t.club),
    uniqueIndex('players_country_number').on(t.countryCode, t.jerseyNumber),
  ],
);

/** Per-match player stats (TimescaleDB hypertable in production). */
export const playerStatistics = pgTable(
  'player_statistics',
  {
    playerId: bigint('player_id', { mode: 'number' }).notNull().references(() => players.id, { onDelete: 'cascade' }),
    matchId: bigint('match_id', { mode: 'number' }).references(() => matches.id),
    matchDate: date('match_date').notNull(),
    season: varchar('season', { length: 10 }),
    minutesPlayed: integer('minutes_played'),
    goals: integer('goals').notNull().default(0),
    assists: integer('assists').notNull().default(0),
    xg: decimal('xg', { precision: 5, scale: 3 }),
    xa: decimal('xa', { precision: 5, scale: 3 }),
    shots: integer('shots'),
    shotsOnTarget: integer('shots_on_target'),
    keyPasses: integer('key_passes'),
    dribblesCompleted: integer('dribbles_completed'),
    dribblesAttempted: integer('dribbles_attempted'),
    passAccuracy: decimal('pass_accuracy', { precision: 5, scale: 2 }),
    tackles: integer('tackles'),
    interceptions: integer('interceptions'),
    clearances: integer('clearances'),
    aerialDuelsWon: integer('aerial_duels_won'),
    saves: integer('saves'),
    goalsConceded: integer('goals_conceded'),
    cleanSheet: boolean('clean_sheet'),
    penaltiesSaved: integer('penalties_saved'),
    yellowCards: integer('yellow_cards').notNull().default(0),
    redCards: integer('red_cards').notNull().default(0),
    fatigueIndex: decimal('fatigue_index', { precision: 5, scale: 2 }),
  },
  (t) => [
    primaryKey({ columns: [t.playerId, t.matchDate] }),
    index('idx_player_stats_date').on(t.matchDate),
  ],
);

export const teamStatistics = pgTable(
  'team_statistics',
  {
    teamId: integer('team_id').notNull().references(() => teams.id),
    matchId: bigint('match_id', { mode: 'number' }).notNull().references(() => matches.id),
    matchDate: date('match_date').notNull(),
    goalsScored: integer('goals_scored').notNull().default(0),
    goalsConceded: integer('goals_conceded').notNull().default(0),
    possession: decimal('possession', { precision: 5, scale: 2 }),
    shots: integer('shots'),
    shotsOnTarget: integer('shots_on_target'),
    passAccuracy: decimal('pass_accuracy', { precision: 5, scale: 2 }),
    pressingEfficiency: decimal('pressing_efficiency', { precision: 5, scale: 2 }),
    setPieceEfficiency: decimal('set_piece_efficiency', { precision: 5, scale: 2 }),
    counterAttackGoals: integer('counter_attack_goals'),
    xg: decimal('xg', { precision: 5, scale: 2 }),
    xga: decimal('xga', { precision: 5, scale: 2 }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.matchId] }),
    index('idx_team_stats_team').on(t.teamId),
    index('idx_team_stats_date').on(t.matchDate),
  ],
);

// ---------------------------------------------------------------------------
// Manager intelligence
// ---------------------------------------------------------------------------

export const managers = pgTable(
  'managers',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    countryCode: char('country_code', { length: 3 }).notNull().references(() => countries.code),
    nationality: char('nationality', { length: 3 }),
    experienceYears: integer('experience_years'),
    tournamentExperience: integer('tournament_experience'),
    worldCupExperience: integer('world_cup_experience'),
    winRate: decimal('win_rate', { precision: 5, scale: 2 }),
    drawRate: decimal('draw_rate', { precision: 5, scale: 2 }),
    lossRate: decimal('loss_rate', { precision: 5, scale: 2 }),
    goalsScoredAvg: decimal('goals_scored_avg', { precision: 4, scale: 2 }),
    goalsConcededAvg: decimal('goals_conceded_avg', { precision: 4, scale: 2 }),
    cleanSheetPercentage: decimal('clean_sheet_percentage', { precision: 5, scale: 2 }),
    tacticalRating: integer('tactical_rating'),
    adaptabilityRating: integer('adaptability_rating'),
    substitutionRating: integer('substitution_rating'),
    pressureHandling: integer('pressure_handling'),
    knockoutRating: integer('knockout_rating'),
    preferredStyle: tacticalStyleEnum('preferred_style'),
    secondaryStyles: tacticalStyleEnum('secondary_styles').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('idx_managers_country').on(t.countryCode)],
);

export const managerHeadToHead = pgTable(
  'manager_head_to_head',
  {
    manager1Id: integer('manager1_id').notNull().references(() => managers.id),
    manager2Id: integer('manager2_id').notNull().references(() => managers.id),
    matchesPlayed: integer('matches_played').notNull().default(0),
    manager1Wins: integer('manager1_wins').notNull().default(0),
    manager2Wins: integer('manager2_wins').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    lastMeeting: date('last_meeting'),
  },
  (t) => [primaryKey({ columns: [t.manager1Id, t.manager2Id] })],
);

export const teamHeadToHead = pgTable(
  'team_head_to_head',
  {
    country1: char('country1', { length: 3 }).notNull().references(() => countries.code),
    country2: char('country2', { length: 3 }).notNull().references(() => countries.code),
    matchesPlayed: integer('matches_played').notNull().default(0),
    country1Wins: integer('country1_wins').notNull().default(0),
    country2Wins: integer('country2_wins').notNull().default(0),
    draws: integer('draws').notNull().default(0),
    country1Goals: integer('country1_goals').notNull().default(0),
    country2Goals: integer('country2_goals').notNull().default(0),
    worldCupMeetings: integer('world_cup_meetings').notNull().default(0),
    lastMeeting: jsonb('last_meeting'),
  },
  (t) => [primaryKey({ columns: [t.country1, t.country2] })],
);

export const playerMatchups = pgTable(
  'player_matchups',
  {
    player1Id: bigint('player1_id', { mode: 'number' }).notNull().references(() => players.id),
    player2Id: bigint('player2_id', { mode: 'number' }).notNull().references(() => players.id),
    matchupType: varchar('matchup_type', { length: 30 }).notNull(),
    winRateP1: decimal('win_rate_p1', { precision: 5, scale: 2 }),
    encounters: integer('encounters').notNull().default(0),
    lastEncounter: date('last_encounter'),
  },
  (t) => [primaryKey({ columns: [t.player1Id, t.player2Id, t.matchupType] })],
);

// ---------------------------------------------------------------------------
// Fantasy teams
// ---------------------------------------------------------------------------

export const userTeams = pgTable(
  'user_teams',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    countryCode: char('country_code', { length: 3 }).notNull().references(() => countries.code),
    teamName: varchar('team_name', { length: 100 }),
    formation: formationEnum('formation').notNull().default('4-3-3'),
    totalPoints: integer('total_points').notNull().default(0),
    rank: integer('rank'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_teams_unique').on(t.userId, t.tournamentId),
    index('idx_user_teams_user').on(t.userId),
    index('idx_user_teams_country').on(t.countryCode),
    index('idx_user_teams_points').on(t.totalPoints),
  ],
);

export const userLineups = pgTable(
  'user_lineups',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userTeamId: uuid('user_team_id').notNull().references(() => userTeams.id, { onDelete: 'cascade' }),
    matchId: bigint('match_id', { mode: 'number' }).notNull().references(() => matches.id),
    isOfficial: boolean('is_official').notNull().default(false),
    isLocked: boolean('is_locked').notNull().default(false),
    formation: formationEnum('formation').notNull().default('4-3-3'),
    startingXi: jsonb('starting_xi').notNull(),
    substitutes: jsonb('substitutes').notNull().default(sql`'[]'::jsonb`),
    captainPlayerId: bigint('captain_player_id', { mode: 'number' }).references(() => players.id),
    viceCaptainPlayerId: bigint('vice_captain_player_id', { mode: 'number' }).references(() => players.id),
    teamChemistry: integer('team_chemistry'),
    tacticalFit: integer('tactical_fit'),
    pointsEarned: integer('points_earned').notNull().default(0),
    pointsBreakdown: jsonb('points_breakdown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_lineups_unique').on(t.userTeamId, t.matchId),
    index('idx_lineups_match').on(t.matchId),
    index('idx_lineups_locked').on(t.isLocked),
  ],
);

// ---------------------------------------------------------------------------
// Simulations
// ---------------------------------------------------------------------------

export const simulations = pgTable(
  'simulations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    simulationType: simulationTypeEnum('simulation_type').notNull(),
    config: jsonb('config').notNull(),
    results: jsonb('results').notNull(),
    seed: bigint('seed', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    simulationCount: integer('simulation_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_simulations_user').on(t.userId),
    index('idx_simulations_type').on(t.simulationType),
    index('idx_simulations_created').on(t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

export const predictions = pgTable(
  'predictions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    matchId: bigint('match_id', { mode: 'number' }).notNull().references(() => matches.id),
    predictedHomeScore: integer('predicted_home_score').notNull(),
    predictedAwayScore: integer('predicted_away_score').notNull(),
    predictedWinner: char('predicted_winner', { length: 3 }),
    firstGoalscorerId: bigint('first_goalscorer_id', { mode: 'number' }).references(() => players.id),
    cleanSheetTeam: char('clean_sheet_team', { length: 3 }),
    pointsAwarded: integer('points_awarded').notNull().default(0),
    isScored: boolean('is_scored').notNull().default(false),
    isCorrectOutcome: boolean('is_correct_outcome'),
    isExactScore: boolean('is_exact_score'),
    submissionMs: integer('submission_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('predictions_user_match').on(t.userId, t.matchId),
    index('idx_predictions_match').on(t.matchId),
    index('idx_predictions_points').on(t.pointsAwarded),
  ],
);

// ---------------------------------------------------------------------------
// Leaderboards
// ---------------------------------------------------------------------------

export const leaderboardEntries = pgTable(
  'leaderboard_entries',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tournamentId: integer('tournament_id').notNull().references(() => tournaments.id),
    leaderboardType: leaderboardTypeEnum('leaderboard_type').notNull().default('global'),
    scopeKey: varchar('scope_key', { length: 64 }).notNull().default('global'),
    totalPoints: integer('total_points').notNull().default(0),
    predictionPoints: integer('prediction_points').notNull().default(0),
    fantasyPoints: integer('fantasy_points').notNull().default(0),
    predictionAccuracy: decimal('prediction_accuracy', { precision: 5, scale: 2 }).notNull().default('0'),
    exactScoreAccuracy: decimal('exact_score_accuracy', { precision: 5, scale: 2 }).notNull().default('0'),
    winnerAccuracy: decimal('winner_accuracy', { precision: 5, scale: 2 }).notNull().default('0'),
    simulationsRun: integer('simulations_run').notNull().default(0),
    reputationScore: decimal('reputation_score', { precision: 10, scale: 2 }).notNull().default('0'),
    rank: integer('rank'),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('leaderboard_unique').on(t.userId, t.tournamentId, t.leaderboardType, t.scopeKey),
    index('idx_leaderboard_lookup').on(t.tournamentId, t.leaderboardType, t.scopeKey, t.rank),
  ],
);

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

export const userFollows = pgTable(
  'user_follows',
  {
    followerId: uuid('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    followingId: uuid('following_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followingId] })],
);

export const privateLeagues = pgTable(
  'private_leagues',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    creatorId: uuid('creator_id').notNull().references(() => users.id),
    name: varchar('name', { length: 100 }).notNull(),
    joinCode: varchar('join_code', { length: 10 }).notNull(),
    maxParticipants: integer('max_participants').notNull().default(100),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('leagues_join_code').on(t.joinCode)],
);

export const leagueMembers = pgTable(
  'league_members',
  {
    leagueId: uuid('league_id').notNull().references(() => privateLeagues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    totalPoints: integer('total_points').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body'),
    data: jsonb('data'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_notifications_user').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Audit & ingestion
// ---------------------------------------------------------------------------

export const dataIngestionLogs = pgTable('data_ingestion_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  source: varchar('source', { length: 50 }).notNull(),
  dataType: varchar('data_type', { length: 50 }).notNull(),
  confidenceScore: decimal('confidence_score', { precision: 3, scale: 2 }),
  recordsIngested: integer('records_ingested').notNull().default(0),
  validationErrors: jsonb('validation_errors'),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  ingestedBy: uuid('ingested_by').references(() => users.id),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').references(() => users.id),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }),
    entityId: varchar('entity_id', { length: 100 }),
    oldValues: jsonb('old_values'),
    newValues: jsonb('new_values'),
    ipAddress: varchar('ip_address', { length: 64 }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_audit_user').on(t.userId, t.createdAt)],
);

/**
 * Multi-source result ingestion: every score claim from every configured
 * provider is recorded; matches only complete when weighted source consensus
 * passes the acceptance threshold. No manual status toggles exist.
 */
export const resultClaims = pgTable(
  'result_claims',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).notNull().references(() => matches.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 50 }).notNull(),
    sourceWeight: decimal('source_weight', { precision: 3, scale: 2 }).notNull().default('0.50'),
    payload: jsonb('payload').notNull(),
    payloadHash: varchar('payload_hash', { length: 64 }).notNull(),
    /** pending | accepted | superseded | rejected | retracted */
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    submittedBy: uuid('submitted_by').references(() => users.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('idx_claims_match').on(t.matchId), index('idx_claims_status').on(t.status)],
);

/** Audit trail of model output per match — every prediction change is recorded. */
export const predictionSnapshots = pgTable(
  'prediction_snapshots',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    matchId: bigint('match_id', { mode: 'number' }).notNull().references(() => matches.id, { onDelete: 'cascade' }),
    modelVersion: integer('model_version').notNull(),
    /** initial | result_ingested | retraction | availability_change | recalibration */
    trigger: varchar('trigger', { length: 40 }).notNull(),
    prediction: jsonb('prediction').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_snapshots_match').on(t.matchId, t.computedAt)],
);

/** Singleton calibration record (Brier/log-loss history, model version). */
export const modelState = pgTable('model_state', {
  id: integer('id').primaryKey().default(1),
  modelVersion: integer('model_version').notNull(),
  calibration: jsonb('calibration').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fraudFlags = pgTable(
  'fraud_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 100 }).notNull(),
    severity: varchar('severity', { length: 20 }).notNull().default('low'),
    details: jsonb('details'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_fraud_user').on(t.userId)],
);
