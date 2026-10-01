CREATE TABLE "organization_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_scope_organization_id() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"status" varchar(16) DEFAULT 'issued' NOT NULL,
	"share_cents" integer DEFAULT 0 NOT NULL,
	"driver_count" integer DEFAULT 0 NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stripe_transfer_id" varchar(100),
	"failure_code" varchar(60),
	"attempts" integer DEFAULT 0 NOT NULL,
	"offline_settlement" jsonb,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_statements_status" CHECK ("organization_statements"."status" IN ('issued', 'paid', 'failed', 'settled_offline')),
	CONSTRAINT "organization_statements_share" CHECK ("organization_statements"."share_cents" >= 0),
	CONSTRAINT "organization_statements_period" CHECK ("organization_statements"."period_end" = "organization_statements"."period_start" + 6)
);
--> statement-breakpoint
CREATE TABLE "revenue_share_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid DEFAULT app_scope_organization_id() NOT NULL,
	"driver_id" uuid,
	"mode" varchar(12) NOT NULL,
	"weekly_rent_cents" integer,
	"percentage_ppm" integer,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_share_rules_mode" CHECK (("revenue_share_rules"."mode" = 'rent' AND "revenue_share_rules"."weekly_rent_cents" > 0) OR ("revenue_share_rules"."mode" = 'percentage' AND "revenue_share_rules"."percentage_ppm" BETWEEN 1 AND 1000000)),
	CONSTRAINT "revenue_share_rules_dates" CHECK ("revenue_share_rules"."effective_to" IS NULL OR "revenue_share_rules"."effective_to" >= "revenue_share_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "vehicle_maintenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"organization_id" uuid DEFAULT app_scope_organization_id(),
	"kind" varchar(20) NOT NULL,
	"performed_on" date NOT NULL,
	"odometer_km" integer,
	"cost_cents" integer,
	"notes" text,
	"next_due_on" date,
	"next_due_km" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_maintenance_kind" CHECK ("vehicle_maintenance"."kind" IN ('inspection', 'oil_change', 'tires', 'brakes', 'battery', 'repair', 'cleaning', 'other')),
	CONSTRAINT "vehicle_maintenance_cost" CHECK ("vehicle_maintenance"."cost_cents" IS NULL OR "vehicle_maintenance"."cost_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "org_review_decision" varchar(10);--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "org_review_note" text;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "org_reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD COLUMN "org_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "network_shared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "network_mode" varchar(20) DEFAULT 'isolated' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "network_after_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_account_id" varchar(100);--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_account_onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_statements" ADD CONSTRAINT "organization_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_rules" ADD CONSTRAINT "revenue_share_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_share_rules" ADD CONSTRAINT "revenue_share_rules_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance" ADD CONSTRAINT "vehicle_maintenance_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_statements_period_unique" ON "organization_statements" USING btree ("organization_id","period_start");--> statement-breakpoint
CREATE INDEX "organization_statements_status_idx" ON "organization_statements" USING btree ("status","period_start");--> statement-breakpoint
CREATE INDEX "revenue_share_rules_org_idx" ON "revenue_share_rules" USING btree ("organization_id","effective_from");--> statement-breakpoint
CREATE INDEX "revenue_share_rules_driver_idx" ON "revenue_share_rules" USING btree ("driver_id") WHERE "revenue_share_rules"."driver_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vehicle_maintenance_vehicle_idx" ON "vehicle_maintenance" USING btree ("vehicle_id","performed_on");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_network_mode" CHECK ("organizations"."network_mode" IN ('isolated', 'neomoov_network'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_network_after" CHECK ("organizations"."network_after_minutes" BETWEEN 1 AND 1440);--> statement-breakpoint
-- Étape 23 : isolation des nouvelles tables (droits du rôle restreint, sécurité au niveau des lignes, politiques).
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicle_maintenance" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "revenue_share_rules" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_statements" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "vehicle_maintenance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "revenue_share_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "vehicle_maintenance" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_maintenance.vehicle_id AND app_scope_allows(v.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_maintenance.vehicle_id AND app_scope_allows(v.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "revenue_share_rules" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "organization_statements" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
-- Hors contexte, l'entretien prend l'organisation du véhicule (même dérivation que les déclencheurs de 0022).
CREATE OR REPLACE FUNCTION org_fill_from_vehicle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.vehicle_id IS NOT NULL THEN
    SELECT v.organization_id INTO NEW.organization_id FROM vehicles v WHERE v.id = NEW.vehicle_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER vehicle_maintenance_org_fill BEFORE INSERT ON "vehicle_maintenance" FOR EACH ROW EXECUTE FUNCTION org_fill_from_vehicle();--> statement-breakpoint
-- Courses d'une organisation encore à pourvoir (passe du réseau Neomoov).
CREATE INDEX "rides_org_open_idx" ON "rides" USING btree ("organization_id", "created_at") WHERE "state" IN ('requested', 'offering') AND "network_shared_at" IS NULL;
