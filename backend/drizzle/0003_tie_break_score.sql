ALTER TABLE "market_analysis_cache" ADD COLUMN IF NOT EXISTS "tie_break_score" numeric(8, 4) DEFAULT '0';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_analysis_cache_rank_idx" ON "market_analysis_cache" ("normalized_score" DESC, "tie_break_score" DESC);
