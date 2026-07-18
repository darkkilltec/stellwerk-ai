ALTER TABLE "settings" ADD COLUMN "rerank_provider" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_model" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_api_key_encrypted" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_base_url" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_last_test_ok" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_last_tested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_last_test_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_last_test_error" text;