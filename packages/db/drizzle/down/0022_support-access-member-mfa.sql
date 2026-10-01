-- Inverse de 0022 : accès du support, permission du catalogue, second facteur des membres d'organisation.
DROP TABLE IF EXISTS "support_access_grants";
DELETE FROM "role_permissions" WHERE "permission_code" = 'support.access';
DELETE FROM "permissions" WHERE "code" = 'support.access';
-- Les seconds facteurs des membres d'organisation (sans mot de passe) disparaissent ; le personnel garde le sien.
DELETE FROM "staff_credentials" WHERE "password_hash" IS NULL;
ALTER TABLE "staff_credentials" ALTER COLUMN "password_hash" SET NOT NULL;
