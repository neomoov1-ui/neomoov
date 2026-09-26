CREATE TABLE "credit_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credit_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_uses_positive" CHECK ("credit_uses"."amount_cents" > 0)
);
--> statement-breakpoint
DROP INDEX "referrals_code_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar(12);--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "kind" varchar(10) DEFAULT 'client' NOT NULL;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "threshold_rides" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "is_rluxe_ev_tenant" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "guarantee_outcome" varchar(20);--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "driver_fare_protected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_uses" ADD CONSTRAINT "credit_uses_credit_id_credits_id_fk" FOREIGN KEY ("credit_id") REFERENCES "public"."credits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_uses" ADD CONSTRAINT "credit_uses_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_uses_credit_ride_unique" ON "credit_uses" USING btree ("credit_id","ride_id");--> statement-breakpoint
CREATE INDEX "credit_uses_ride_idx" ON "credit_uses" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_unique" ON "users" USING btree ("referral_code") WHERE "users"."referral_code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_referred_kind_unique" ON "referrals" USING btree ("referred_user_id","kind") WHERE "referrals"."referred_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "referrals_code_idx" ON "referrals" USING btree ("code");--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_kind" CHECK ("referrals"."kind" IN ('client', 'driver'));