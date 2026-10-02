-- Boîte de réception unifiée (phase 1 « entreprise autonome », agent D, 2 octobre 2026), renumérotée 0033 à la fusion (0032 = Booster) : canaux email et social des conversations, adresse, réseau, nature, objet, référence de fil ; métadonnées et relais manuel des messages ; canal de notification social. Aucune nouvelle table (politiques org_isolation existantes). Rejouable : la base de développement l'avait déjà reçue sous le numéro 0032. Inverse : down/0033_inbox-channels.sql.
ALTER TYPE "public"."notification_channel" ADD VALUE IF NOT EXISTS 'social';--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_channel";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_party";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_kind";--> statement-breakpoint
ALTER TABLE "conversation_messages" DROP CONSTRAINT IF EXISTS "conversation_messages_relay_status";--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "relay_status" varchar(10);--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "relayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD COLUMN IF NOT EXISTS "relayed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "address" varchar(254);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "network" varchar(20);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "kind" varchar(12) DEFAULT 'message' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "display_name" varchar(120);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "subject" varchar(255);--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "thread_ref" varchar(255);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversation_messages_relay_idx" ON "conversation_messages" USING btree ("created_at") WHERE "conversation_messages"."relay_status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "conversations_address_idx" ON "conversations" USING btree ("address","last_message_at");--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_relay_status" CHECK ("conversation_messages"."relay_status" IS NULL OR "conversation_messages"."relay_status" IN ('pending', 'done'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind" CHECK ("conversations"."kind" IN ('message', 'comment', 'missed_call', 'voicemail', 'automated'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel" CHECK ("conversations"."channel" IN ('whatsapp', 'sms', 'voice', 'web', 'app', 'email', 'social'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_party" CHECK ("conversations"."user_id" IS NOT NULL OR "conversations"."phone" IS NOT NULL OR "conversations"."address" IS NOT NULL);
