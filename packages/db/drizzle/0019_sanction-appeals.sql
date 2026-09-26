CREATE TABLE "sanction_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sanction_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"kind" varchar(10) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sanction_appeals_kind" CHECK ("sanction_appeals"."kind" IN ('response', 'appeal')),
	CONSTRAINT "sanction_appeals_status" CHECK ("sanction_appeals"."status" IN ('open', 'upheld', 'overturned'))
);
--> statement-breakpoint
ALTER TABLE "sanction_appeals" ADD CONSTRAINT "sanction_appeals_sanction_id_sanctions_id_fk" FOREIGN KEY ("sanction_id") REFERENCES "public"."sanctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanction_appeals" ADD CONSTRAINT "sanction_appeals_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sanction_appeals_status_idx" ON "sanction_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sanction_appeals_driver_idx" ON "sanction_appeals" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sanction_appeals_one_open" ON "sanction_appeals" USING btree ("sanction_id") WHERE "sanction_appeals"."status" = 'open';