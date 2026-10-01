CREATE TABLE "support_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"status" varchar(12) DEFAULT 'requested' NOT NULL,
	"approved_by_user_id" uuid,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_access_grants_status" CHECK ("support_access_grants"."status" IN ('requested', 'approved', 'denied', 'expired', 'revoked')),
	CONSTRAINT "support_access_grants_duration" CHECK ("support_access_grants"."duration_minutes" BETWEEN 15 AND 1440)
);
--> statement-breakpoint
ALTER TABLE "staff_credentials" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_access_grants" ADD CONSTRAINT "support_access_grants_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_access_grants_org_idx" ON "support_access_grants" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "support_access_grants_requester_idx" ON "support_access_grants" USING btree ("requested_by_user_id","status");--> statement-breakpoint
-- Étape 21 : accès du support visible de l'organisation concernée seulement (politique d'isolation, comme 0021) ;
-- la plateforme (rôle de l'API, propriétaire des tables) n'y est pas soumise.
GRANT SELECT, INSERT, UPDATE, DELETE ON "support_access_grants" TO neomoov_scoped;--> statement-breakpoint
ALTER TABLE "support_access_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON "support_access_grants" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
-- Catalogue : la permission du support (sensible, réservée à la plateforme), recopiée aussi par les données de départ ;
-- le rôle système de l'administrateur de la plateforme la reçoit comme toutes les permissions du personnel.
INSERT INTO "permissions" ("code", "module", "description", "sensitive", "platform_only")
VALUES ('support.access', 'platform', 'Accès temporaire du support à une organisation cliente, approuvé par elle et journalisé', true, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
SELECT r.id, 'support.access' FROM "roles" r WHERE r.organization_id IS NULL AND r.code = 'platform_admin'
ON CONFLICT DO NOTHING;
