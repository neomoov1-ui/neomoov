-- Inverse de 0022 : retire la correspondance CRM, le type de prospect « training » et remet le consentement obligatoire.
DROP TABLE crm_records;
ALTER TABLE leads DROP CONSTRAINT leads_kind;
DELETE FROM leads WHERE kind = 'training' OR consent_at IS NULL;
ALTER TABLE leads ADD CONSTRAINT leads_kind CHECK (kind IN ('driver', 'business', 'partner'));
ALTER TABLE leads ALTER COLUMN consent_at SET NOT NULL;
