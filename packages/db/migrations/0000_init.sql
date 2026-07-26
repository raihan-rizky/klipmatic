CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"base_url" text,
	"model" text NOT NULL,
	"encrypted_key" text NOT NULL,
	"key_iv" text NOT NULL,
	"key_tag" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "api_keys_provider_chk" CHECK ("api_keys"."provider" in ('gemini','openai_compat','anthropic_compat'))
);
--> statement-breakpoint
CREATE TABLE "clip_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"llm_run_id" uuid,
	"start_sec" numeric(10, 3) NOT NULL,
	"end_sec" numeric(10, 3) NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"title" text NOT NULL,
	"hook_text" text NOT NULL,
	"reason" text,
	"transcript_slice" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clip_candidates_range_chk" CHECK ("clip_candidates"."end_sec" > "clip_candidates"."start_sec")
);
--> statement-breakpoint
CREATE TABLE "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"candidate_id" uuid,
	"edit_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"render_status" text DEFAULT 'draft' NOT NULL,
	"output_r2_key" text,
	"duration_sec" numeric(10, 3),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "clips_render_status_chk" CHECK ("clips"."render_status" in ('draft','rendering','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_msg" text,
	"user_id" uuid,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "jobs_type_chk" CHECK ("jobs"."type" in ('ingest','transcribe','analyze','fetch_segments')),
	CONSTRAINT "jobs_status_chk" CHECK ("jobs"."status" in ('queued','running','done','failed','dead'))
);
--> statement-breakpoint
CREATE TABLE "llm_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"output" jsonb NOT NULL,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "media_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"start_sec" numeric(10, 3) NOT NULL,
	"end_sec" numeric(10, 3) NOT NULL,
	"r2_key" text NOT NULL,
	"bytes" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"locale" text DEFAULT 'id' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"title" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"external_id" text NOT NULL,
	"is_public" boolean NOT NULL,
	"owner_user_id" uuid,
	"url_original" text NOT NULL,
	"title" text,
	"channel" text,
	"duration_sec" integer,
	"thumbnail_url" text,
	"audio_r2_key" text,
	"audio_sha256" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sources_kind_chk" CHECK ("sources"."kind" in ('youtube','tiktok','gdrive','other')),
	CONSTRAINT "sources_status_chk" CHECK ("sources"."status" in ('pending','ready','failed')),
	CONSTRAINT "sources_owner_chk" CHECK (("sources"."is_public" = true and "sources"."owner_user_id" is null)
          or ("sources"."is_public" = false and "sources"."owner_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"language" text,
	"r2_key" text NOT NULL,
	"word_count" integer,
	"cost_usd" numeric(10, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD CONSTRAINT "clip_candidates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clip_candidates" ADD CONSTRAINT "clip_candidates_llm_run_id_llm_runs_id_fk" FOREIGN KEY ("llm_run_id") REFERENCES "public"."llm_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_candidate_id_clip_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."clip_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_segments" ADD CONSTRAINT "media_segments_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_owner_user_id_profiles_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."profiles"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "clip_candidates_project_idx" ON "clip_candidates" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_after","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "llm_runs_input_hash_uniq" ON "llm_runs" USING btree ("input_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "media_segments_uniq" ON "media_segments" USING btree ("source_id","start_sec","end_sec");--> statement-breakpoint
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_public_uniq" ON "sources" USING btree ("kind","external_id") WHERE is_public;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_private_uniq" ON "sources" USING btree ("kind","external_id","owner_user_id") WHERE not is_public;--> statement-breakpoint
CREATE INDEX "sources_sha_idx" ON "sources" USING btree ("audio_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "transcripts_source_model_uniq" ON "transcripts" USING btree ("source_id","model");