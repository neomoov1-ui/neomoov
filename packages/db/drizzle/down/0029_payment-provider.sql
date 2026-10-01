-- Inverse de 0022 : colonne `provider` (fournisseur de paiement) retirée des cartes et des paiements.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_provider";
ALTER TABLE "client_payment_methods" DROP CONSTRAINT IF EXISTS "client_payment_methods_provider";
ALTER TABLE "payments" DROP COLUMN IF EXISTS "provider";
ALTER TABLE "client_payment_methods" DROP COLUMN IF EXISTS "provider";
