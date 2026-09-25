CREATE TABLE "client_driver_links" (
	"client_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"favorite_since" timestamp with time zone,
	"rides_count" integer DEFAULT 0 NOT NULL,
	"last_ride_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_driver_links_client_id_driver_id_pk" PRIMARY KEY("client_id","driver_id")
);
--> statement-breakpoint
CREATE TABLE "competitor_benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_code" varchar(30) NOT NULL,
	"category" "vehicle_category" NOT NULL,
	"origin_zone_code" varchar(40) NOT NULL,
	"destination_zone_code" varchar(40) NOT NULL,
	"time_window" varchar(20) NOT NULL,
	"uber_price_cents" integer,
	"lyft_price_cents" integer,
	"observed_at" timestamp with time zone NOT NULL,
	"source" varchar(60) DEFAULT 'manual' NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_benchmarks_window" CHECK ("competitor_benchmarks"."time_window" IN ('weekday_morning', 'weekday_day', 'weekday_evening', 'weekday_night', 'weekend_day', 'weekend_night')),
	CONSTRAINT "competitor_benchmarks_price" CHECK ("competitor_benchmarks"."uber_price_cents" IS NOT NULL OR "competitor_benchmarks"."lyft_price_cents" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(20) DEFAULT 'platform' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_type" CHECK ("organizations"."type" IN ('platform', 'fleet', 'taxi_company', 'white_label'))
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "drivers" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "tolls_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "alignment_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "promotion_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "amount_due_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "estimated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "eta_seconds" integer;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "origin_zone_code" varchar(40);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "destination_zone_code" varchar(40);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "payment_choice" varchar(20) DEFAULT 'prepaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "installment_provider_ref" varchar(100);--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "tolls_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rides" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "weekly_statements" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "client_driver_links" ADD CONSTRAINT "client_driver_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_benchmarks" ADD CONSTRAINT "competitor_benchmarks_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_benchmarks" ADD CONSTRAINT "competitor_benchmarks_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_driver_links_driver_idx" ON "client_driver_links" USING btree ("driver_id","last_ride_at");--> statement-breakpoint
CREATE INDEX "competitor_benchmarks_lookup_idx" ON "competitor_benchmarks" USING btree ("category","origin_zone_code","destination_zone_code","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_code_unique" ON "organizations" USING btree ("code");--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_payment_choice" CHECK ("rides"."payment_choice" IN ('prepaid', 'pay_driver_after'));