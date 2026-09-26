CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(20) NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80),
	"phone" varchar(20) NOT NULL,
	"email" varchar(254),
	"city" varchar(80),
	"message" text,
	"language" varchar(2) DEFAULT 'fr' NOT NULL,
	"source" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'new' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_kind" CHECK ("leads"."kind" IN ('driver', 'business', 'partner')),
	CONSTRAINT "leads_status" CHECK ("leads"."status" IN ('new', 'contacted', 'converted', 'discarded'))
);
--> statement-breakpoint
CREATE TABLE "staff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_notes_entity_type" CHECK ("staff_notes"."entity_type" IN ('driver', 'client', 'ride', 'vehicle'))
);
--> statement-breakpoint
CREATE INDEX "leads_kind_status_idx" ON "leads" USING btree ("kind","status","created_at");--> statement-breakpoint
CREATE INDEX "leads_phone_idx" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "staff_notes_entity_idx" ON "staff_notes" USING btree ("entity_type","entity_id","created_at");