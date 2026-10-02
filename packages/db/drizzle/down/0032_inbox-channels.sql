-- Inverse de 0032 : boîte de réception unifiée (canaux email et social, relais manuel, canal de notification social).
-- La valeur 'social' du type notification_channel ne se retire pas (PostgreSQL) : les avis concernés sont marqués en erreur puis laissés tels quels.
UPDATE "notifications" SET error = COALESCE(error, 'channel_removed') WHERE channel = 'social';
-- Conversations des nouveaux canaux : retirées avec leurs messages (cascade) avant la contrainte d'origine.
DELETE FROM "conversations" WHERE channel IN ('email', 'social');
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_party";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_channel";
ALTER TABLE "conversations" DROP CONSTRAINT IF EXISTS "conversations_kind";
ALTER TABLE "conversation_messages" DROP CONSTRAINT IF EXISTS "conversation_messages_relay_status";
DROP INDEX IF EXISTS "conversations_address_idx";
DROP INDEX IF EXISTS "conversation_messages_relay_idx";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "address";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "network";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "kind";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "display_name";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "subject";
ALTER TABLE "conversations" DROP COLUMN IF EXISTS "thread_ref";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "metadata";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "relay_status";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "relayed_at";
ALTER TABLE "conversation_messages" DROP COLUMN IF EXISTS "relayed_by_user_id";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_channel" CHECK ("conversations"."channel" IN ('whatsapp', 'sms', 'voice', 'web', 'app'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_party" CHECK ("conversations"."user_id" IS NOT NULL OR "conversations"."phone" IS NOT NULL);
