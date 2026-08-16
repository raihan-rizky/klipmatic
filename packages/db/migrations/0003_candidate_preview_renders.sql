ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_chk";--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD COLUMN "preview_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD COLUMN "preview_r2_key" text;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD CONSTRAINT "clip_candidates_preview_status_chk" CHECK ("clip_candidates"."preview_status" in ('pending','rendering','ready','failed'));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('ingest','transcribe','analyze','prepare_thumbnails','fetch_segments','probe_asset','render_previews'));