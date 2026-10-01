CREATE TABLE "crm_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(30) NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" varchar(20) NOT NULL,
	"object_type" varchar(20) NOT NULL,
	"external_id" varchar(100),
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_records_entity_type" CHECK ("crm_records"."entity_type" IN ('lead', 'business_account', 'organization')),
	CONSTRAINT "crm_records_object_type" CHECK ("crm_records"."object_type" IN ('contact', 'company', 'deal', 'note')),
	CONSTRAINT "crm_records_status" CHECK ("crm_records"."status" IN ('pending', 'synced', 'error', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "leads" DROP CONSTRAINT "leads_kind";--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "consent_at" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_records_unique" ON "crm_records" USING btree ("provider","entity_type","entity_id","object_type");--> statement-breakpoint
CREATE INDEX "crm_records_status_idx" ON "crm_records" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "crm_records_entity_idx" ON "crm_records" USING btree ("entity_type","entity_id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_kind" CHECK ("leads"."kind" IN ('driver', 'business', 'partner', 'training'));--> statement-breakpoint
-- Étape 25 : table réservée à la plateforme (aucune politique d'isolation : fermée au rôle restreint des organisations).
GRANT SELECT, INSERT, UPDATE, DELETE ON "crm_records" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "crm_records" ENABLE ROW LEVEL SECURITY;
