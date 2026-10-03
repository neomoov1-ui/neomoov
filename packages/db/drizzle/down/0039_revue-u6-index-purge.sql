-- Inverse de 0039 : retire l'index du rattrapage des factures et rend au journal d'audit son déclencheur d'origine
-- (aucune suppression possible, la purge de conservation ne passe plus).
DROP INDEX IF EXISTS rides_invoice_catchup_idx;
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();
DROP FUNCTION IF EXISTS audit_log_guard();
