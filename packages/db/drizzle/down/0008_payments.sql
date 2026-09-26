-- Inverse de 0008 : retire le journal des webhooks et les colonnes des paiements. Les valeurs ajoutées aux types
-- énumérés (`credit_origin.refund`, `incident_type.payment_failed`) restent : PostgreSQL ne sait pas les retirer.
DROP TABLE IF EXISTS webhook_events;--> statement-breakpoint
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_mode;--> statement-breakpoint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind;--> statement-breakpoint
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_balance_due_positive;--> statement-breakpoint
DROP INDEX IF EXISTS refunds_idempotency_unique;--> statement-breakpoint
DROP INDEX IF EXISTS payments_failed_idx;--> statement-breakpoint
DROP INDEX IF EXISTS payments_idempotency_unique;--> statement-breakpoint
DROP INDEX IF EXISTS users_stripe_customer_unique;--> statement-breakpoint
ALTER TABLE refunds DROP COLUMN IF EXISTS idempotency_key;--> statement-breakpoint
ALTER TABLE refunds DROP COLUMN IF EXISTS credit_id;--> statement-breakpoint
ALTER TABLE refunds DROP COLUMN IF EXISTS mode;--> statement-breakpoint
ALTER TABLE payments DROP COLUMN IF EXISTS captured_at;--> statement-breakpoint
ALTER TABLE payments DROP COLUMN IF EXISTS attempts;--> statement-breakpoint
ALTER TABLE payments DROP COLUMN IF EXISTS idempotency_key;--> statement-breakpoint
ALTER TABLE payments DROP COLUMN IF EXISTS stripe_payment_method_id;--> statement-breakpoint
ALTER TABLE payments DROP COLUMN IF EXISTS kind;--> statement-breakpoint
ALTER TABLE clients DROP COLUMN IF EXISTS balance_due_cents;--> statement-breakpoint
ALTER TABLE users DROP COLUMN IF EXISTS stripe_customer_id;--> statement-breakpoint
ALTER TABLE refunds ALTER COLUMN reason SET DATA TYPE varchar(60);
