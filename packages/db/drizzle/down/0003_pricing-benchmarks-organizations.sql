-- Inverse de 0003 : retire les relevés concurrentiels, les organisations, les liens client-chauffeur et les colonnes
-- ajoutées aux devis, aux courses, aux chauffeurs, aux véhicules, aux relevés et aux réglages.
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_payment_choice;--> statement-breakpoint
DROP TABLE IF EXISTS client_driver_links;--> statement-breakpoint
DROP TABLE IF EXISTS competitor_benchmarks;--> statement-breakpoint
DROP TABLE IF EXISTS organizations;--> statement-breakpoint
ALTER TABLE settings DROP COLUMN IF EXISTS organization_id;--> statement-breakpoint
ALTER TABLE drivers DROP COLUMN IF EXISTS organization_id;--> statement-breakpoint
ALTER TABLE vehicles DROP COLUMN IF EXISTS organization_id;--> statement-breakpoint
ALTER TABLE weekly_statements DROP COLUMN IF EXISTS organization_id;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS organization_id;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS tolls_cents;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS installment_provider_ref;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS payment_choice;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS created_by_user_id;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS destination_zone_code;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS origin_zone_code;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS eta_seconds;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS estimated;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS amount_due_cents;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS promotion_discount_cents;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS alignment_discount_cents;--> statement-breakpoint
ALTER TABLE quotes DROP COLUMN IF EXISTS tolls_cents;
