ALTER TABLE "ride_ratings" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_ratings" ADD COLUMN "excluded_reason" text;--> statement-breakpoint
ALTER TABLE "ride_ratings" ADD COLUMN "excluded_by_user_id" uuid;