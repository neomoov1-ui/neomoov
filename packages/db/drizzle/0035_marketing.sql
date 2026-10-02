-- Phase 1 « Neomoov entreprise autonome » (2 octobre 2026), marketing automatisé (agent E) : calendrier de contenu (content_items), commentaires des publications (content_comments), tâches de référencement (seo_tasks). Inverse : down/0035_marketing.sql.
-- Renumérotation à la fusion (branche integration-ef) : migration provisoire 0032_marketing de la branche autonome-e-marketing, renumérotée 0035 après 0034_sales.
-- Rejouable : la 0032_marketing provisoire est déjà appliquée sur la base de développement ; IF NOT EXISTS, DROP ... IF EXISTS et blocs DO rendent ce fichier sans effet là où les objets existent déjà.
CREATE TABLE IF NOT EXISTS "content_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_item_id" uuid NOT NULL,
	"external_id" varchar(200) NOT NULL,
	"author" varchar(120),
	"body" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"intent" varchar(12) NOT NULL,
	"outcome" varchar(12) NOT NULL,
	"reply_body" text,
	"reply_external_id" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_comments_intent" CHECK ("content_comments"."intent" IN ('thanks', 'hours', 'booking', 'other')),
	CONSTRAINT "content_comments_outcome" CHECK ("content_comments"."outcome" IN ('replied', 'forwarded', 'escalated', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_of" date NOT NULL,
	"space" varchar(20) NOT NULL,
	"format" varchar(12) NOT NULL,
	"language" varchar(2) DEFAULT 'fr' NOT NULL,
	"title" varchar(200),
	"body" text NOT NULL,
	"caption" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cta" varchar(12) DEFAULT 'none' NOT NULL,
	"visual_headline" varchar(160),
	"media_key" varchar(300),
	"media_kind" varchar(10),
	"media_status" varchar(12) DEFAULT 'none' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" varchar(40),
	"agent_run_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"external_id" varchar(200),
	"external_url" varchar(500),
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"measure_count" smallint DEFAULT 0 NOT NULL,
	"measure_due_at" timestamp with time zone,
	"comments_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_items_space" CHECK ("content_items"."space" IN ('site_blog', 'academy', 'google_business', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'snapchat', 'newsletter')),
	CONSTRAINT "content_items_format" CHECK ("content_items"."format" IN ('post', 'article', 'reel', 'story', 'video', 'short', 'newsletter')),
	CONSTRAINT "content_items_language" CHECK ("content_items"."language" IN ('fr', 'en')),
	CONSTRAINT "content_items_cta" CHECK ("content_items"."cta" IN ('reserve', 'academy', 'preregister', 'none')),
	CONSTRAINT "content_items_status" CHECK ("content_items"."status" IN ('draft', 'approved', 'scheduled', 'published', 'failed', 'measured', 'rejected')),
	CONSTRAINT "content_items_media_status" CHECK ("content_items"."media_status" IN ('none', 'pending', 'html', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "seo_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_of" date NOT NULL,
	"action" varchar(20) NOT NULL,
	"target_kind" varchar(8) NOT NULL,
	"target_ref" varchar(300),
	"target_title" varchar(200),
	"target_url" varchar(500),
	"keyword" varchar(120),
	"justification" text NOT NULL,
	"proposal" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(12) DEFAULT 'proposed' NOT NULL,
	"metrics_before" jsonb,
	"metrics_after" jsonb,
	"external_id" varchar(100),
	"external_url" varchar(500),
	"agent_run_id" uuid,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"applied_at" timestamp with time zone,
	"measure_due_at" timestamp with time zone,
	"measured_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seo_tasks_action" CHECK ("seo_tasks"."action" IN ('new_page', 'new_article', 'fix_title', 'fix_description', 'faq_question', 'internal_link')),
	CONSTRAINT "seo_tasks_target_kind" CHECK ("seo_tasks"."target_kind" IN ('page', 'post', 'site')),
	CONSTRAINT "seo_tasks_status" CHECK ("seo_tasks"."status" IN ('proposed', 'approved', 'applied', 'rejected', 'failed', 'measured'))
);
--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "content_comments" ADD CONSTRAINT "content_comments_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "content_items" ADD CONSTRAINT "content_items_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "seo_tasks" ADD CONSTRAINT "seo_tasks_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_comments_external_uq" ON "content_comments" USING btree ("content_item_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_comments_item_idx" ON "content_comments" USING btree ("content_item_id","posted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_week_idx" ON "content_items" USING btree ("week_of","space");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_status_idx" ON "content_items" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_measure_idx" ON "content_items" USING btree ("measure_due_at") WHERE "content_items"."status" = 'published';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_tasks_status_idx" ON "seo_tasks" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "seo_tasks_week_idx" ON "seo_tasks" USING btree ("week_of");--> statement-breakpoint
-- Phase 1 « entreprise autonome » (2 octobre 2026) : tables réservées à la plateforme (aucune politique d'isolation : fermées au rôle restreint des organisations).
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_items" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_comments" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "content_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "seo_tasks" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "seo_tasks" ENABLE ROW LEVEL SECURITY;
