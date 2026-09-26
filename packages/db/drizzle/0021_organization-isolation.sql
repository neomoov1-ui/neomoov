ALTER TABLE "clients" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE INDEX "clients_org_idx" ON "clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quotes_org_idx" ON "quotes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organizations_path_prefix_idx" ON "organizations" ("path" text_pattern_ops);--> statement-breakpoint
-- Isolation par organisation (étape 20). Le rôle de l'API (propriétaire, BYPASSRLS) n'est pas concerné : seules les transactions d'une
-- organisation cliente basculent sur le rôle neomoov_scoped (SET LOCAL ROLE) et fixent app.scope_path (chemin de l'organisation).
-- Une ligne sans organisation appartient à la racine (la plateforme).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neomoov_scoped') THEN CREATE ROLE neomoov_scoped NOLOGIN NOBYPASSRLS; END IF;
END $$;--> statement-breakpoint
GRANT neomoov_scoped TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO neomoov_scoped;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO neomoov_scoped;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO neomoov_scoped;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_scope_allows(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.scope_path', true), '') <> '' AND EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = coalesce(org, (SELECT r.id FROM organizations r WHERE r.parent_id IS NULL ORDER BY r.created_at LIMIT 1))
      AND o.path LIKE current_setting('app.scope_path', true) || '%'
  )
$$;--> statement-breakpoint
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) = current_user LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;--> statement-breakpoint
CREATE POLICY org_isolation ON "drivers" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "vehicles" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "rides" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "clients" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "quotes" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "weekly_statements" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "memberships" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "invitations" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "organization_features" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_events" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_events".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_events".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_messages" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_messages".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_messages".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_ratings" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_ratings".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_ratings".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_offers" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_offers".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_offers".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_dispatches" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_dispatches".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_dispatches".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_tracks" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_tracks".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_tracks".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "invoices" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "invoices".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "invoices".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "payments" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "payments".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "payments".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "incidents" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "incidents".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "incidents".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "scheduled_assignments" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "scheduled_assignments".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "scheduled_assignments".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "pack_consumptions" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "pack_consumptions".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "pack_consumptions".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "credit_uses" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "credit_uses".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "credit_uses".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "redevance_ledger" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "redevance_ledger".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "redevance_ledger".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "promotion_uses" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "promotion_uses".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "promotion_uses".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "tax_ledger" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "tax_ledger".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "tax_ledger".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_documents" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_documents".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_documents".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_locations" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_locations".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_locations".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_presence" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_presence".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_presence".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_scores" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_scores".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_scores".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_shifts" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_shifts".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_shifts".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_training_results" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_training_results".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_training_results".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "driver_balances" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_balances".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "driver_balances".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "pack_purchases" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "pack_purchases".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "pack_purchases".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "sanctions" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "sanctions".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "sanctions".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "sanction_appeals" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "sanction_appeals".driver_id AND app_scope_allows(d.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM drivers d WHERE d.id = "sanction_appeals".driver_id AND app_scope_allows(d.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "client_payment_methods" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = "client_payment_methods".client_id AND app_scope_allows(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = "client_payment_methods".client_id AND app_scope_allows(c.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "favorite_drivers" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = "favorite_drivers".client_id AND app_scope_allows(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = "favorite_drivers".client_id AND app_scope_allows(c.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "client_driver_links" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = "client_driver_links".client_id AND app_scope_allows(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = "client_driver_links".client_id AND app_scope_allows(c.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "saved_places" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM clients c WHERE c.id = "saved_places".client_id AND app_scope_allows(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.id = "saved_places".client_id AND app_scope_allows(c.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "refunds" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM payments p JOIN rides r ON r.id = p.ride_id WHERE p.id = refunds.payment_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM payments p JOIN rides r ON r.id = p.ride_id WHERE p.id = refunds.payment_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "statement_lines" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM weekly_statements s WHERE s.id = statement_lines.statement_id AND app_scope_allows(s.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM weekly_statements s WHERE s.id = statement_lines.statement_id AND app_scope_allows(s.organization_id)));--> statement-breakpoint
CREATE POLICY org_read ON "cities" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "zones" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "vehicle_categories" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "pricing_rules" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "surcharges" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "flat_rates" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "packs" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "permissions" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "plans" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "feature_flags" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "settings" FOR SELECT TO neomoov_scoped USING (organization_id IS NULL OR app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_read ON "organizations" FOR SELECT TO neomoov_scoped USING (path LIKE current_setting('app.scope_path', true) || '%');--> statement-breakpoint
CREATE POLICY org_read ON "roles" FOR SELECT TO neomoov_scoped USING (organization_id IS NULL OR app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_write ON "roles" FOR ALL TO neomoov_scoped USING (organization_id IS NOT NULL AND app_scope_allows(organization_id)) WITH CHECK (organization_id IS NOT NULL AND app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "role_permissions" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND (r.organization_id IS NULL OR app_scope_allows(r.organization_id)))) WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.organization_id IS NOT NULL AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_read ON "users" FOR SELECT TO neomoov_scoped USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND app_scope_allows(m.organization_id))
  OR EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = users.id AND app_scope_allows(d.organization_id))
  OR EXISTS (SELECT 1 FROM clients c WHERE c.user_id = users.id AND app_scope_allows(c.organization_id))
);
