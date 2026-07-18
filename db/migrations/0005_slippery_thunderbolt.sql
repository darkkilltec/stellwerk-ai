DROP INDEX "rerank_cache_key_idx";--> statement-breakpoint
ALTER TABLE "rerank_cache" ADD COLUMN "prompt_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rerank_cache_key_idx" ON "rerank_cache" USING btree ("job_hash","profile_hash","model","prompt_version");