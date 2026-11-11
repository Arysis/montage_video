CREATE TYPE "public"."asset_kind" AS ENUM('logo', 'character', 'video', 'image', 'music', 'font', 'voice');--> statement-breakpoint
CREATE TYPE "public"."video_format" AS ENUM('9:16', '1:1', '16:9');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'creator');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('draft', 'script', 'prompteur', 'montage', 'ready', 'scheduled', 'published');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('scheduled', 'publishing', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."render_status" AS ENUM('idle', 'queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."asset_rights" AS ENUM('own', 'licensed', 'free', 'unknown');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"rights" "asset_rights" DEFAULT 'own' NOT NULL,
	"duration_sec" real,
	"width" integer,
	"height" integer,
	"description" text,
	"font_family" text,
	"thumb_key" text,
	"render_key" text,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_kits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"logo_asset_id" uuid,
	"logo_dark_asset_id" uuid,
	"colors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"title_font" text DEFAULT 'Bricolage Grotesque' NOT NULL,
	"body_font" text DEFAULT 'IBM Plex Sans' NOT NULL,
	"subtitle_style" text DEFAULT 'boxed' NOT NULL,
	"subtitle_position" text DEFAULT 'bottom' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "project_assets" (
	"project_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "project_assets_project_id_asset_id_pk" PRIMARY KEY("project_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"idea" text NOT NULL,
	"format" "video_format" DEFAULT '9:16' NOT NULL,
	"platforms" text[] DEFAULT '{}'::text[] NOT NULL,
	"target_duration_sec" integer DEFAULT 30 NOT NULL,
	"status" "project_status" DEFAULT 'draft' NOT NULL,
	"script" jsonb,
	"selected_take_id" uuid,
	"edit_plan" jsonb,
	"directions" jsonb,
	"plan_version" integer DEFAULT 0 NOT NULL,
	"render_status" "render_status" DEFAULT 'idle' NOT NULL,
	"render_progress" integer DEFAULT 0 NOT NULL,
	"render_message" text,
	"render_key" text,
	"render_duration_sec" real,
	"render_size_bytes" integer,
	"qc_report" jsonb,
	"acknowledged_warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"caption" text,
	"hashtags" text,
	"counted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"platforms" text[] NOT NULL,
	"caption" text NOT NULL,
	"hashtags" text DEFAULT '' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "publication_status" DEFAULT 'scheduled' NOT NULL,
	"external_ids" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_accounts" (
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_user_id_platform_pk" PRIMARY KEY("user_id","platform")
);
--> statement-breakpoint
CREATE TABLE "takes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"duration_sec" real NOT NULL,
	"stopped_at_line" integer,
	"complete" boolean DEFAULT false NOT NULL,
	"words" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"publish_profile_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD CONSTRAINT "brand_kits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_assets" ADD CONSTRAINT "project_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "takes" ADD CONSTRAINT "takes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_user_idx" ON "assets" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "publications_user_idx" ON "publications" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "takes_project_idx" ON "takes" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree (lower("email"));