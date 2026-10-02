CREATE TABLE "driver_alert_settings" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"session_start" varchar(5) NOT NULL,
	"session_end" varchar(5) NOT NULL,
	"time_zone" varchar(40) DEFAULT 'America/Toronto' NOT NULL,
	"reminders" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"styles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_markers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_alert_settings_times" CHECK ("driver_alert_settings"."session_start" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "driver_alert_settings"."session_end" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "performance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"organization_id" uuid DEFAULT app_scope_organization_id(),
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"date" date NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"start_energy_percent" smallint,
	"end_energy_percent" smallint,
	"start_odometer_km" integer,
	"end_odometer_km" integer,
	"online_minutes" integer,
	"driving_minutes" integer,
	"rides_count" integer,
	"rides_cents" integer DEFAULT 0 NOT NULL,
	"tips_cents" integer DEFAULT 0 NOT NULL,
	"promotions_cents" integer DEFAULT 0 NOT NULL,
	"energy_cents" integer DEFAULT 0 NOT NULL,
	"cleaning_cents" integer DEFAULT 0 NOT NULL,
	"points" integer,
	"other_notes" varchar(500),
	"source" varchar(12) DEFAULT 'manual' NOT NULL,
	"screenshots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analysis" jsonb,
	"analysis_count" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"pdf_key" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_logs_status" CHECK ("performance_logs"."status" IN ('draft', 'analysed', 'confirmed')),
	CONSTRAINT "performance_logs_source" CHECK ("performance_logs"."source" IN ('manual', 'screenshot')),
	CONSTRAINT "performance_logs_amounts" CHECK ("performance_logs"."rides_cents" >= 0 AND "performance_logs"."tips_cents" >= 0 AND "performance_logs"."promotions_cents" >= 0 AND "performance_logs"."energy_cents" >= 0 AND "performance_logs"."cleaning_cents" >= 0),
	CONSTRAINT "performance_logs_energy" CHECK (("performance_logs"."start_energy_percent" IS NULL OR "performance_logs"."start_energy_percent" BETWEEN 0 AND 100) AND ("performance_logs"."end_energy_percent" IS NULL OR "performance_logs"."end_energy_percent" BETWEEN 0 AND 100))
);
--> statement-breakpoint
CREATE TABLE "vehicle_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"organization_id" uuid DEFAULT app_scope_organization_id(),
	"status" varchar(10) DEFAULT 'draft' NOT NULL,
	"inspected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"inspected_on" date NOT NULL,
	"plate" varchar(12),
	"accessory_number" varchar(40),
	"driver_name" varchar(120),
	"licence_number" varchar(255),
	"odometer_km" integer,
	"energy_percent" smallint,
	"warning_light_on" boolean DEFAULT false NOT NULL,
	"warning_light_reason" varchar(300),
	"items" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"body_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"all_items_checked" boolean DEFAULT false NOT NULL,
	"severity" varchar(10) DEFAULT 'ok' NOT NULL,
	"notes" text,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analysis" jsonb,
	"analysis_count" integer DEFAULT 0 NOT NULL,
	"confirmed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"pdf_key" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_inspections_status" CHECK ("vehicle_inspections"."status" IN ('draft', 'analysed', 'archived')),
	CONSTRAINT "vehicle_inspections_severity" CHECK ("vehicle_inspections"."severity" IN ('ok', 'minor', 'major')),
	CONSTRAINT "vehicle_inspections_energy" CHECK ("vehicle_inspections"."energy_percent" IS NULL OR "vehicle_inspections"."energy_percent" BETWEEN 0 AND 100),
	CONSTRAINT "vehicle_inspections_odometer" CHECK ("vehicle_inspections"."odometer_km" IS NULL OR "vehicle_inspections"."odometer_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "driver_alert_settings" ADD CONSTRAINT "driver_alert_settings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_logs" ADD CONSTRAINT "performance_logs_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ADD CONSTRAINT "vehicle_inspections_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_logs_driver_idx" ON "performance_logs" USING btree ("driver_id","date");--> statement-breakpoint
CREATE INDEX "performance_logs_org_idx" ON "performance_logs" USING btree ("organization_id","date");--> statement-breakpoint
CREATE INDEX "vehicle_inspections_driver_idx" ON "vehicle_inspections" USING btree ("driver_id","inspected_on");--> statement-breakpoint
CREATE INDEX "vehicle_inspections_org_day_idx" ON "vehicle_inspections" USING btree ("organization_id","inspected_on");--> statement-breakpoint
CREATE INDEX "vehicle_inspections_major_idx" ON "vehicle_inspections" USING btree ("inspected_on") WHERE "vehicle_inspections"."severity" = 'major' AND "vehicle_inspections"."status" = 'archived';--> statement-breakpoint
-- Neomoov Booster (phase 1, agent G) : isolation des nouvelles tables (droits du rôle restreint, sécurité au niveau des
-- lignes, politiques par chauffeur) et organisation dérivée du chauffeur hors contexte (fonction de 0023).
GRANT SELECT, INSERT, UPDATE, DELETE ON "vehicle_inspections" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "performance_logs" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "driver_alert_settings" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "vehicle_inspections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "performance_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_alert_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "vehicle_inspections" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "vehicle_inspections".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "vehicle_inspections".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "performance_logs" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "performance_logs".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "performance_logs".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_alert_settings" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_alert_settings".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_alert_settings".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE TRIGGER vehicle_inspections_org_fill BEFORE INSERT ON "vehicle_inspections" FOR EACH ROW EXECUTE FUNCTION org_fill_from_driver();--> statement-breakpoint
CREATE TRIGGER performance_logs_org_fill BEFORE INSERT ON "performance_logs" FOR EACH ROW EXECUTE FUNCTION org_fill_from_driver();
