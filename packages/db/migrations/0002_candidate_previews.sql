ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_chk";--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD COLUMN "thumbnail_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD COLUMN "thumbnail_r2_key" text;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD CONSTRAINT "clip_candidates_thumbnail_status_chk" CHECK ("clip_candidates"."thumbnail_status" in ('pending','ready','failed'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('ingest','transcribe','analyze','prepare_thumbnails','fetch_segments','probe_asset'));