CREATE TABLE "market_symbols" (
	"symbol" text PRIMARY KEY NOT NULL,
	"exchange" text NOT NULL,
	"display_name" text,
	"yahoo_symbol" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_analysis_cache" (
	"symbol" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"exchange" text,
	"normalized_score" numeric(6, 4),
	"overall" text,
	"price" numeric(16, 4),
	"change_pct" numeric(8, 4),
	"scanned_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "market_analysis_cache_score_idx" ON "market_analysis_cache" ("normalized_score" DESC);
--> statement-breakpoint
CREATE TABLE "market_scan_state" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"cursor_index" integer DEFAULT 0 NOT NULL,
	"total_symbols" integer DEFAULT 0 NOT NULL,
	"last_cycle_at" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
INSERT INTO "market_scan_state" ("id", "cursor_index", "total_symbols") VALUES ('global', 0, 0);
