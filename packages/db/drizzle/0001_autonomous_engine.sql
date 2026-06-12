-- Autonomous supercomputer upgrade: lifecycle phases, multi-source result
-- ingestion, prediction audit trail and model calibration state.
ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'pre_match';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'half_time';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'extra_time';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'penalties';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'awaiting_result';--> statement-breakpoint
ALTER TYPE "public"."match_status" ADD VALUE IF NOT EXISTS 'cancelled';--> statement-breakpoint
CREATE TABLE "result_claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"source" varchar(50) NOT NULL,
	"source_weight" numeric(3, 2) DEFAULT '0.50' NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" varchar(64) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"submitted_by" uuid,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "result_claims" ADD CONSTRAINT "result_claims_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_claims" ADD CONSTRAINT "result_claims_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claims_match" ON "result_claims" ("match_id");--> statement-breakpoint
CREATE INDEX "idx_claims_status" ON "result_claims" ("status");--> statement-breakpoint
CREATE TABLE "prediction_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"match_id" bigint NOT NULL,
	"model_version" integer NOT NULL,
	"trigger" varchar(40) NOT NULL,
	"prediction" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "prediction_snapshots" ADD CONSTRAINT "prediction_snapshots_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_snapshots_match" ON "prediction_snapshots" ("match_id","computed_at");--> statement-breakpoint
CREATE TABLE "model_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"model_version" integer NOT NULL,
	"calibration" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
