ALTER TYPE "public"."agent_run_status" ADD VALUE 'skipped';--> statement-breakpoint
CREATE TABLE "agent_prompts" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"agent_code" varchar(40) NOT NULL,
	"version" smallint NOT NULL,
	"body" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"direction" varchar(8) NOT NULL,
	"author" varchar(10) NOT NULL,
	"body" text NOT NULL,
	"external_id" varchar(120),
	"agent_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_direction" CHECK ("conversation_messages"."direction" IN ('inbound', 'outbound'))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel" varchar(10) NOT NULL,
	"user_id" uuid,
	"phone" varchar(20),
	"language" varchar(2) DEFAULT 'fr' NOT NULL,
	"ride_id" uuid,
	"status" varchar(12) DEFAULT 'open' NOT NULL,
	"escalation_reason" text,
	"escalated_at" timestamp with time zone,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_channel" CHECK ("conversations"."channel" IN ('whatsapp', 'sms', 'voice', 'web', 'app')),
	CONSTRAINT "conversations_status" CHECK ("conversations"."status" IN ('open', 'escalated', 'closed')),
	CONSTRAINT "conversations_party" CHECK ("conversations"."user_id" IS NOT NULL OR "conversations"."phone" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "agents" DROP CONSTRAINT "agents_effort";--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "model" SET DEFAULT 'claude-opus-5-5';--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "model" varchar(60);--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "execution_result" jsonb;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "execution_error" text;--> statement-breakpoint
ALTER TABLE "agent_prompts" ADD CONSTRAINT "agent_prompts_agent_code_agents_code_fk" FOREIGN KEY ("agent_code") REFERENCES "public"."agents"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_ride_id_rides_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."rides"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_prompts_version_uq" ON "agent_prompts" USING btree ("agent_code","version");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_messages_external_uq" ON "conversation_messages" USING btree ("external_id") WHERE "conversation_messages"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_phone_idx" ON "conversations" USING btree ("phone","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_open_idx" ON "conversations" USING btree ("status","last_message_at") WHERE "conversations"."status" <> 'closed';--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_trigger_uq" ON "agent_runs" USING btree ("agent_code","trigger","trigger_ref") WHERE "agent_runs"."trigger_ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "approvals_run_idx" ON "approvals" USING btree ("agent_run_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_effort" CHECK ("agents"."effort" IN ('low', 'medium', 'high', 'xhigh', 'max'));--> statement-breakpoint
-- Décision du 26 septembre 2026 : les agents passent au modèle claude-opus-5-5 (moins cher, raisonnement toujours actif).
UPDATE "agents" SET "model" = 'claude-opus-5-5' WHERE "model" = 'claude-opus-5';