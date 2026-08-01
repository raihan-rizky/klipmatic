CREATE TABLE "media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"candidate_clip_id" uuid,
	"source" text NOT NULL,
	"media_type" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"name" text NOT NULL,
	"storage_key" text,
	"mime_type" text NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" numeric(10, 3),
	"has_audio" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "media_assets_source_chk" CHECK ("media_assets"."source" in ('candidate','upload')),
	CONSTRAINT "media_assets_type_chk" CHECK ("media_assets"."media_type" in ('image','audio','video')),
	CONSTRAINT "media_assets_status_chk" CHECK ("media_assets"."status" in ('uploading','ready','failed','expired')),
	CONSTRAINT "media_assets_owner_chk" CHECK (("media_assets"."user_id" is not null and "media_assets"."project_id" is not null) or "media_assets"."status" = 'expired'),
	CONSTRAINT "media_assets_upload_chk" CHECK ("media_assets"."source" <> 'upload' or ("media_assets"."candidate_clip_id" is null and "media_assets"."storage_key" is not null and "media_assets"."expires_at" is not null)),
	CONSTRAINT "media_assets_candidate_chk" CHECK ("media_assets"."source" <> 'candidate' or "media_assets"."candidate_clip_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "jobs" DROP CONSTRAINT "jobs_type_chk";--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_candidate_clip_id_clips_id_fk" FOREIGN KEY ("candidate_clip_id") REFERENCES "public"."clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_candidate_uniq" ON "media_assets" USING btree ("candidate_clip_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_storage_key_uniq" ON "media_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_assets_project_idx" ON "media_assets" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "media_assets_expiry_idx" ON "media_assets" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('ingest','transcribe','analyze','fetch_segments','probe_asset'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.expire_project_media_assets()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE media_assets
     SET status = 'expired', expires_at = now(), project_id = null,
         updated_at = now()
   WHERE project_id = old.id AND source = 'upload';
  RETURN old;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER projects_expire_media_assets
BEFORE DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION public.expire_project_media_assets();
