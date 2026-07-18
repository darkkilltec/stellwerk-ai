CREATE TABLE "evaluation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"candidate_id" uuid,
	"candidate_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"score" real,
	"reasoning" text,
	"missing_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"judged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "evaluation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"query_text" text NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"total" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_run_id_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_items_run_candidate_idx" ON "evaluation_items" USING btree ("run_id","candidate_id");--> statement-breakpoint
CREATE INDEX "evaluation_items_run_status_idx" ON "evaluation_items" USING btree ("run_id","status");