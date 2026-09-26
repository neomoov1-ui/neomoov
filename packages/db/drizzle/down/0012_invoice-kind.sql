-- Inverse de 0012 : retire la nature des factures.
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_kind;--> statement-breakpoint
ALTER TABLE invoices DROP COLUMN IF EXISTS kind;
