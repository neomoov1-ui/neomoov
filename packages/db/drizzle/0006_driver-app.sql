CREATE TABLE "driver_training_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"module_code" varchar(40) NOT NULL,
	"score_pct" smallint NOT NULL,
	"passed" boolean NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_training_results_score" CHECK ("driver_training_results"."score_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
ALTER TABLE "driver_scores" ADD COLUMN "distance_meters" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_scores" ADD COLUMN "completed_rides" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_scores" ADD COLUMN "timed_rides" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "driver_scores" ADD COLUMN "punctual_rides" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "spoken_languages" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "experience_years" smallint;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "training_certified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "driver_training_results" ADD CONSTRAINT "driver_training_results_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "driver_training_results_driver_idx" ON "driver_training_results" USING btree ("driver_id","module_code");--> statement-breakpoint
-- Chauffeurs déjà actifs avant la formation Neomoov : attestation reprise à leur date d'activation (aucun blocage rétroactif).
UPDATE "drivers" SET "training_certified_at" = COALESCE("activated_at", now()) WHERE "status" IN ('active', 'restricted') AND "training_certified_at" IS NULL;
