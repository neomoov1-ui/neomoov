-- Inverse de 0004 : retire la clé d'idempotence, les compteurs d'attente et de contact, les demandes spéciales et la langue de l'invité.
DROP INDEX IF EXISTS rides_quote_unique;--> statement-breakpoint
DROP INDEX IF EXISTS rides_idempotency_key_unique;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS idempotency_key;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS contact_attempts;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS waited_seconds;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS special_requests;--> statement-breakpoint
ALTER TABLE rides DROP COLUMN IF EXISTS guest_language;
