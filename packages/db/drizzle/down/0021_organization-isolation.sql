-- Inverse de 0021 : politiques, fonction, rôle restreint et colonnes d'organisation des clients et des devis.
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
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM neomoov_scoped;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM neomoov_scoped;
REVOKE USAGE ON SCHEMA public FROM neomoov_scoped;
DROP ROLE IF EXISTS neomoov_scoped;
DROP INDEX IF EXISTS organizations_path_prefix_idx;
ALTER TABLE quotes DROP COLUMN organization_id;
ALTER TABLE clients DROP COLUMN organization_id;
