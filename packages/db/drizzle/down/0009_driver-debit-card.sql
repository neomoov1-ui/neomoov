-- Inverse de 0009 : retire la description de la carte de prélèvement du chauffeur.
ALTER TABLE drivers DROP COLUMN IF EXISTS stripe_debit_card_last4;--> statement-breakpoint
ALTER TABLE drivers DROP COLUMN IF EXISTS stripe_debit_card_brand;
