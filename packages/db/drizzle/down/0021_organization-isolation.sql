-- Inverse de 0021 : politiques, fonction, rôle restreint, index et colonnes d'organisation ajoutées à l'étape 20.
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('org_isolation', 'org_read', 'org_write') LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity AND pg_get_userbyid(c.relowner) = current_user LOOP
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS app_scope_allows(uuid);
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND pg_get_userbyid(c.relowner) = current_user LOOP
    IF t.relkind = 'S' THEN EXECUTE format('REVOKE ALL ON SEQUENCE %I FROM neomoov_scoped', t.relname);
    ELSE EXECUTE format('REVOKE ALL ON %I FROM neomoov_scoped', t.relname); END IF;
  END LOOP;
END $$;
REVOKE USAGE ON SCHEMA public FROM neomoov_scoped;
DROP ROLE IF EXISTS neomoov_scoped;
DROP INDEX IF EXISTS organizations_path_prefix_idx;
DROP INDEX IF EXISTS audit_log_org_idx;
DROP INDEX IF EXISTS conversations_org_idx;
DROP INDEX IF EXISTS notifications_org_idx;
DROP INDEX IF EXISTS incidents_org_idx;
DROP INDEX IF EXISTS credits_org_idx;
DROP INDEX IF EXISTS leads_org_idx;
DROP INDEX IF EXISTS clients_org_idx;
DROP INDEX IF EXISTS quotes_org_idx;
ALTER TABLE audit_log DROP COLUMN IF EXISTS organization_id;
ALTER TABLE conversations DROP COLUMN IF EXISTS organization_id;
ALTER TABLE notifications DROP COLUMN IF EXISTS organization_id;
ALTER TABLE incidents DROP COLUMN IF EXISTS organization_id;
ALTER TABLE credits DROP COLUMN IF EXISTS organization_id;
ALTER TABLE leads DROP COLUMN IF EXISTS organization_id;
ALTER TABLE quotes DROP COLUMN IF EXISTS organization_id;
ALTER TABLE clients DROP COLUMN IF EXISTS organization_id;
