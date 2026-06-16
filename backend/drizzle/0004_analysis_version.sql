ALTER TABLE "market_analysis_cache" ADD COLUMN IF NOT EXISTS "analysis_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "market_recommendation_snapshots" ADD COLUMN IF NOT EXISTS "scoring_version" integer DEFAULT 1 NOT NULL;
