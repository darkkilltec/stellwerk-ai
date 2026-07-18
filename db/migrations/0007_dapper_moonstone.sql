TRUNCATE "rerank_cache";--> statement-breakpoint
DROP INDEX "rerank_cache_key_idx";--> statement-breakpoint
ALTER TABLE "rerank_cache" ADD COLUMN "prompt_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "rerank_system_prompt" text;--> statement-breakpoint
CREATE UNIQUE INDEX "rerank_cache_key_idx" ON "rerank_cache" USING btree ("job_hash","profile_hash","model","prompt_hash");--> statement-breakpoint
ALTER TABLE "rerank_cache" DROP COLUMN "prompt_version";