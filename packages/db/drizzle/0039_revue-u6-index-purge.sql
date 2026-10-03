-- Revue du 2 octobre 2026, finalisation U6. Rejouable. Inverse : drizzle/down/0039_revue-u6-index-purge.sql.
-- 1. Constat 17 : le rattrapage des factures (`ridesMissingInvoice`, chaque passe de la file des factures) lisait toutes
--    les courses par `updated_at` sans index ; index partiel sur les seules courses facturables.
CREATE INDEX IF NOT EXISTS "rides_invoice_catchup_idx" ON "rides" USING btree ("updated_at") WHERE "rides"."driver_id" IS NOT NULL AND "rides"."state" IN ('completed', 'rated', 'disputed', 'cancelled_by_client', 'no_show');--> statement-breakpoint
-- 2. Constat 20 : la purge de conservation du journal d'audit désactivait le déclencheur « ajout seul » (ALTER TABLE :
--    verrou exclusif de toute la table pendant la purge, droit de propriétaire exigé). Le déclencheur garde sa règle, avec
--    une seule exception : une suppression, dans une transaction qui l'a déclarée (`SET LOCAL neomoov.audit_purge = 'on'`,
--    `RetentionService.auditLog`), d'une ligne de plus d'un an. Toute modification reste refusée ; `ride_events` garde
--    `forbid_change()`.
CREATE OR REPLACE FUNCTION audit_log_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('neomoov.audit_purge', true) = 'on' AND OLD.occurred_at < now() - interval '1 year' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'La table % est en ajout seul (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_guard();
