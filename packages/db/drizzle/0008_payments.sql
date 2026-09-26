ALTER TYPE "public"."credit_origin" ADD VALUE 'refund';--> statement-breakpoint
ALTER TYPE "public"."incident_type" ADD VALUE 'payment_failed' BEFORE 'other';--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" varchar(100) PRIMARY KEY NOT NULL,
	"provider" varchar(20) NOT NULL,
	"type" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_status" CHECK ("webhook_events"."status" IN ('received', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "reason" SET DATA TYPE varchar(300);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" varchar(100);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "balance_due_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "kind" varchar(20) DEFAULT 'ride' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_payment_method_id" varchar(100);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "idempotency_key" varchar(120);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "mode" varchar(10) DEFAULT 'refund' NOT NULL;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "credit_id" uuid;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "idempotency_key" varchar(120);--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "webhook_events" USING btree ("status","received_at") WHERE "webhook_events"."status" IN ('received', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "users_stripe_customer_unique" ON "users" USING btree ("stripe_customer_id") WHERE "users"."stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_unique" ON "payments" USING btree ("idempotency_key") WHERE "payments"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_failed_idx" ON "payments" USING btree ("status","updated_at") WHERE "payments"."status" = 'failed';--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idempotency_unique" ON "refunds" USING btree ("idempotency_key") WHERE "refunds"."idempotency_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_balance_due_positive" CHECK ("clients"."balance_due_cents" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_kind" CHECK ("payments"."kind" IN ('ride', 'tip', 'cancellation_fee', 'no_show_fee', 'balance'));--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_mode" CHECK ("refunds"."mode" IN ('refund', 'credit'));