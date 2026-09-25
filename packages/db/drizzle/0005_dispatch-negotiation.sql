CREATE TABLE "ride_dispatches" (
	"ride_id" uuid PRIMARY KEY NOT NULL,
	"mode" varchar(20) DEFAULT 'fixed' NOT NULL,
	"status" varchar(20) DEFAULT 'searching' NOT NULL,
	"wave" smallint DEFAULT 0 NOT NULL,
	"radius_index" smallint DEFAULT -1 NOT NULL,
	"candidate_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_cursor" smallint DEFAULT 0 NOT NULL,
	"excluded_driver_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"offered_driver_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priority" boolean DEFAULT false NOT NULL,
	"offers_sent" integer DEFAULT 0 NOT NULL,
	"next_action_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"held_reason" varchar(200),
	"held_by_user_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_position" geography(point,4326),
	"movement_checked_at" timestamp with time zone,
	"negotiation_ends_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_dispatches_status" CHECK ("ride_dispatches"."status" IN ('searching', 'offering', 'held', 'assigned', 'exhausted', 'window_closed', 'cancelled')),
	CONSTRAINT "ride_dispatches_mode" CHECK ("ride_dispatches"."mode" IN ('fixed', 'negotiation'))
);
--> statement-breakpoint
DROP INDEX "ride_offers_pending_unique";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "experiment_group" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "experiment_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD COLUMN "displayed_total_cents" integer;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD COLUMN "reason" varchar(40);--> statement-breakpoint
ALTER TABLE "ride_offers" ADD COLUMN "reason_text" text;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "proposed_total_cents" integer;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "agreed_total_cents" integer;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "negotiation_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "ride_dispatches" ADD CONSTRAINT "ride_dispatches_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ride_dispatches_due_idx" ON "ride_dispatches" USING btree ("status","next_action_at");--> statement-breakpoint
CREATE INDEX "ride_offers_pending_idx" ON "ride_offers" USING btree ("expires_at") WHERE "ride_offers"."state" = 'sent';--> statement-breakpoint
CREATE UNIQUE INDEX "ride_offers_pending_unique" ON "ride_offers" USING btree ("ride_id","driver_id","type") WHERE "ride_offers"."state" = 'sent';--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_experiment_group" CHECK ("clients"."experiment_group" IS NULL OR "clients"."experiment_group" IN ('fixed', 'negotiation'));--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_agreed_within_consent" CHECK ("rides"."agreed_total_cents" IS NULL OR "rides"."agreed_total_cents" <= "rides"."max_consented_cents");--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_negotiation_mode" CHECK ("rides"."negotiation_mode" IS NULL OR "rides"."negotiation_mode" IN ('fixed', 'negotiation'));--> statement-breakpoint
UPDATE settings SET value = '{"eta": 0.55, "rating": 0.2, "fairness": 0.15, "zone": 0.1, "favouriteBonus": 100, "otherFavouriteBonus": 50, "unlimitedBonus": 5, "fairnessDecayMinutes": 20}'::jsonb, description = 'Poids de la formule du score (section 5.4) : 0,55 x ETA + 0,20 x (5 - note) x 4 + 0,15 x equite + 0,10 x zone, moins les bonus' WHERE key = 'dispatch.score_weights' AND scope = 'global';
