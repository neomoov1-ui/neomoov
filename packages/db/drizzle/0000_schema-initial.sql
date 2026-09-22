CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."agent_mode" AS ENUM('auto', 'approval', 'manual');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed', 'awaiting_approval');--> statement-breakpoint
CREATE TYPE "public"."approval_decision" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."collected_by" AS ENUM('platform', 'driver');--> statement-breakpoint
CREATE TYPE "public"."compliance_entity_type" AS ENUM('driver', 'vehicle');--> statement-breakpoint
CREATE TYPE "public"."consent_purpose" AS ENUM('geolocation', 'marketing', 'audio_recording', 'biometrics', 'data_transfer');--> statement-breakpoint
CREATE TYPE "public"."credit_origin" AS ENUM('referral', 'promotion', 'goodwill', 'guarantee');--> statement-breakpoint
CREATE TYPE "public"."data_request_type" AS ENUM('access', 'rectification', 'deletion', 'portability', 'consent_withdrawal');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('licence', 'training', 'background_check', 'insurance', 'registration', 'mechanical_check', 'profile_photo', 'gst_qst');--> statement-breakpoint
CREATE TYPE "public"."driver_qualification" AS ENUM('saaq_authorized', 'registered');--> statement-breakpoint
CREATE TYPE "public"."driver_status" AS ENUM('pending', 'active', 'restricted', 'suspended', 'offboarded');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'decided', 'closed');--> statement-breakpoint
CREATE TYPE "public"."incident_type" AS ENUM('sos', 'complaint', 'accident', 'lost_item', 'no_show_dispute', 'model_guarantee', 'privacy', 'other');--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('fr', 'en');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('push', 'sms', 'email', 'whatsapp', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."offer_state" AS ENUM('sent', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."offer_type" AS ENUM('fixed', 'client_proposal', 'driver_counter');--> statement-breakpoint
CREATE TYPE "public"."pack_billing_status" AS ENUM('to_bill', 'billed', 'free');--> statement-breakpoint
CREATE TYPE "public"."pack_code" AS ENUM('discovery', 'essential', 'pro', 'elite', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."pack_purchase_status" AS ENUM('active', 'exhausted', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('hotel', 'restaurant', 'mall', 'bar', 'organizer');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('card_app', 'apple_pay', 'google_pay', 'cash', 'interac', 'terminal');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'authorized', 'captured', 'paid_direct', 'refunded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."promotion_type" AS ENUM('percent', 'fixed', 'free_ride', 'nth_ride');--> statement-breakpoint
CREATE TYPE "public"."ride_state" AS ENUM('quoted', 'requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress', 'completed', 'rated', 'disputed', 'no_driver', 'cancelled_by_client', 'cancelled_by_driver', 'no_show', 'interrupted', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ride_type" AS ENUM('immediate', 'scheduled');--> statement-breakpoint
CREATE TYPE "public"."sanction_type" AS ENUM('warning', 'restriction', 'suspension');--> statement-breakpoint
CREATE TYPE "public"."sev_status" AS ENUM('pending', 'sent', 'acknowledged', 'error');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('draft', 'issued', 'paid', 'charged', 'failed');--> statement-breakpoint
CREATE TYPE "public"."surcharge_code" AS ENUM('night', 'airport', 'child_seat', 'luggage', 'stop', 'waiting');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('client', 'driver', 'partner', 'investor', 'operator', 'admin', 'agent');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'blocked', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."vehicle_category" AS ENUM('neo_premium', 'neo_prestige', 'neo_xl', 'neo_limo');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('pending', 'active', 'non_compliant', 'retired');--> statement-breakpoint
CREATE TYPE "public"."zone_type" AS ENUM('service_area', 'airport', 'downtown', 'district');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_agent_code" varchar(40),
	"action" varchar(80) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" "inet",
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"version" varchar(20) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"source" varchar(30) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(10) NOT NULL,
	"push_token" varchar(300),
	"app_version" varchar(20),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_platform" CHECK ("devices"."platform" IN ('ios', 'android', 'web'))
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"code" varchar(60) PRIMARY KEY NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"percentage" integer DEFAULT 100 NOT NULL,
	"targeting" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_flags_percentage" CHECK ("feature_flags"."percentage" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"code_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "otp_codes_attempts" CHECK ("otp_codes"."attempts" BETWEEN 0 AND 10)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" uuid,
	"refresh_token_hash" varchar(128) NOT NULL,
	"family" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(80) NOT NULL,
	"scope" varchar(40) DEFAULT 'global' NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_key_scope_pk" PRIMARY KEY("key","scope")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"scope" varchar(100) DEFAULT '*' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_scope_pk" PRIMARY KEY("user_id","role","scope")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"email" varchar(254),
	"first_name" varchar(100),
	"last_name" varchar(100),
	"language" "language" DEFAULT 'fr' NOT NULL,
	"primary_role" "user_role" DEFAULT 'client' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"apple_id" varchar(255),
	"google_id" varchar(255),
	"terms_accepted_at" timestamp with time zone,
	"privacy_policy_version" varchar(20),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{6,14}$')
);
--> statement-breakpoint
CREATE TABLE "client_payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"stripe_payment_method_id" varchar(100) NOT NULL,
	"brand" varchar(30) NOT NULL,
	"last4" varchar(4) NOT NULL,
	"exp_month" integer,
	"exp_year" integer,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"business_account_id" uuid,
	"subscription_code" varchar(40),
	"ride_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_status" CHECK ("clients"."status" IN ('active', 'blocked', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "favorite_drivers" (
	"client_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favorite_drivers_client_id_driver_id_pk" PRIMARY KEY("client_id","driver_id")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" uuid NOT NULL,
	"referred_user_id" uuid,
	"code" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"referrer_credit_cents" integer DEFAULT 0 NOT NULL,
	"referred_credit_cents" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_status" CHECK ("referrals"."status" IN ('pending', 'completed', 'expired')),
	CONSTRAINT "referrals_credits_positive" CHECK ("referrals"."referrer_credit_cents" >= 0 AND "referrals"."referred_credit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"label" varchar(60) NOT NULL,
	"address" varchar(300) NOT NULL,
	"position" geography(point,4326) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"file_key" varchar(300) NOT NULL,
	"number" varchar(60),
	"issued_on" date,
	"expires_on" date,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"verified_by_user_id" uuid,
	"verified_by_agent_code" varchar(40),
	"verified_at" timestamp with time zone,
	"rejection_reason" text,
	"extracted_fields" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_locations" (
	"driver_id" uuid NOT NULL,
	"position" geography(point,4326) NOT NULL,
	"speed_mps" real,
	"heading_degrees" real,
	"accuracy_meters" real,
	"ride_id" uuid,
	"recorded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_presence" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"position" geography(point,4326) NOT NULL,
	"heading_degrees" real,
	"vehicle_id" uuid,
	"category" "vehicle_category",
	"is_available" boolean DEFAULT true NOT NULL,
	"current_ride_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"punctuality_pct" smallint DEFAULT 100 NOT NULL,
	"cancellation_count" integer DEFAULT 0 NOT NULL,
	"harsh_accelerations" integer DEFAULT 0 NOT NULL,
	"harsh_brakings" integer DEFAULT 0 NOT NULL,
	"rating" numeric(3, 2),
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"face_check_passed_at" timestamp with time zone,
	"ride_count" integer DEFAULT 0 NOT NULL,
	"earnings_cents" integer DEFAULT 0 NOT NULL,
	"online_seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "driver_shifts_earnings" CHECK ("driver_shifts"."earnings_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"public_number" varchar(12) NOT NULL,
	"status" "driver_status" DEFAULT 'pending' NOT NULL,
	"qualification" "driver_qualification",
	"gst_number" varchar(20),
	"qst_number" varchar(20),
	"trade_name" varchar(150),
	"stripe_connect_account_id" varchar(100),
	"stripe_connect_onboarded" boolean DEFAULT false NOT NULL,
	"stripe_debit_payment_method_id" varchar(100),
	"accepts_cash" boolean DEFAULT false NOT NULL,
	"accepts_interac" boolean DEFAULT false NOT NULL,
	"accepts_terminal" boolean DEFAULT false NOT NULL,
	"interac_email" varchar(254),
	"accepts_scheduled" boolean DEFAULT true NOT NULL,
	"preferred_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rating_average" numeric(3, 2) DEFAULT '5.00' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"ride_count" integer DEFAULT 0 NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"current_vehicle_id" uuid,
	"activated_at" timestamp with time zone,
	"offboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "drivers_rating_range" CHECK ("drivers"."rating_average" BETWEEN 0 AND 5)
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"code" "vehicle_category" PRIMARY KEY NOT NULL,
	"name" varchar(40) NOT NULL,
	"rank" smallint NOT NULL,
	"seats" smallint NOT NULL,
	"min_year" smallint NOT NULL,
	"allowed_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vehicle_categories_seats" CHECK ("vehicle_categories"."seats" BETWEEN 1 AND 8)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"category" "vehicle_category" NOT NULL,
	"make" varchar(60) NOT NULL,
	"model" varchar(60) NOT NULL,
	"year" smallint NOT NULL,
	"colour" varchar(40) NOT NULL,
	"plate" varchar(12) NOT NULL,
	"vin" varchar(17),
	"odometer_km" integer,
	"is_electric" boolean DEFAULT true NOT NULL,
	"seats" smallint DEFAULT 4 NOT NULL,
	"equipment" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "vehicle_status" DEFAULT 'pending' NOT NULL,
	"last_inspection_on" date,
	"next_inspection_due_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_electric_required" CHECK ("vehicles"."is_electric" = true),
	CONSTRAINT "vehicles_year" CHECK ("vehicles"."year" BETWEEN 2015 AND 2100),
	CONSTRAINT "vehicles_seats" CHECK ("vehicles"."seats" BETWEEN 1 AND 8)
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"code" varchar(30) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"time_zone" varchar(50) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flat_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"category" "vehicle_category" NOT NULL,
	"origin_zone_id" uuid NOT NULL,
	"destination_zone_id" uuid NOT NULL,
	"total_cents" integer NOT NULL,
	"bidirectional" boolean DEFAULT true NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flat_rates_positive" CHECK ("flat_rates"."total_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_code" varchar(30) NOT NULL,
	"category" "vehicle_category" NOT NULL,
	"base_cents" integer NOT NULL,
	"per_km_cents" integer NOT NULL,
	"per_minute_cents" integer NOT NULL,
	"minimum_cents" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_positive" CHECK ("pricing_rules"."base_cents" >= 0 AND "pricing_rules"."per_km_cents" >= 0 AND "pricing_rules"."per_minute_cents" >= 0 AND "pricing_rules"."minimum_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid,
	"session_key" varchar(80),
	"city_code" varchar(30) NOT NULL,
	"category" "vehicle_category" NOT NULL,
	"origin_address" varchar(300) NOT NULL,
	"origin_position" geography(point,4326) NOT NULL,
	"destination_address" varchar(300) NOT NULL,
	"destination_position" geography(point,4326) NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"distance_meters" integer NOT NULL,
	"duration_seconds" integer NOT NULL,
	"requested_at" timestamp with time zone,
	"lines" jsonb NOT NULL,
	"fare_cents" integer NOT NULL,
	"service_fee_cents" integer NOT NULL,
	"regulatory_fee_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"qst_cents" integer NOT NULL,
	"credits_applied_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"max_consented_cents" integer NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promo_code" varchar(30),
	"flat_rate_code" varchar(40),
	"ignored_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"pricing_rules_version" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotes_amounts_positive" CHECK ("quotes"."fare_cents" >= 0 AND "quotes"."total_cents" >= 0 AND "quotes"."max_consented_cents" >= "quotes"."total_cents")
);
--> statement-breakpoint
CREATE TABLE "surcharges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_code" varchar(30) NOT NULL,
	"code" "surcharge_code" NOT NULL,
	"amount_cents" integer NOT NULL,
	"per_unit" boolean DEFAULT false NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	CONSTRAINT "surcharges_positive" CHECK ("surcharges"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"city_code" varchar(30) NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(80) NOT NULL,
	"type" "zone_type" NOT NULL,
	"geometry" geography(polygon,4326) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"from_state" "ride_state",
	"to_state" "ride_state",
	"actor_user_id" uuid,
	"actor_kind" varchar(20) NOT NULL,
	"data" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_events_actor_kind" CHECK ("ride_events"."actor_kind" IN ('client', 'driver', 'operator', 'system', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "ride_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"sender_user_id" uuid,
	"sender_kind" varchar(20) NOT NULL,
	"body" text NOT NULL,
	"channel" varchar(20) DEFAULT 'in_app' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ride_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"wave" smallint DEFAULT 1 NOT NULL,
	"type" "offer_type" DEFAULT 'fixed' NOT NULL,
	"state" "offer_state" DEFAULT 'sent' NOT NULL,
	"driver_fare_cents" integer NOT NULL,
	"proposed_total_cents" integer,
	"pickup_distance_meters" integer,
	"pickup_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ride_offers_fare_positive" CHECK ("ride_offers"."driver_fare_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ride_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"author_kind" varchar(10) NOT NULL,
	"author_user_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ride_ratings_score" CHECK ("ride_ratings"."score" BETWEEN 1 AND 5),
	CONSTRAINT "ride_ratings_author_kind" CHECK ("ride_ratings"."author_kind" IN ('client', 'driver'))
);
--> statement-breakpoint
CREATE TABLE "ride_tracks" (
	"ride_id" uuid PRIMARY KEY NOT NULL,
	"track" geography(linestring,4326) NOT NULL,
	"measured_distance_meters" integer NOT NULL,
	"measured_duration_seconds" integer NOT NULL,
	"point_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_number" varchar(24) NOT NULL,
	"city_code" varchar(30) NOT NULL,
	"client_id" uuid,
	"guest_name" varchar(120),
	"guest_phone" varchar(20),
	"driver_id" uuid,
	"vehicle_id" uuid,
	"quote_id" uuid,
	"reserved_category" "vehicle_category" NOT NULL,
	"served_category" "vehicle_category",
	"state" "ride_state" DEFAULT 'requested' NOT NULL,
	"type" "ride_type" DEFAULT 'immediate' NOT NULL,
	"requested_at" timestamp with time zone,
	"flight_number" varchar(10),
	"passenger_name" varchar(120),
	"passenger_phone" varchar(20),
	"origin_address" varchar(300) NOT NULL,
	"origin_position" geography(point,4326) NOT NULL,
	"destination_address" varchar(300) NOT NULL,
	"destination_position" geography(point,4326) NOT NULL,
	"stops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"max_consented_cents" integer NOT NULL,
	"quoted_total_cents" integer NOT NULL,
	"final_price_cents" integer,
	"fare_cents" integer,
	"service_fee_cents" integer,
	"regulatory_fee_cents" integer,
	"gst_cents" integer,
	"qst_cents" integer,
	"wait_charge_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"promotion_id" uuid,
	"promotion_discount_cents" integer DEFAULT 0 NOT NULL,
	"credits_applied_cents" integer DEFAULT 0 NOT NULL,
	"model_guarantee_applied" boolean DEFAULT false NOT NULL,
	"favorite_driver_requested" boolean DEFAULT false NOT NULL,
	"cancellation_reason" varchar(40),
	"cancellation_comment" text,
	"cancellation_fee_cents" integer DEFAULT 0 NOT NULL,
	"state_timestamps" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tracking_token" varchar(24),
	"distance_meters" integer,
	"duration_seconds" integer,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rides_amounts_positive" CHECK ("rides"."max_consented_cents" >= 0 AND "rides"."quoted_total_cents" >= 0 AND "rides"."tip_cents" >= 0 AND "rides"."wait_charge_cents" >= 0 AND "rides"."cancellation_fee_cents" >= 0),
	CONSTRAINT "rides_final_within_consent" CHECK ("rides"."final_price_cents" IS NULL OR "rides"."final_price_cents" <= "rides"."max_consented_cents"),
	CONSTRAINT "rides_client_or_guest" CHECK ("rides"."client_id" IS NOT NULL OR "rides"."guest_phone" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "scheduled_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"declined_at" timestamp with time zone,
	"reminders_sent" smallint DEFAULT 0 NOT NULL,
	"operator_alerted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"remaining_cents" integer NOT NULL,
	"origin" "credit_origin" NOT NULL,
	"reference" varchar(100),
	"note" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credits_positive" CHECK ("credits"."amount_cents" > 0 AND "credits"."remaining_cents" BETWEEN 0 AND "credits"."amount_cents")
);
--> statement-breakpoint
CREATE TABLE "driver_balances" (
	"driver_id" uuid PRIMARY KEY NOT NULL,
	"balance_cents" integer DEFAULT 0 NOT NULL,
	"last_statement_id" uuid,
	"unpaid_since" timestamp with time zone,
	"suspended_for_balance_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_purchase_id" uuid NOT NULL,
	"ride_id" uuid NOT NULL,
	"from_carried_over" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pack_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"pack_code" "pack_code" NOT NULL,
	"price_paid_cents" integer NOT NULL,
	"rides_included" integer,
	"rides_remaining" integer,
	"carried_over_remaining" integer DEFAULT 0 NOT NULL,
	"activated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "pack_purchase_status" DEFAULT 'active' NOT NULL,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"next_pack_code" "pack_code",
	"rollover_done" boolean DEFAULT false NOT NULL,
	"billing" "pack_billing_status" DEFAULT 'to_bill' NOT NULL,
	"statement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_purchases_positive" CHECK ("pack_purchases"."price_paid_cents" >= 0 AND "pack_purchases"."carried_over_remaining" >= 0 AND ("pack_purchases"."rides_remaining" IS NULL OR "pack_purchases"."rides_remaining" >= 0))
);
--> statement-breakpoint
CREATE TABLE "packs" (
	"code" "pack_code" PRIMARY KEY NOT NULL,
	"name" varchar(40) NOT NULL,
	"rides_included" integer,
	"price_cents" integer NOT NULL,
	"validity_days" integer NOT NULL,
	"rollover_allowed" boolean DEFAULT false NOT NULL,
	"priorities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "packs_price_positive" CHECK ("packs"."price_cents" >= 0),
	CONSTRAINT "packs_rides_positive" CHECK ("packs"."rides_included" IS NULL OR "packs"."rides_included" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"client_id" uuid,
	"method" "payment_method" NOT NULL,
	"stripe_payment_intent_id" varchar(100),
	"authorized_cents" integer DEFAULT 0 NOT NULL,
	"captured_cents" integer DEFAULT 0 NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"collected_by" "collected_by" DEFAULT 'platform' NOT NULL,
	"driver_confirmed_cents" integer,
	"failure_code" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amounts_positive" CHECK ("payments"."authorized_cents" >= 0 AND "payments"."captured_cents" >= 0 AND "payments"."tip_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotion_uses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promotion_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"ride_id" uuid,
	"discount_cents" integer NOT NULL,
	"driver_compensation_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_uses_positive" CHECK ("promotion_uses"."discount_cents" >= 0 AND "promotion_uses"."driver_compensation_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(30) NOT NULL,
	"name" varchar(100) NOT NULL,
	"type" "promotion_type" NOT NULL,
	"value" integer NOT NULL,
	"max_discount_cents" integer,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"waives_fees" boolean DEFAULT false NOT NULL,
	"global_limit" integer,
	"per_client_limit" integer DEFAULT 1 NOT NULL,
	"budget_cents" integer,
	"spent_cents" integer DEFAULT 0 NOT NULL,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotions_value_positive" CHECK ("promotions"."value" >= 0 AND "promotions"."spent_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"reason" varchar(60) NOT NULL,
	"decided_by_user_id" uuid,
	"decided_by_agent_code" varchar(40),
	"stripe_refund_id" varchar(100),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount_cents" > 0),
	CONSTRAINT "refunds_status" CHECK ("refunds"."status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"amount_cents" integer NOT NULL,
	"ride_id" uuid,
	"pack_purchase_id" uuid,
	"label" varchar(120) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "statement_lines_amount_positive" CHECK ("statement_lines"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "weekly_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"platform_fares_cents" integer DEFAULT 0 NOT NULL,
	"platform_fare_taxes_cents" integer DEFAULT 0 NOT NULL,
	"tips_cents" integer DEFAULT 0 NOT NULL,
	"packs_billed_cents" integer DEFAULT 0 NOT NULL,
	"direct_fees_collected_cents" integer DEFAULT 0 NOT NULL,
	"credits_and_bonuses_cents" integer DEFAULT 0 NOT NULL,
	"adjustments_cents" integer DEFAULT 0 NOT NULL,
	"credits_cents" integer DEFAULT 0 NOT NULL,
	"debits_cents" integer DEFAULT 0 NOT NULL,
	"net_cents" integer DEFAULT 0 NOT NULL,
	"status" "statement_status" DEFAULT 'draft' NOT NULL,
	"stripe_transfer_id" varchar(100),
	"stripe_charge_id" varchar(100),
	"failure_code" varchar(60),
	"attempts" integer DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"pdf_key" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_statements_period" CHECK ("weekly_statements"."period_end" = "weekly_statements"."period_start" + 6)
);
--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" "compliance_entity_type" NOT NULL,
	"entity_id" uuid NOT NULL,
	"type" varchar(40) NOT NULL,
	"due_on" date NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"suspension_applied_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_checks_status" CHECK ("compliance_checks"."status" IN ('pending', 'resolved', 'overdue'))
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "data_request_type" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_on" date NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"file_key" varchar(300),
	"handled_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "geolocation_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"format" varchar(20) NOT NULL,
	"file_key" varchar(300),
	"ride_count" integer DEFAULT 0 NOT NULL,
	"transmitted_at" timestamp with time zone,
	"acknowledgement" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid,
	"type" "incident_type" NOT NULL,
	"severity" "incident_severity" DEFAULT 'medium' NOT NULL,
	"reported_by_user_id" uuid,
	"reported_by_kind" varchar(20) NOT NULL,
	"description" text NOT NULL,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"decision" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"privacy_breach" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_reporter_kind" CHECK ("incidents"."reported_by_kind" IN ('client', 'driver', 'operator', 'system', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"number" varchar(20) NOT NULL,
	"supplier_sequence" integer NOT NULL,
	"supplier_name" varchar(150) NOT NULL,
	"supplier_gst_number" varchar(20),
	"supplier_qst_number" varchar(20),
	"lines" jsonb NOT NULL,
	"fare_cents" integer NOT NULL,
	"service_fee_cents" integer NOT NULL,
	"regulatory_fee_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"qst_cents" integer NOT NULL,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"sev_transaction_id" varchar(100),
	"sev_status" "sev_status" DEFAULT 'pending' NOT NULL,
	"pdf_key" varchar(300),
	"qr_payload" text,
	"credit_note_of_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amounts_positive" CHECK ("invoices"."fare_cents" >= 0 AND "invoices"."total_cents" >= 0 AND "invoices"."gst_cents" >= 0 AND "invoices"."qst_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "redevance_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"remittance_period" varchar(7) NOT NULL,
	"remitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redevance_ledger_positive" CHECK ("redevance_ledger"."amount_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retention_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows_processed" integer DEFAULT 0 NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"driver_id" uuid NOT NULL,
	"incident_id" uuid,
	"type" "sanction_type" NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sev_transmissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"adapter" varchar(30) NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"status" "sev_status" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"fare_gst_cents" integer NOT NULL,
	"fare_qst_cents" integer NOT NULL,
	"fee_gst_cents" integer NOT NULL,
	"fee_qst_cents" integer NOT NULL,
	"period" varchar(7) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_ledger_positive" CHECK ("tax_ledger"."fare_gst_cents" >= 0 AND "tax_ledger"."fare_qst_cents" >= 0 AND "tax_ledger"."fee_gst_cents" >= 0 AND "tax_ledger"."fee_qst_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "business_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(150) NOT NULL,
	"legal_name" varchar(200),
	"billing_email" varchar(254) NOT NULL,
	"monthly_billing" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_centers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"monthly_cap_cents" integer,
	"approver_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "business_accounts_discount" CHECK ("business_accounts"."discount_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE "business_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"cost_center" varchar(60),
	"monthly_cap_cents" integer,
	"role" varchar(20) DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'prospect' NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "partner_type" NOT NULL,
	"name" varchar(150) NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"concierge_code" varchar(20),
	"terms" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_status" CHECK ("partners"."status" IN ('active', 'paused', 'ended'))
);
--> statement-breakpoint
CREATE TABLE "vehicle_financings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investor_id" uuid NOT NULL,
	"vehicle_id" uuid,
	"principal_cents" integer NOT NULL,
	"rate_bps" integer NOT NULL,
	"term_months" integer NOT NULL,
	"schedule" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_financings_positive" CHECK ("vehicle_financings"."principal_cents" > 0 AND "vehicle_financings"."rate_bps" >= 0 AND "vehicle_financings"."term_months" > 0)
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_code" varchar(40) NOT NULL,
	"trigger" varchar(60) NOT NULL,
	"trigger_ref" varchar(120),
	"input" jsonb,
	"output" jsonb,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"mode" "agent_mode" DEFAULT 'approval' NOT NULL,
	"model" varchar(60) DEFAULT 'claude-opus-5' NOT NULL,
	"effort" varchar(10) DEFAULT 'low' NOT NULL,
	"system_prompt_key" varchar(100),
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"thresholds" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"auto_since" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_effort" CHECK ("agents"."effort" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"proposed_action" varchar(80) NOT NULL,
	"data" jsonb NOT NULL,
	"justification" text,
	"decision" "approval_decision" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid,
	"recipient_address" varchar(254),
	"channel" "notification_channel" NOT NULL,
	"template" varchar(80) NOT NULL,
	"language" varchar(2) DEFAULT 'fr' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_message_id" varchar(120),
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_payment_methods" ADD CONSTRAINT "client_payment_methods_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorite_drivers" ADD CONSTRAINT "favorite_drivers_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_places" ADD CONSTRAINT "saved_places_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_documents" ADD CONSTRAINT "driver_documents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_presence" ADD CONSTRAINT "driver_presence_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_shifts" ADD CONSTRAINT "driver_shifts_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_vehicle_categories_code_fk" FOREIGN KEY ("category") REFERENCES "public"."vehicle_categories"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat_rates" ADD CONSTRAINT "flat_rates_origin_zone_id_zones_id_fk" FOREIGN KEY ("origin_zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flat_rates" ADD CONSTRAINT "flat_rates_destination_zone_id_zones_id_fk" FOREIGN KEY ("destination_zone_id") REFERENCES "public"."zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surcharges" ADD CONSTRAINT "surcharges_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zones" ADD CONSTRAINT "zones_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_events" ADD CONSTRAINT "ride_events_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_messages" ADD CONSTRAINT "ride_messages_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_offers" ADD CONSTRAINT "ride_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_ratings" ADD CONSTRAINT "ride_ratings_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_tracks" ADD CONSTRAINT "ride_tracks_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_city_code_cities_code_fk" FOREIGN KEY ("city_code") REFERENCES "public"."cities"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rides" ADD CONSTRAINT "rides_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_assignments" ADD CONSTRAINT "scheduled_assignments_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_assignments" ADD CONSTRAINT "scheduled_assignments_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_balances" ADD CONSTRAINT "driver_balances_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_consumptions" ADD CONSTRAINT "pack_consumptions_pack_purchase_id_pack_purchases_id_fk" FOREIGN KEY ("pack_purchase_id") REFERENCES "public"."pack_purchases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_consumptions" ADD CONSTRAINT "pack_consumptions_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD CONSTRAINT "pack_purchases_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_purchases" ADD CONSTRAINT "pack_purchases_pack_code_packs_code_fk" FOREIGN KEY ("pack_code") REFERENCES "public"."packs"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_promotion_id_promotions_id_fk" FOREIGN KEY ("promotion_id") REFERENCES "public"."promotions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_uses" ADD CONSTRAINT "promotion_uses_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_lines" ADD CONSTRAINT "statement_lines_statement_id_weekly_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."weekly_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_statements" ADD CONSTRAINT "weekly_statements_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redevance_ledger" ADD CONSTRAINT "redevance_ledger_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sev_transmissions" ADD CONSTRAINT "sev_transmissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_ledger" ADD CONSTRAINT "tax_ledger_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_ledger" ADD CONSTRAINT "tax_ledger_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_account_id_business_accounts_id_fk" FOREIGN KEY ("business_account_id") REFERENCES "public"."business_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_financings" ADD CONSTRAINT "vehicle_financings_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_code_agents_code_fk" FOREIGN KEY ("agent_code") REFERENCES "public"."agents"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_time_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "consents_user_purpose_idx" ON "consents" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_push_token_unique" ON "devices" USING btree ("push_token") WHERE "devices"."push_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "otp_codes_phone_idx" ON "otp_codes" USING btree ("phone","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_family_idx" ON "sessions" USING btree ("family");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_apple_id_unique" ON "users" USING btree ("apple_id") WHERE "users"."apple_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_id_unique" ON "users" USING btree ("google_id") WHERE "users"."google_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "client_payment_methods_client_idx" ON "client_payment_methods" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "client_payment_methods_stripe_unique" ON "client_payment_methods" USING btree ("stripe_payment_method_id");--> statement-breakpoint
CREATE UNIQUE INDEX "clients_user_unique" ON "clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "favorite_drivers_driver_idx" ON "favorite_drivers" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referrals_code_unique" ON "referrals" USING btree ("code");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "saved_places_client_idx" ON "saved_places" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "driver_documents_driver_type_idx" ON "driver_documents" USING btree ("driver_id","type");--> statement-breakpoint
CREATE INDEX "driver_documents_expiry_idx" ON "driver_documents" USING btree ("expires_on") WHERE "driver_documents"."status" = 'approved';--> statement-breakpoint
CREATE INDEX "driver_locations_driver_time_idx" ON "driver_locations" USING btree ("driver_id","recorded_at");--> statement-breakpoint
CREATE INDEX "driver_locations_ride_idx" ON "driver_locations" USING btree ("ride_id") WHERE "driver_locations"."ride_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "driver_presence_position_gist" ON "driver_presence" USING gist ("position");--> statement-breakpoint
CREATE INDEX "driver_presence_available_idx" ON "driver_presence" USING btree ("is_available","category");--> statement-breakpoint
CREATE UNIQUE INDEX "driver_scores_period_unique" ON "driver_scores" USING btree ("driver_id","period_start");--> statement-breakpoint
CREATE INDEX "driver_shifts_driver_idx" ON "driver_shifts" USING btree ("driver_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_unique" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_public_number_unique" ON "drivers" USING btree ("public_number");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_stripe_connect_unique" ON "drivers" USING btree ("stripe_connect_account_id") WHERE "drivers"."stripe_connect_account_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "drivers_status_online_idx" ON "drivers" USING btree ("status","is_online");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_categories_rank_unique" ON "vehicle_categories" USING btree ("rank");--> statement-breakpoint
CREATE INDEX "vehicles_driver_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_unique" ON "vehicles" USING btree ("plate");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_unique" ON "vehicles" USING btree ("vin") WHERE "vehicles"."vin" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "flat_rates_code_unique" ON "flat_rates" USING btree ("code");--> statement-breakpoint
CREATE INDEX "flat_rates_lookup_idx" ON "flat_rates" USING btree ("category","origin_zone_id","destination_zone_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_lookup_idx" ON "pricing_rules" USING btree ("city_code","category","valid_from");--> statement-breakpoint
CREATE INDEX "quotes_client_idx" ON "quotes" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "quotes_valid_until_idx" ON "quotes" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "surcharges_city_code_idx" ON "surcharges" USING btree ("city_code","code");--> statement-breakpoint
CREATE UNIQUE INDEX "zones_code_unique" ON "zones" USING btree ("city_code","code");--> statement-breakpoint
CREATE INDEX "zones_geometry_gist" ON "zones" USING gist ("geometry");--> statement-breakpoint
CREATE INDEX "ride_events_ride_idx" ON "ride_events" USING btree ("ride_id","occurred_at");--> statement-breakpoint
CREATE INDEX "ride_messages_ride_idx" ON "ride_messages" USING btree ("ride_id","created_at");--> statement-breakpoint
CREATE INDEX "ride_offers_ride_idx" ON "ride_offers" USING btree ("ride_id","wave");--> statement-breakpoint
CREATE INDEX "ride_offers_driver_idx" ON "ride_offers" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ride_offers_pending_unique" ON "ride_offers" USING btree ("ride_id","driver_id") WHERE "ride_offers"."state" = 'sent';--> statement-breakpoint
CREATE UNIQUE INDEX "ride_ratings_unique" ON "ride_ratings" USING btree ("ride_id","author_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_public_number_unique" ON "rides" USING btree ("public_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rides_tracking_token_unique" ON "rides" USING btree ("tracking_token") WHERE "rides"."tracking_token" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "rides_client_idx" ON "rides" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "rides_driver_idx" ON "rides" USING btree ("driver_id","created_at");--> statement-breakpoint
CREATE INDEX "rides_state_idx" ON "rides" USING btree ("state") WHERE "rides"."state" IN ('requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress');--> statement-breakpoint
CREATE INDEX "rides_scheduled_idx" ON "rides" USING btree ("requested_at") WHERE "rides"."type" = 'scheduled';--> statement-breakpoint
CREATE INDEX "rides_origin_gist" ON "rides" USING gist ("origin_position");--> statement-breakpoint
CREATE INDEX "scheduled_assignments_ride_idx" ON "scheduled_assignments" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_assignments_active_unique" ON "scheduled_assignments" USING btree ("ride_id") WHERE "scheduled_assignments"."declined_at" IS NULL;--> statement-breakpoint
CREATE INDEX "credits_user_idx" ON "credits" USING btree ("user_id") WHERE "credits"."remaining_cents" > 0;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_consumptions_ride_unique" ON "pack_consumptions" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "pack_consumptions_purchase_idx" ON "pack_consumptions" USING btree ("pack_purchase_id");--> statement-breakpoint
CREATE INDEX "pack_purchases_driver_idx" ON "pack_purchases" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "pack_purchases_expiry_idx" ON "pack_purchases" USING btree ("expires_at") WHERE "pack_purchases"."status" = 'active';--> statement-breakpoint
CREATE INDEX "payments_ride_idx" ON "payments" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_intent_unique" ON "payments" USING btree ("stripe_payment_intent_id") WHERE "payments"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "promotion_uses_promotion_idx" ON "promotion_uses" USING btree ("promotion_id");--> statement-breakpoint
CREATE INDEX "promotion_uses_client_idx" ON "promotion_uses" USING btree ("client_id","promotion_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotions_code_unique" ON "promotions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "statement_lines_statement_idx" ON "statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_statements_period_unique" ON "weekly_statements" USING btree ("driver_id","period_start");--> statement-breakpoint
CREATE INDEX "weekly_statements_status_idx" ON "weekly_statements" USING btree ("status","period_start");--> statement-breakpoint
CREATE INDEX "compliance_checks_entity_idx" ON "compliance_checks" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "compliance_checks_due_idx" ON "compliance_checks" USING btree ("due_on") WHERE "compliance_checks"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "data_requests_open_idx" ON "data_requests" USING btree ("due_on") WHERE "data_requests"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "data_requests_user_idx" ON "data_requests" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "geolocation_exports_period_unique" ON "geolocation_exports" USING btree ("period_start","period_end","format");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status","severity");--> statement-breakpoint
CREATE INDEX "incidents_ride_idx" ON "incidents" USING btree ("ride_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_sequence_unique" ON "invoices" USING btree ("driver_id","supplier_sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_ride_unique" ON "invoices" USING btree ("ride_id") WHERE "invoices"."credit_note_of_id" IS NULL;--> statement-breakpoint
CREATE INDEX "invoices_sev_status_idx" ON "invoices" USING btree ("sev_status") WHERE "invoices"."sev_status" IN ('pending', 'error');--> statement-breakpoint
CREATE UNIQUE INDEX "redevance_ledger_ride_unique" ON "redevance_ledger" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "redevance_ledger_period_idx" ON "redevance_ledger" USING btree ("remittance_period");--> statement-breakpoint
CREATE INDEX "retention_jobs_type_idx" ON "retention_jobs" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "sanctions_driver_idx" ON "sanctions" USING btree ("driver_id","starts_at");--> statement-breakpoint
CREATE INDEX "sev_transmissions_invoice_idx" ON "sev_transmissions" USING btree ("invoice_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_ledger_ride_unique" ON "tax_ledger" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "tax_ledger_period_idx" ON "tax_ledger" USING btree ("period");--> statement-breakpoint
CREATE INDEX "tax_ledger_driver_period_idx" ON "tax_ledger" USING btree ("driver_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "business_members_unique" ON "business_members" USING btree ("business_account_id","user_id");--> statement-breakpoint
CREATE INDEX "business_members_user_idx" ON "business_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "investors_user_unique" ON "investors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_concierge_code_unique" ON "partners" USING btree ("concierge_code") WHERE "partners"."concierge_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vehicle_financings_investor_idx" ON "vehicle_financings" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_code","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_status_idx" ON "agent_runs" USING btree ("status") WHERE "agent_runs"."status" IN ('running', 'awaiting_approval');--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("created_at") WHERE "approvals"."decision" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."sent_at" IS NULL AND "notifications"."error" IS NULL;