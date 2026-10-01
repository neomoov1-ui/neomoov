ALTER TABLE "client_payment_methods" ADD COLUMN "provider" varchar(20) DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider" varchar(20) DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_provider" CHECK ("client_payment_methods"."provider" IN ('stripe', 'square', 'mock'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider" CHECK ("payments"."provider" IN ('stripe', 'square', 'mock'));--> statement-breakpoint
-- Étape 26 : les cartes et paiements déjà enregistrés par le simulateur portent son nom (références `pm_mock_…`, `pi_mock_…`) ; le reste vient de Stripe.
UPDATE "client_payment_methods" SET "provider" = 'mock' WHERE "stripe_payment_method_id" LIKE 'pm_mock_%';--> statement-breakpoint
UPDATE "payments" SET "provider" = 'mock' WHERE "stripe_payment_intent_id" LIKE 'pi_mock_%' OR "stripe_payment_method_id" LIKE 'pm_mock_%';
