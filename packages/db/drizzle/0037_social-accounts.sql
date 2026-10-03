-- Réseaux sociaux (3 octobre 2026, agent S1) : comptes des dix espaces de Neomoov connectés dans My Hub (social_accounts), un par espace ; jetons et secrets chiffrés par FieldCipher dans credentials. Inverse : down/0037_social-accounts.sql.
-- Rejouable : IF NOT EXISTS partout. Le type notification_channel garde sa valeur social (0033) : l'écart du schéma Drizzle n'est pas repris ici.
CREATE TABLE IF NOT EXISTS "social_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space" varchar(20) NOT NULL,
	"mode" varchar(12) DEFAULT 'direct' NOT NULL,
	"status" varchar(20) DEFAULT 'not_connected' NOT NULL,
	"validation" varchar(20) DEFAULT 'not_connected' NOT NULL,
	"account_id" varchar(120),
	"account_name" varchar(200),
	"profile_url" varchar(500),
	"show_on_site" boolean DEFAULT true NOT NULL,
	"credentials" text,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"access_expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"last_error" text,
	"app_approved_at" timestamp with time zone,
	"connected_at" timestamp with time zone,
	"connected_by_user_id" uuid,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_accounts_space" CHECK ("social_accounts"."space" IN ('site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel')),
	CONSTRAINT "social_accounts_mode" CHECK ("social_accounts"."mode" IN ('direct', 'aggregator', 'manual')),
	CONSTRAINT "social_accounts_status" CHECK ("social_accounts"."status" IN ('not_connected', 'connected', 'invalid', 'expired', 'pending_approval')),
	CONSTRAINT "social_accounts_validation" CHECK ("social_accounts"."validation" IN ('not_connected', 'connected', 'invalid', 'expired', 'pending_approval'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "social_accounts_space_uq" ON "social_accounts" USING btree ("space");--> statement-breakpoint
-- Table réservée à la plateforme (aucune politique d'isolation : fermée au rôle restreint des organisations).
GRANT SELECT, INSERT, UPDATE, DELETE ON "social_accounts" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "social_accounts" ENABLE ROW LEVEL SECURITY;
