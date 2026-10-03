-- Redevance Neomoov (décision du fondateur du 3 octobre 2026) : taux par chauffeur (5 à 10 %, 10 % par défaut) et une
-- ligne par course terminée. Distincte de la redevance gouvernementale (redevance_ledger), inchangée. Rejouable.
CREATE TABLE IF NOT EXISTS "platform_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"base_cents" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"payment_channel" varchar(10) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_fees_rate_range" CHECK ("platform_fees"."rate_bps" BETWEEN 500 AND 1000),
	CONSTRAINT "platform_fees_amounts" CHECK ("platform_fees"."base_cents" >= 0 AND "platform_fees"."amount_cents" >= 0 AND "platform_fees"."amount_cents" = ("platform_fees"."base_cents"::bigint * "platform_fees"."rate_bps" + 5000) / 10000),
	CONSTRAINT "platform_fees_channel" CHECK ("platform_fees"."payment_channel" IN ('platform', 'direct'))
);
--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "platform_fee_bps" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "platform_fees" ADD CONSTRAINT "platform_fees_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "platform_fees_ride_unique" ON "platform_fees" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_fees_driver_idx" ON "platform_fees" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "platform_fees_created_idx" ON "platform_fees" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "drivers" ADD CONSTRAINT "drivers_platform_fee_bps_range" CHECK ("drivers"."platform_fee_bps" BETWEEN 500 AND 1000); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Isolation (famille « par course », comme redevance_ledger et tax_ledger) : organisation de la course.
GRANT SELECT, INSERT, UPDATE, DELETE ON "platform_fees" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "platform_fees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN CREATE POLICY org_isolation ON "platform_fees" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "platform_fees".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "platform_fees".ride_id AND app_scope_allows(r.organization_id))); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Réglage global : taux des nouveaux chauffeurs (10 %), modifiable dans My Hub (Paramètres) entre 500 et 1000.
INSERT INTO "settings" ("key", "scope", "value", "description") VALUES ('drivers.platform_fee_default_bps', 'global', '1000'::jsonb, 'Redevance Neomoov des nouveaux chauffeurs, en points de base (1000 = 10 %), bornée de 500 à 1000 (décision du fondateur, 3 octobre 2026)') ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Priorité des packs à la répartition des réservations planifiées : les chauffeurs avec pack seuls pendant 120 s, puis tous.
INSERT INTO "settings" ("key", "scope", "value", "description") VALUES ('dispatch.pack_priority_seconds', 'global', '120'::jsonb, 'Réservation planifiée : délai pendant lequel seuls les chauffeurs avec pack reçoivent l''offre, avant ceux sans pack (3 octobre 2026)') ON CONFLICT DO NOTHING;
