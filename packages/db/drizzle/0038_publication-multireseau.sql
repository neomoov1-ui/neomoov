-- Chantier « Réseaux sociaux » du 3 octobre 2026 (agent S2) : publication multiréseau de My Hub. Publications (content_groups :
-- texte de base, campagne et référence d'un lot importé), contenus rattachés à leur publication, diffusion par connecteur ou
-- relais manuel, variante du visuel par réseau, espaces Telegram et chaîne WhatsApp. Numéro 0038 réservé à S2 (S1 prend 0037) :
-- la session principale renumérote à la fusion si besoin. Rejouable (IF NOT EXISTS, blocs DO). Inverse : down/0038_publication-multireseau.sql.
CREATE TABLE IF NOT EXISTS "content_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign" varchar(60),
	"ref" varchar(40),
	"source" varchar(10) DEFAULT 'composer' NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"short_text" varchar(300) NOT NULL,
	"image_text" varchar(80),
	"cta" varchar(12) DEFAULT 'none' NOT NULL,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"photo_hints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"day" smallint,
	"pillar" varchar(20),
	"audience" varchar(20),
	"notes" text,
	"sensitive" boolean DEFAULT false NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_groups_source" CHECK ("content_groups"."source" IN ('composer', 'import')),
	CONSTRAINT "content_groups_cta" CHECK ("content_groups"."cta" IN ('reserve', 'academy', 'preregister', 'none'))
);
--> statement-breakpoint
ALTER TABLE "content_items" DROP CONSTRAINT IF EXISTS "content_items_space";--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "group_id" uuid;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "delivery" varchar(8) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "visual" jsonb;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "relayed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_items" ADD COLUMN IF NOT EXISTS "relayed_by_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "content_groups_campaign_ref_uq" ON "content_groups" USING btree ("campaign","ref") WHERE "content_groups"."campaign" IS NOT NULL AND "content_groups"."ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_groups_created_idx" ON "content_groups" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "content_items" ADD CONSTRAINT "content_items_group_id_content_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."content_groups"("id") ON DELETE cascade ON UPDATE no action; EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_group_idx" ON "content_items" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_items_relay_idx" ON "content_items" USING btree ("scheduled_at") WHERE "content_items"."delivery" = 'manual' AND "content_items"."status" = 'scheduled';--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "content_items" ADD CONSTRAINT "content_items_delivery" CHECK ("content_items"."delivery" IN ('auto', 'manual')); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN ALTER TABLE "content_items" ADD CONSTRAINT "content_items_space" CHECK ("content_items"."space" IN ('site_blog', 'academy', 'google_business', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'snapchat', 'newsletter', 'telegram', 'whatsapp_channel')); EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
-- Table réservée à la plateforme (marketing de Neomoov, aucune donnée d'organisation cliente) : sécurité activée, aucune politique
-- pour le rôle restreint, comme content_items (PLATFORM_ONLY_TABLES, docs/isolation.md).
GRANT SELECT, INSERT, UPDATE, DELETE ON "content_groups" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "content_groups" ENABLE ROW LEVEL SECURITY;
