-- Inverse de 0005 : retire la répartition (ride_dispatches), les colonnes de négociation des courses et des offres, le groupe de test des clients.
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_negotiation_mode;--> statement-breakpoint
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_agreed_within_consent;--> statement-breakpoint
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_experiment_group;--> statement-breakpoint
DROP INDEX IF EXISTS ride_offers_pending_unique;--> statement-breakpoint
DROP INDEX IF EXISTS ride_offers_pending_idx;--> statement-breakpoint
CREATE UNIQUE INDEX ride_offers_pending_unique ON ride_offers USING btree (ride_id, driver_id) WHERE state = 'sent';--> statement-breakpoint
DROP TABLE IF EXISTS ride_dispatches;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS negotiation_mode;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS agreed_total_cents;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS proposed_total_cents;--> statement-breakpoint
ALTER TABLE ride_offers DROP COLUMN IF EXISTS reason_text;--> statement-breakpoint
ALTER TABLE ride_offers DROP COLUMN IF EXISTS reason;--> statement-breakpoint
ALTER TABLE ride_offers DROP COLUMN IF EXISTS displayed_total_cents;--> statement-breakpoint
ALTER TABLE clients DROP COLUMN IF EXISTS experiment_assigned_at;--> statement-breakpoint
ALTER TABLE clients DROP COLUMN IF EXISTS experiment_group;--> statement-breakpoint
UPDATE settings SET value = '{"distance": 40, "rating": 20, "fairness": 15, "favourite": 15, "zone": 10, "unlimitedBonus": 5}'::jsonb WHERE key = 'dispatch.score_weights' AND scope = 'global';
