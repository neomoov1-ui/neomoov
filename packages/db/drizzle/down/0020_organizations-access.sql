-- Inverse de 0020 : retire les tables d'accès et les colonnes de l'arbre des organisations.
DROP TABLE invitations;
DROP TABLE memberships;
DROP TABLE role_permissions;
DROP TABLE roles;
DROP TABLE permissions;
DROP TABLE organization_features;
DROP TABLE plans;
ALTER TABLE organizations DROP CONSTRAINT organizations_status;
ALTER TABLE organizations DROP CONSTRAINT organizations_type;
DELETE FROM organizations WHERE type NOT IN ('platform', 'fleet', 'taxi_company', 'white_label');
ALTER TABLE organizations ADD CONSTRAINT organizations_type CHECK (type IN ('platform', 'fleet', 'taxi_company', 'white_label'));
ALTER TABLE organizations DROP COLUMN qst_number, DROP COLUMN gst_number, DROP COLUMN legal_name, DROP COLUMN plan_code, DROP COLUMN status, DROP COLUMN path, DROP COLUMN parent_id;
