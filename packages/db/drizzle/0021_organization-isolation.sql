ALTER TABLE "audit_log" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "credits" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "incidents" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE INDEX "credits_org_idx" ON "credits" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "incidents_org_idx" ON "incidents" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "conversations_org_idx" ON "conversations" USING btree ("organization_id","last_message_at");--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
-- Isolation par organisation (étape 20, amendement v1.2 section 4). Le rôle de l'API (propriétaire des tables) n'est pas
-- soumis aux politiques : seules les transactions ouvertes par OrgScopeService.run basculent sur le rôle neomoov_scoped
-- (SET LOCAL ROLE) et fixent app.scope_path (chemin de l'organisation). Une ligne sans organisation appartient à la racine
-- (la plateforme) : invisible dans un contexte client. Une table sans politique est fermée au rôle restreint (aucune ligne).
-- Toute table créée par une migration ultérieure doit recevoir ses droits et sa politique (test de couverture de l'API).
CREATE INDEX IF NOT EXISTS "organizations_path_prefix_idx" ON "organizations" ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_org_idx" ON "clients" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_org_idx" ON "quotes" USING btree ("organization_id");--> statement-breakpoint
UPDATE incidents i SET organization_id = r.organization_id FROM rides r WHERE r.id = i.ride_id AND i.organization_id IS NULL AND r.organization_id IS NOT NULL;--> statement-breakpoint
UPDATE conversations c SET organization_id = r.organization_id FROM rides r WHERE r.id = c.ride_id AND c.organization_id IS NULL AND r.organization_id IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'neomoov_scoped') THEN CREATE ROLE neomoov_scoped NOLOGIN NOBYPASSRLS; END IF;
END $$;--> statement-breakpoint
GRANT neomoov_scoped TO CURRENT_USER WITH INHERIT FALSE, SET TRUE;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO neomoov_scoped;--> statement-breakpoint
DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'S') AND pg_get_userbyid(c.relowner) = current_user LOOP
    IF t.relkind = 'S' THEN
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO neomoov_scoped', t.relname);
    ELSE
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO neomoov_scoped', t.relname);
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_scope_allows(org uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.scope_path', true), '') <> '' AND EXISTS (
    SELECT 1 FROM organizations o
    WHERE o.id = coalesce(org, (SELECT r.id FROM organizations r WHERE r.parent_id IS NULL ORDER BY r.created_at LIMIT 1))
      AND o.path LIKE current_setting('app.scope_path', true) || '%'
  )
$$;--> statement-breakpoint
CREATE POLICY org_isolation ON "drivers" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "vehicles" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "rides" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "clients" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "quotes" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "weekly_statements" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "memberships" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "invitations" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "organization_features" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "audit_log" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "conversations" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "notifications" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "incidents" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "credits" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "leads" FOR ALL TO neomoov_scoped USING (app_scope_allows(organization_id)) WITH CHECK (app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_events" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_events".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_events".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_messages" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_messages".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_messages".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_ratings" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_ratings".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_ratings".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_offers" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_offers".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_offers".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_dispatches" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_dispatches".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_dispatches".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "ride_tracks" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_tracks".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "ride_tracks".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "invoices" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "invoices".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "invoices".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "payments" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM rides r WHERE r.id = "payments".ride_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM rides r WHERE r.id = "payments".ride_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
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
CREATE POLICY org_isolation ON "conversation_messages" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_messages.conversation_id AND app_scope_allows(c.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = conversation_messages.conversation_id AND app_scope_allows(c.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "vehicle_financings" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_financings.vehicle_id AND app_scope_allows(v.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM vehicles v WHERE v.id = vehicle_financings.vehicle_id AND app_scope_allows(v.organization_id)));--> statement-breakpoint
CREATE POLICY org_isolation ON "sev_transmissions" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM invoices i JOIN rides r ON r.id = i.ride_id WHERE i.id = sev_transmissions.invoice_id AND app_scope_allows(r.organization_id))) WITH CHECK (EXISTS (SELECT 1 FROM invoices i JOIN rides r ON r.id = i.ride_id WHERE i.id = sev_transmissions.invoice_id AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_read ON "cities" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "zones" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "vehicle_categories" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "pricing_rules" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "surcharges" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "flat_rates" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "packs" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "promotions" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "permissions" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "plans" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "feature_flags" FOR SELECT TO neomoov_scoped USING (true);--> statement-breakpoint
CREATE POLICY org_read ON "settings" FOR SELECT TO neomoov_scoped USING (organization_id IS NULL OR app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_read ON "organizations" FOR SELECT TO neomoov_scoped USING (path LIKE current_setting('app.scope_path', true) || '%');--> statement-breakpoint
CREATE POLICY org_write ON "organizations" FOR UPDATE TO neomoov_scoped USING (path LIKE current_setting('app.scope_path', true) || '%') WITH CHECK (path LIKE current_setting('app.scope_path', true) || '%');--> statement-breakpoint
CREATE POLICY org_read ON "roles" FOR SELECT TO neomoov_scoped USING (organization_id IS NULL OR app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_write ON "roles" FOR ALL TO neomoov_scoped USING (organization_id IS NOT NULL AND app_scope_allows(organization_id)) WITH CHECK (organization_id IS NOT NULL AND app_scope_allows(organization_id));--> statement-breakpoint
CREATE POLICY org_isolation ON "role_permissions" FOR ALL TO neomoov_scoped USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND (r.organization_id IS NULL OR app_scope_allows(r.organization_id)))) WITH CHECK (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id AND r.organization_id IS NOT NULL AND app_scope_allows(r.organization_id)));--> statement-breakpoint
CREATE POLICY org_read ON "users" FOR SELECT TO neomoov_scoped USING (
  EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = users.id AND app_scope_allows(m.organization_id))
  OR EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = users.id AND app_scope_allows(d.organization_id))
  OR EXISTS (SELECT 1 FROM clients c WHERE c.user_id = users.id AND app_scope_allows(c.organization_id))
);