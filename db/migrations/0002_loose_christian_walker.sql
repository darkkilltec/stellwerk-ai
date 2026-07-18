ALTER TABLE "candidates" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD CONSTRAINT "candidates_slug_unique" UNIQUE("slug");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_slug_unique" UNIQUE("slug");