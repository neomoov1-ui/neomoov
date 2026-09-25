ALTER TABLE "rides" ADD COLUMN "guest_language" varchar(2);--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "special_requests" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "waited_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "contact_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "idempotency_key" varchar(80);--> statement-breakpoint
CREATE UNIQUE INDEX "rides_idempotency_key_unique" ON "rides" USING btree ("idempotency_key") WHERE "rides"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rides_quote_unique" ON "rides" USING btree ("quote_id") WHERE "rides"."quote_id" IS NOT NULL;