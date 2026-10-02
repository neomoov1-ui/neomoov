-- Inverse de 0034 (ex-0032_sales provisoire de la branche autonome-f-ventes) : direction commerciale (phase 1 « entreprise autonome », 2 octobre 2026).
ALTER TABLE "crm_records" DROP CONSTRAINT IF EXISTS "crm_records_entity_type";
DELETE FROM "crm_records" WHERE entity_type = 'prospect';
ALTER TABLE "crm_records" ADD CONSTRAINT "crm_records_entity_type" CHECK ("crm_records"."entity_type" IN ('lead', 'business_account', 'organization'));
DROP TABLE IF EXISTS "outbound_calls";
DROP TABLE IF EXISTS "followups";
DROP TABLE IF EXISTS "prospect_touches";
DROP TABLE IF EXISTS "prospects";
