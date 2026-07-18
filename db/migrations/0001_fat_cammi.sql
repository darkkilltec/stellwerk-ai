CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"provider" text NOT NULL,
	"embedding_model" text NOT NULL,
	"api_key_encrypted" text,
	"base_url" text,
	"last_test_ok" boolean DEFAULT false NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_latency_ms" integer,
	"last_test_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_singleton" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "embedding_source_hash" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "embedding_source_hash" text;