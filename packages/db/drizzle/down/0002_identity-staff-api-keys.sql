-- Inverse de 0002 : retire les clés de service, les identifiants du personnel, la colonne de corrélation du journal
-- d'audit et les rôles finance et readonly. PostgreSQL ne retire pas une valeur d'énumération : le type est recréé
-- sans ces deux valeurs, après suppression des lignes qui les utilisent.
DROP TABLE IF EXISTS api_keys;--> statement-breakpoint
DROP TABLE IF EXISTS staff_credentials;--> statement-breakpoint
ALTER TABLE audit_log DROP COLUMN IF EXISTS correlation_id;--> statement-breakpoint
ALTER TABLE sessions DROP COLUMN IF EXISTS amr;--> statement-breakpoint
DELETE FROM user_roles WHERE role IN ('finance', 'readonly');--> statement-breakpoint
UPDATE users SET primary_role = 'operator' WHERE primary_role IN ('finance', 'readonly');--> statement-breakpoint
ALTER TYPE user_role RENAME TO user_role_old;--> statement-breakpoint
CREATE TYPE user_role AS ENUM ('client', 'driver', 'partner', 'investor', 'operator', 'admin', 'agent');--> statement-breakpoint
ALTER TABLE users ALTER COLUMN primary_role DROP DEFAULT;--> statement-breakpoint
ALTER TABLE users ALTER COLUMN primary_role TYPE user_role USING primary_role::text::user_role;--> statement-breakpoint
ALTER TABLE users ALTER COLUMN primary_role SET DEFAULT 'client';--> statement-breakpoint
ALTER TABLE user_roles ALTER COLUMN role TYPE user_role USING role::text::user_role;--> statement-breakpoint
DROP TYPE user_role_old;
