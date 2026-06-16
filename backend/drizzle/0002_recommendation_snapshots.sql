CREATE TABLE "market_recommendation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"picks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pick_limit" integer DEFAULT 20 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"cached_count" integer DEFAULT 0 NOT NULL,
	"total_symbols" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "market_recommendation_snapshots_completed_idx" ON "market_recommendation_snapshots" ("completed_at" DESC);
