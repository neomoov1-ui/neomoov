-- Étape 22 (amendement v1.2, section 5) : marque par organisation, domaines web du client, code de rattachement.
-- Code de rattachement : 8 caractères d'un alphabet sans ambiguïté (ni 0 et O, ni 1, I et L), même alphabet que
-- `generateJoinCode` du domaine ; l'unicité est garantie par l'index (collision négligeable : 31^8 combinaisons).
CREATE OR REPLACE FUNCTION generate_join_code() RETURNS varchar LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', floor(random() * 31)::int + 1, 1), '') FROM generate_series(1, 8)
$$;--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"display_name" varchar(120),
	"logo_url" text,
	"colors" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tagline" varchar(200),
	"texts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"support_phone" varchar(20),
	"support_email" varchar(254),
	"email_sender_name" varchar(120),
	"email_sender_address" varchar(254),
	"sms_sender" varchar(20),
	"terms_url" text,
	"privacy_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"domain" varchar(253) NOT NULL,
	"kind" varchar(10) DEFAULT 'booking' NOT NULL,
	"verification_token" varchar(64) NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_domains_kind" CHECK ("organization_domains"."kind" IN ('booking', 'hub'))
);
--> statement-breakpoint
-- Colonne ajoutée sans valeur par défaut, puis reprise des organisations existantes une par une (unicité vérifiée),
-- puis contrainte et valeur par défaut : une organisation créée ensuite reçoit son code de la base.
ALTER TABLE "organizations" ADD COLUMN "join_code" varchar(8);--> statement-breakpoint
DO $$ DECLARE o record; c varchar(8); BEGIN
  FOR o IN SELECT id FROM organizations WHERE join_code IS NULL ORDER BY created_at LOOP
    LOOP
      c := generate_join_code();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM organizations WHERE join_code = c);
    END LOOP;
    UPDATE organizations SET join_code = c WHERE id = o.id;
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "join_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "join_code" SET DEFAULT generate_join_code();--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brands_organization_unique" ON "brands" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_domains_domain_unique" ON "organization_domains" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "organization_domains_org_idx" ON "organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_join_code_unique" ON "organizations" USING btree ("join_code");--> statement-breakpoint
-- Isolation par organisation (règle de l'étape 20) : droits du rôle restreint et politique sur chaque nouvelle table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "brands" TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organization_domains" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "brands" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "organization_domains" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
-- Permissions de la marque (catalogue du domaine, recopié par les données de départ ; posé ici pour une base déjà en
-- service) : les rôles système propriétaire et administrateur d'organisation reçoivent brand.edit et domains.manage, la
-- plateforme reçoit aussi domains.verify (vérification manuelle du DNS en V1).
INSERT INTO permissions (code, module, description, sensitive, platform_only) VALUES
  ('brand.edit', 'organization', 'Marque de l''organisation : nom, logo, couleurs, textes, assistance, expéditeur, conditions', false, false),
  ('domains.manage', 'organization', 'Domaines web de l''organisation (réservation, My Hub)', false, false),
  ('domains.verify', 'organization', 'Marquer un domaine vérifié après contrôle du DNS', false, true)
ON CONFLICT (code) DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, p.code FROM roles r CROSS JOIN (VALUES ('brand.edit'), ('domains.manage')) AS p(code)
  WHERE r.organization_id IS NULL AND r.code IN ('org_owner', 'org_admin', 'platform_admin')
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO role_permissions (role_id, permission_code)
  SELECT r.id, 'domains.verify' FROM roles r WHERE r.organization_id IS NULL AND r.code = 'platform_admin'
ON CONFLICT DO NOTHING;
