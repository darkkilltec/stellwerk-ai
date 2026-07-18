CREATE TABLE "rerank_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"model" text NOT NULL,
	"score" real NOT NULL,
	"reasoning" text NOT NULL,
	"missing_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rerank_cache_key_idx" ON "rerank_cache" USING btree ("job_hash","profile_hash","model");