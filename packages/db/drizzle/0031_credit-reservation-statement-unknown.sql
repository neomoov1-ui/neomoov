-- Revue du 2 octobre 2026 : réservation des crédits à la réservation (constat 3, colonne credit_uses.status) et état « unknown » des relevés sans réponse du prestataire (constat 7). Inverse : down/0031_credit-reservation-statement-unknown.sql.
ALTER TYPE "public"."statement_status" ADD VALUE 'unknown';--> statement-breakpoint
ALTER TABLE "organization_statements" DROP CONSTRAINT "organization_statements_status";--> statement-breakpoint
ALTER TABLE "credit_uses" ADD COLUMN "status" varchar(10) DEFAULT 'consumed' NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_uses" ADD CONSTRAINT "credit_uses_status" CHECK ("credit_uses"."status" IN ('reserved', 'consumed', 'released'));--> statement-breakpoint
ALTER TABLE "organization_statements" ADD CONSTRAINT "organization_statements_status" CHECK ("organization_statements"."status" IN ('issued', 'paid', 'failed', 'settled_offline', 'unknown'));