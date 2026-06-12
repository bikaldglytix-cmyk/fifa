CREATE TYPE "public"."formation_type" AS ENUM('4-3-3', '4-2-3-1', '3-5-2', '4-4-2', '5-3-2');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_type" AS ENUM('global', 'country', 'friends');--> statement-breakpoint
CREATE TYPE "public"."match_stage" AS ENUM('group', 'round32', 'round16', 'quarterfinal', 'semifinal', 'third_place', 'final');--> statement-breakpoint
CREATE TYPE "public"."match_status" AS ENUM('scheduled', 'live', 'completed', 'postponed');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('lineup_official', 'match_result', 'prediction_scored', 'rank_change', 'league_invite', 'system');--> statement-breakpoint
CREATE TYPE "public"."simulation_type" AS ENUM('single_match', 'group_stage', 'tournament', 'monte_carlo');--> statement-breakpoint
CREATE TYPE "public"."squad_position" AS ENUM('GK', 'DF', 'MF', 'FW');--> statement-breakpoint
CREATE TYPE "public"."tactical_style" AS ENUM('possession', 'high_press', 'counter_attack', 'direct', 'defensive_block');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('guest', 'registered', 'premium', 'admin');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" varchar(100),
	"old_values" jsonb,
	"new_values" jsonb,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"confederation" varchar(10) NOT NULL,
	"fifa_ranking" integer,
	"fifa_points" double precision,
	"elo_rating" integer DEFAULT 1500 NOT NULL,
	"elo_rank" integer,
	"flag_url" text,
	"world_cup_appearances" integer,
	"profile" jsonb
);
--> statement-breakpoint
CREATE TABLE "data_ingestion_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" varchar(50) NOT NULL,
	"data_type" varchar(50) NOT NULL,
	"confidence_score" numeric(3, 2),
	"records_ingested" integer DEFAULT 0 NOT NULL,
	"validation_errors" jsonb,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ingested_by" uuid
);
--> statement-breakpoint
CREATE TABLE "fraud_flags" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" varchar(100) NOT NULL,
	"severity" varchar(20) DEFAULT 'low' NOT NULL,
	"details" jsonb,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tournament_id" integer NOT NULL,
	"leaderboard_type" "leaderboard_type" DEFAULT 'global' NOT NULL,
	"scope_key" varchar(64) DEFAULT 'global' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"prediction_points" integer DEFAULT 0 NOT NULL,
	"fantasy_points" integer DEFAULT 0 NOT NULL,
	"prediction_accuracy" numeric(5, 2) DEFAULT '0' NOT NULL,
	"exact_score_accuracy" numeric(5, 2) DEFAULT '0' NOT NULL,
	"winner_accuracy" numeric(5, 2) DEFAULT '0' NOT NULL,
	"simulations_run" integer DEFAULT 0 NOT NULL,
	"reputation_score" numeric(10, 2) DEFAULT '0' NOT NULL,
	"rank" integer,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "league_members" (
	"league_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "league_members_league_id_user_id_pk" PRIMARY KEY("league_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "manager_head_to_head" (
	"manager1_id" integer NOT NULL,
	"manager2_id" integer NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"manager1_wins" integer DEFAULT 0 NOT NULL,
	"manager2_wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"last_meeting" date,
	CONSTRAINT "manager_head_to_head_manager1_id_manager2_id_pk" PRIMARY KEY("manager1_id","manager2_id")
);
--> statement-breakpoint
CREATE TABLE "managers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"country_code" char(3) NOT NULL,
	"nationality" char(3),
	"experience_years" integer,
	"tournament_experience" integer,
	"world_cup_experience" integer,
	"win_rate" numeric(5, 2),
	"draw_rate" numeric(5, 2),
	"loss_rate" numeric(5, 2),
	"goals_scored_avg" numeric(4, 2),
	"goals_conceded_avg" numeric(4, 2),
	"clean_sheet_percentage" numeric(5, 2),
	"tactical_rating" integer,
	"adaptability_rating" integer,
	"substitution_rating" integer,
	"pressure_handling" integer,
	"knockout_rating" integer,
	"preferred_style" "tactical_style",
	"secondary_styles" "tactical_style"[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tournament_id" integer NOT NULL,
	"stage" "match_stage" NOT NULL,
	"match_number" integer NOT NULL,
	"group_letter" char(1),
	"matchday" integer,
	"home_team_id" integer,
	"away_team_id" integer,
	"home_slot" jsonb,
	"away_slot" jsonb,
	"home_score" integer,
	"away_score" integer,
	"home_score_et" integer,
	"away_score_et" integer,
	"home_penalties" integer,
	"away_penalties" integer,
	"winner_team_id" integer,
	"match_date" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"local_time" varchar(5) NOT NULL,
	"venue_id" varchar(64) NOT NULL,
	"attendance" integer,
	"status" "match_status" DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT "matches_match_number_unique" UNIQUE("match_number")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_matchups" (
	"player1_id" bigint NOT NULL,
	"player2_id" bigint NOT NULL,
	"matchup_type" varchar(30) NOT NULL,
	"win_rate_p1" numeric(5, 2),
	"encounters" integer DEFAULT 0 NOT NULL,
	"last_encounter" date,
	CONSTRAINT "player_matchups_player1_id_player2_id_matchup_type_pk" PRIMARY KEY("player1_id","player2_id","matchup_type")
);
--> statement-breakpoint
CREATE TABLE "player_statistics" (
	"player_id" bigint NOT NULL,
	"match_id" bigint,
	"match_date" date NOT NULL,
	"season" varchar(10),
	"minutes_played" integer,
	"goals" integer DEFAULT 0 NOT NULL,
	"assists" integer DEFAULT 0 NOT NULL,
	"xg" numeric(5, 3),
	"xa" numeric(5, 3),
	"shots" integer,
	"shots_on_target" integer,
	"key_passes" integer,
	"dribbles_completed" integer,
	"dribbles_attempted" integer,
	"pass_accuracy" numeric(5, 2),
	"tackles" integer,
	"interceptions" integer,
	"clearances" integer,
	"aerial_duels_won" integer,
	"saves" integer,
	"goals_conceded" integer,
	"clean_sheet" boolean,
	"penalties_saved" integer,
	"yellow_cards" integer DEFAULT 0 NOT NULL,
	"red_cards" integer DEFAULT 0 NOT NULL,
	"fatigue_index" numeric(5, 2),
	CONSTRAINT "player_statistics_player_id_match_date_pk" PRIMARY KEY("player_id","match_date")
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"external_id" varchar(100),
	"data_source" varchar(50) DEFAULT 'fifa_squad_list' NOT NULL,
	"name" varchar(100) NOT NULL,
	"country_code" char(3) NOT NULL,
	"position" "squad_position" NOT NULL,
	"club" varchar(100),
	"club_country" char(3),
	"date_of_birth" date,
	"age" integer,
	"jersey_number" integer,
	"caps" integer DEFAULT 0 NOT NULL,
	"international_goals" integer DEFAULT 0 NOT NULL,
	"is_captain" boolean DEFAULT false NOT NULL,
	"rating" double precision,
	"injury_status" varchar(20) DEFAULT 'fit' NOT NULL,
	"injury_description" text,
	"fitness_percentage" integer DEFAULT 100 NOT NULL,
	"suspension_risk" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "predictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"match_id" bigint NOT NULL,
	"predicted_home_score" integer NOT NULL,
	"predicted_away_score" integer NOT NULL,
	"predicted_winner" char(3),
	"first_goalscorer_id" bigint,
	"clean_sheet_team" char(3),
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"is_scored" boolean DEFAULT false NOT NULL,
	"is_correct_outcome" boolean,
	"is_exact_score" boolean,
	"submission_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "private_leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"join_code" varchar(10) NOT NULL,
	"max_participants" integer DEFAULT 100 NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"simulation_type" "simulation_type" NOT NULL,
	"config" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"seed" bigint,
	"duration_ms" integer,
	"simulation_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_head_to_head" (
	"country1" char(3) NOT NULL,
	"country2" char(3) NOT NULL,
	"matches_played" integer DEFAULT 0 NOT NULL,
	"country1_wins" integer DEFAULT 0 NOT NULL,
	"country2_wins" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"country1_goals" integer DEFAULT 0 NOT NULL,
	"country2_goals" integer DEFAULT 0 NOT NULL,
	"world_cup_meetings" integer DEFAULT 0 NOT NULL,
	"last_meeting" jsonb,
	CONSTRAINT "team_head_to_head_country1_country2_pk" PRIMARY KEY("country1","country2")
);
--> statement-breakpoint
CREATE TABLE "team_statistics" (
	"team_id" integer NOT NULL,
	"match_id" bigint NOT NULL,
	"match_date" date NOT NULL,
	"goals_scored" integer DEFAULT 0 NOT NULL,
	"goals_conceded" integer DEFAULT 0 NOT NULL,
	"possession" numeric(5, 2),
	"shots" integer,
	"shots_on_target" integer,
	"pass_accuracy" numeric(5, 2),
	"pressing_efficiency" numeric(5, 2),
	"set_piece_efficiency" numeric(5, 2),
	"counter_attack_goals" integer,
	"xg" numeric(5, 2),
	"xga" numeric(5, 2),
	CONSTRAINT "team_statistics_team_id_match_id_pk" PRIMARY KEY("team_id","match_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"tournament_id" integer NOT NULL,
	"country_code" char(3) NOT NULL,
	"group_letter" char(1) NOT NULL,
	"draw_position" integer NOT NULL,
	"group_pot" integer NOT NULL,
	"seeding_rank" integer,
	"status" varchar(20) DEFAULT 'qualified' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"host_country" varchar(100) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"status" varchar(20) DEFAULT 'upcoming' NOT NULL,
	"format_config" jsonb NOT NULL,
	CONSTRAINT "tournaments_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id")
);
--> statement-breakpoint
CREATE TABLE "user_lineups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_team_id" uuid NOT NULL,
	"match_id" bigint NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"formation" "formation_type" DEFAULT '4-3-3' NOT NULL,
	"starting_xi" jsonb NOT NULL,
	"substitutes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captain_player_id" bigint,
	"vice_captain_player_id" bigint,
	"team_chemistry" integer,
	"tactical_fit" integer,
	"points_earned" integer DEFAULT 0 NOT NULL,
	"points_breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" varchar(20) DEFAULT 'dark' NOT NULL,
	"notifications_enabled" boolean DEFAULT true NOT NULL,
	"email_digest" boolean DEFAULT true NOT NULL,
	"default_simulation_count" integer DEFAULT 1000 NOT NULL,
	"favorite_team_country" char(3),
	"share_predictions" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" varchar(128) NOT NULL,
	"user_agent" text,
	"ip_address" varchar(64),
	"device_fingerprint" varchar(128),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tournament_id" integer NOT NULL,
	"country_code" char(3) NOT NULL,
	"team_name" varchar(100),
	"formation" "formation_type" DEFAULT '4-3-3' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"username" varchar(50) NOT NULL,
	"password_hash" varchar(255),
	"role" "user_role" DEFAULT 'registered' NOT NULL,
	"country_code" char(3),
	"preferred_language" varchar(10) DEFAULT 'en' NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"mfa_secret" varchar(255),
	"premium_until" timestamp with time zone,
	"stripe_customer_id" varchar(100),
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"city" varchar(100) NOT NULL,
	"country" varchar(100) NOT NULL,
	"capacity" integer NOT NULL,
	"timezone" varchar(50) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_ingestion_logs" ADD CONSTRAINT "data_ingestion_logs_ingested_by_users_id_fk" FOREIGN KEY ("ingested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_private_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."private_leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_head_to_head" ADD CONSTRAINT "manager_head_to_head_manager1_id_managers_id_fk" FOREIGN KEY ("manager1_id") REFERENCES "public"."managers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manager_head_to_head" ADD CONSTRAINT "manager_head_to_head_manager2_id_managers_id_fk" FOREIGN KEY ("manager2_id") REFERENCES "public"."managers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managers" ADD CONSTRAINT "managers_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_winner_team_id_teams_id_fk" FOREIGN KEY ("winner_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_matchups" ADD CONSTRAINT "player_matchups_player1_id_players_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_matchups" ADD CONSTRAINT "player_matchups_player2_id_players_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_statistics" ADD CONSTRAINT "player_statistics_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_statistics" ADD CONSTRAINT "player_statistics_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictions" ADD CONSTRAINT "predictions_first_goalscorer_id_players_id_fk" FOREIGN KEY ("first_goalscorer_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "private_leagues" ADD CONSTRAINT "private_leagues_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulations" ADD CONSTRAINT "simulations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_head_to_head" ADD CONSTRAINT "team_head_to_head_country1_countries_code_fk" FOREIGN KEY ("country1") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_head_to_head" ADD CONSTRAINT "team_head_to_head_country2_countries_code_fk" FOREIGN KEY ("country2") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_statistics" ADD CONSTRAINT "team_statistics_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_statistics" ADD CONSTRAINT "team_statistics_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lineups" ADD CONSTRAINT "user_lineups_user_team_id_user_teams_id_fk" FOREIGN KEY ("user_team_id") REFERENCES "public"."user_teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lineups" ADD CONSTRAINT "user_lineups_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lineups" ADD CONSTRAINT "user_lineups_captain_player_id_players_id_fk" FOREIGN KEY ("captain_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lineups" ADD CONSTRAINT "user_lineups_vice_captain_player_id_players_id_fk" FOREIGN KEY ("vice_captain_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_teams" ADD CONSTRAINT "user_teams_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_user" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_countries_ranking" ON "countries" USING btree ("fifa_ranking");--> statement-breakpoint
CREATE INDEX "idx_fraud_user" ON "fraud_flags" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_unique" ON "leaderboard_entries" USING btree ("user_id","tournament_id","leaderboard_type","scope_key");--> statement-breakpoint
CREATE INDEX "idx_leaderboard_lookup" ON "leaderboard_entries" USING btree ("tournament_id","leaderboard_type","scope_key","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_managers_country" ON "managers" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_matches_tournament" ON "matches" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "idx_matches_date" ON "matches" USING btree ("match_date");--> statement-breakpoint
CREATE INDEX "idx_matches_stage" ON "matches" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "idx_matches_teams" ON "matches" USING btree ("home_team_id","away_team_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_player_stats_date" ON "player_statistics" USING btree ("match_date");--> statement-breakpoint
CREATE INDEX "idx_players_country" ON "players" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_players_position" ON "players" USING btree ("position");--> statement-breakpoint
CREATE INDEX "idx_players_club" ON "players" USING btree ("club");--> statement-breakpoint
CREATE UNIQUE INDEX "players_country_number" ON "players" USING btree ("country_code","jersey_number");--> statement-breakpoint
CREATE UNIQUE INDEX "predictions_user_match" ON "predictions" USING btree ("user_id","match_id");--> statement-breakpoint
CREATE INDEX "idx_predictions_match" ON "predictions" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "idx_predictions_points" ON "predictions" USING btree ("points_awarded");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_join_code" ON "private_leagues" USING btree ("join_code");--> statement-breakpoint
CREATE INDEX "idx_simulations_user" ON "simulations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_simulations_type" ON "simulations" USING btree ("simulation_type");--> statement-breakpoint
CREATE INDEX "idx_simulations_created" ON "simulations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_team_stats_team" ON "team_statistics" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "idx_team_stats_date" ON "team_statistics" USING btree ("match_date");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_tournament_country" ON "teams" USING btree ("tournament_id","country_code");--> statement-breakpoint
CREATE INDEX "idx_teams_group" ON "teams" USING btree ("tournament_id","group_letter");--> statement-breakpoint
CREATE INDEX "idx_tournaments_status" ON "tournaments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "user_lineups_unique" ON "user_lineups" USING btree ("user_team_id","match_id");--> statement-breakpoint
CREATE INDEX "idx_lineups_match" ON "user_lineups" USING btree ("match_id");--> statement-breakpoint
CREATE INDEX "idx_lineups_locked" ON "user_lineups" USING btree ("is_locked");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_sessions_token" ON "user_sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_teams_unique" ON "user_teams" USING btree ("user_id","tournament_id");--> statement-breakpoint
CREATE INDEX "idx_user_teams_user" ON "user_teams" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_teams_country" ON "user_teams" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "idx_user_teams_points" ON "user_teams" USING btree ("total_points");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_unique" ON "users" USING btree (lower("username"));--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");