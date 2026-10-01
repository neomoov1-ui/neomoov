CREATE TABLE "driver_cost_entries" (
	"driver_id" uuid NOT NULL,
	"month" varchar(7) NOT NULL,
	"vehicle_cents" integer DEFAULT 0 NOT NULL,
	"insurance_cents" integer DEFAULT 0 NOT NULL,
	"energy_cents" integer DEFAULT 0 NOT NULL,
	"maintenance_cents" integer DEFAULT 0 NOT NULL,
	"phone_cents" integer DEFAULT 0 NOT NULL,
	"other_cents" integer DEFAULT 0 NOT NULL,
	"external_revenue_cents" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_cost_entries_driver_id_month_pk" PRIMARY KEY("driver_id","month"),
	CONSTRAINT "driver_cost_entries_month" CHECK ("driver_cost_entries"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "driver_cost_entries_amounts" CHECK ("driver_cost_entries"."vehicle_cents" >= 0 AND "driver_cost_entries"."insurance_cents" >= 0 AND "driver_cost_entries"."energy_cents" >= 0 AND "driver_cost_entries"."maintenance_cents" >= 0 AND "driver_cost_entries"."phone_cents" >= 0 AND "driver_cost_entries"."other_cents" >= 0 AND "driver_cost_entries"."external_revenue_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "driver_pilot_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"offer_id" uuid,
	"decision" varchar(10) NOT NULL,
	"score" varchar(10) NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"auto_accepted_at" timestamp with time zone,
	"cancelled_in_grace_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_pilot_decisions_decision" CHECK ("driver_pilot_decisions"."decision" IN ('accept', 'manual', 'reject')),
	CONSTRAINT "driver_pilot_decisions_score" CHECK ("driver_pilot_decisions"."score" IN ('green', 'yellow', 'red'))
);
--> statement-breakpoint
CREATE TABLE "driver_pilot_settings" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"multi_app_mode" boolean DEFAULT false NOT NULL,
	"consent_at" timestamp with time zone,
	"consent_version" varchar(20),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_cost_entries" ADD CONSTRAINT "driver_cost_entries_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_pilot_decisions" ADD CONSTRAINT "driver_pilot_decisions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_pilot_decisions" ADD CONSTRAINT "driver_pilot_decisions_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_pilot_decisions" ADD CONSTRAINT "driver_pilot_decisions_offer_id_ride_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."ride_offers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_pilot_settings" ADD CONSTRAINT "driver_pilot_settings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_pilot_decisions_driver_idx" ON "driver_pilot_decisions" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "driver_pilot_decisions_ride_idx" ON "driver_pilot_decisions" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_pilot_decisions_offer_unique" ON "driver_pilot_decisions" USING btree ("offer_id") WHERE "driver_pilot_decisions"."offer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "driver_pilot_settings_enabled_idx" ON "driver_pilot_settings" USING btree ("enabled");--> statement-breakpoint
-- Isolation par organisation (étape 20) : droits du rôle restreint et politique par chauffeur, comme les autres tables driver_*.
GRANT SELECT, INSERT, UPDATE, DELETE ON "driver_pilot_settings" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "driver_pilot_decisions" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "driver_cost_entries" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "driver_pilot_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_pilot_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "driver_cost_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_pilot_settings" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_pilot_settings".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_pilot_settings".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_pilot_decisions" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_pilot_decisions".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_pilot_decisions".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_cost_entries" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_cost_entries".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_cost_entries".driver_id AND app_scope_allows(d.organization_id)));
