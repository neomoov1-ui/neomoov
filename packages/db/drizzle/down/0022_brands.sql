-- Inverse de 0022 : marque par organisation, domaines, code de rattachement, permissions de la marque.
DELETE FROM role_permissions WHERE permission_code IN ('brand.edit', 'domains.manage', 'domains.verify');
--> statement-breakpoint
DELETE FROM permissions WHERE code IN ('brand.edit', 'domains.manage', 'domains.verify');
--> statement-breakpoint
DROP POLICY IF EXISTS org_isolation ON "organization_domains";
--> statement-breakpoint
DROP POLICY IF EXISTS org_isolation ON "brands";
--> statement-breakpoint
DROP TABLE IF EXISTS "organization_domains";
--> statement-breakpoint
DROP TABLE IF EXISTS "brands";
--> statement-breakpoint
DROP INDEX IF EXISTS "organizations_join_code_unique";
--> statement-breakpoint
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "join_code";
--> statement-breakpoint
DROP FUNCTION IF EXISTS generate_join_code();
