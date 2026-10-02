-- Boîte de réception unifiée (phase 1 « entreprise autonome », 2 octobre 2026) : canaux email et social des conversations, adresse, réseau, nature, objet, référence de fil ; métadonnées et relais manuel des messages ; canal de notification social. Aucune nouvelle table (politiques org_isolation existantes). Inverse : down/0032_inbox-channels.sql.
ALTER TYPE "public"."notification_channel" ADD VALUE 'social';--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_channel";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_party";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "relay_status" varchar(10);--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "relayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN "relayed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "address" varchar(254);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "network" varchar(20);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "kind" varchar(12) DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "display_name" varchar(120);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "subject" varchar(255);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "thread_ref" varchar(255);--> statement-breakpoint
CREATE INDEX "conversation_messages_relay_idx" ON "conversation_messages" USING btree ("created_at") WHERE "conversation_messages"."relay_status" = 'pending';--> statement-breakpoint
CREATE INDEX "conversations_address_idx" ON "conversations" USING btree ("address","last_message_at");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_relay_status" CHECK ("conversation_messages"."relay_status" IS NULL OR "conversation_messages"."relay_status" IN ('pending', 'done'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind" CHECK ("conversations"."kind" IN ('message', 'comment', 'missed_call', 'voicemail', 'automated'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel" CHECK ("conversations"."channel" IN ('whatsapp', 'sms', 'voice', 'web', 'app', 'email', 'social'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_party" CHECK ("conversations"."user_id" IS NOT NULL OR "conversations"."phone" IS NOT NULL OR "conversations"."address" IS NOT NULL);