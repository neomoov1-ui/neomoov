-- Phase 1 « Neomoov entreprise autonome » (2 octobre 2026), direction commerciale (agent F) : prospects d'affaires, fil des contacts, relances, appels sortants ; entité `prospect` dans crm_records. Inverse : down/0034_sales.sql.
-- Renumérotation à la fusion (branche integration-ef) : migration provisoire 0032_sales de la branche autonome-f-ventes, renumérotée 0034 après 0032_booster et 0033_inbox-channels de main.
-- Rejouable : la 0032_sales provisoire est déjà appliquée sur la base de développement ; IF NOT EXISTS, DROP ... IF EXISTS et blocs DO rendent ce fichier sans effet là où les objets existent déjà.
CREATE TABLE IF NOT EXISTS "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_type" varchar(20) NOT NULL,
	"target_id" uuid NOT NULL,
	"prospect_id" uuid,
	"channel" varchar(12) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" varchar(12) DEFAULT 'scheduled' NOT NULL,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 3 NOT NULL,
	"reference_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" varchar(40),
	"language" varchar(2) DEFAULT 'fr' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followups_target_type" CHECK ("followups"."target_type" IN ('prospect', 'quote', 'driver_candidate', 'web_booking')),
	CONSTRAINT "followups_status" CHECK ("followups"."status" IN ('scheduled', 'sent', 'replied', 'closed', 'cancelled')),
	CONSTRAINT "followups_channel" CHECK ("followups"."channel" IN ('email', 'whatsapp', 'sms', 'push')),
	CONSTRAINT "followups_attempts" CHECK ("followups"."attempt" >= 0 AND "followups"."max_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbound_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"script_key" varchar(60) DEFAULT 'b2b_intro' NOT NULL,
	"assistant_id" varchar(100),
	"phone_number_id" varchar(100),
	"to_phone" varchar(20),
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"status" varchar(12) DEFAULT 'scheduled' NOT NULL,
	"vapi_call_id" varchar(100),
	"result" varchar(20),
	"summary" text,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer,
	"recording_consent" boolean DEFAULT false NOT NULL,
	"meeting_at" timestamp with time zone,
	"callback_at" timestamp with time zone,
	"attempt" smallint DEFAULT 0 NOT NULL,
	"agent_run_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbound_calls_status" CHECK ("outbound_calls"."status" IN ('scheduled', 'calling', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "outbound_calls_result" CHECK ("outbound_calls"."result" IS NULL OR "outbound_calls"."result" IN ('meeting', 'callback', 'not_interested', 'voicemail', 'no_answer', 'do_not_contact', 'failed'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospect_touches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prospect_id" uuid NOT NULL,
	"channel" varchar(12) NOT NULL,
	"direction" varchar(8) NOT NULL,
	"summary" varchar(500) NOT NULL,
	"result" varchar(40),
	"ref" varchar(120),
	"agent_run_id" uuid,
	"user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_touches_channel" CHECK ("prospect_touches"."channel" IN ('email', 'whatsapp', 'sms', 'call', 'meeting', 'note')),
	CONSTRAINT "prospect_touches_direction" CHECK ("prospect_touches"."direction" IN ('outbound', 'inbound'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_name" varchar(200) NOT NULL,
	"legal_name" varchar(200),
	"segment" varchar(20) DEFAULT 'other' NOT NULL,
	"size" varchar(10) DEFAULT 'unknown' NOT NULL,
	"interest" varchar(10) DEFAULT 'unknown' NOT NULL,
	"source" varchar(20) NOT NULL,
	"source_ref" varchar(120),
	"website" varchar(300),
	"city" varchar(80),
	"rating" numeric(2, 1),
	"review_count" integer,
	"contact_name" varchar(120),
	"contact_role" varchar(80),
	"email" varchar(254),
	"phone" varchar(20),
	"whatsapp_ok" boolean DEFAULT false NOT NULL,
	"language" varchar(2) DEFAULT 'fr' NOT NULL,
	"consent_basis" varchar(30) DEFAULT 'published_address' NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_source" varchar(120),
	"unsubscribed_at" timestamp with time zone,
	"score" smallint DEFAULT 0 NOT NULL,
	"stage" varchar(20) DEFAULT 'new' NOT NULL,
	"stage_reason" text,
	"lost_at" timestamp with time zone,
	"hubspot_id" varchar(100),
	"next_action" varchar(40),
	"next_action_at" timestamp with time zone,
	"sequence_key" varchar(60),
	"sequence_channel" varchar(12),
	"first_contact_at" timestamp with time zone,
	"last_quote" jsonb,
	"lead_id" uuid,
	"organization_id" uuid,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_segment" CHECK ("prospects"."segment" IN ('hotel', 'business', 'agency', 'event', 'clinic', 'school', 'other')),
	CONSTRAINT "prospects_size" CHECK ("prospects"."size" IN ('small', 'medium', 'large', 'unknown')),
	CONSTRAINT "prospects_interest" CHECK ("prospects"."interest" IN ('low', 'medium', 'high', 'unknown')),
	CONSTRAINT "prospects_source" CHECK ("prospects"."source" IN ('google_places', 'csv_import', 'web_lead', 'manual')),
	CONSTRAINT "prospects_stage" CHECK ("prospects"."stage" IN ('new', 'qualified', 'contacted', 'replied', 'meeting', 'quote', 'won', 'lost', 'do_not_contact')),
	CONSTRAINT "prospects_consent_basis" CHECK ("prospects"."consent_basis" IN ('published_address', 'form', 'existing_relationship', 'referral', 'none')),
	CONSTRAINT "prospects_score" CHECK ("prospects"."score" BETWEEN 0 AND 100),
	CONSTRAINT "prospects_language" CHECK ("prospects"."language" IN ('fr', 'en'))
);
--> statement-breakpoint
ALTER TABLE "crm_records" DROP CONSTRAINT IF EXISTS "crm_records_entity_type";--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "followups" ADD CONSTRAINT "followups_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "outbound_calls" ADD CONSTRAINT "outbound_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "prospect_touches" ADD CONSTRAINT "prospect_touches_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "prospect_touches" ADD CONSTRAINT "prospect_touches_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "prospects" ADD CONSTRAINT "prospects_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "prospects" ADD CONSTRAINT "prospects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "followups_open_target_uq" ON "followups" USING btree ("target_type","target_id") WHERE "followups"."status" IN ('scheduled', 'sent');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "followups_due_idx" ON "followups" USING btree ("due_at") WHERE "followups"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "followups_prospect_idx" ON "followups" USING btree ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "outbound_calls_vapi_uq" ON "outbound_calls" USING btree ("vapi_call_id") WHERE "outbound_calls"."vapi_call_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_calls_due_idx" ON "outbound_calls" USING btree ("scheduled_at") WHERE "outbound_calls"."status" = 'scheduled';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outbound_calls_prospect_idx" ON "outbound_calls" USING btree ("prospect_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospect_touches_prospect_idx" ON "prospect_touches" USING btree ("prospect_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospects_email_uq" ON "prospects" USING btree ("email") WHERE "prospects"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospects_source_ref_uq" ON "prospects" USING btree ("source","source_ref") WHERE "prospects"."source_ref" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "prospects_lead_uq" ON "prospects" USING btree ("lead_id") WHERE "prospects"."lead_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_stage_idx" ON "prospects" USING btree ("stage","score");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_next_action_idx" ON "prospects" USING btree ("next_action_at") WHERE "prospects"."next_action_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "prospects_created_idx" ON "prospects" USING btree ("source","created_at");--> statement-breakpoint
ALTER TABLE "crm_records" DROP CONSTRAINT IF EXISTS "crm_records_entity_type";--> statement-breakpoint
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_entity_type" CHECK ("crm_records"."entity_type" IN ('lead', 'business_account', 'organization', 'prospect'));--> statement-breakpoint
-- Tables réservées à la plateforme (docs/isolation.md) : droits du rôle restreint et sécurité au niveau des lignes activée sans politique, donc fermées aux organisations.
GRANT SELECT, INSERT, UPDATE, DELETE ON "prospects" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "prospect_touches" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "followups" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbound_calls" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "prospects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prospect_touches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "followups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbound_calls" ENABLE ROW LEVEL SECURITY;
