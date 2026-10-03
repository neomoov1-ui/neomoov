-- Finalisation du 3 octobre 2026 (agent U2, organisations, flotte et facturation). Rejouable (IF NOT EXISTS, blocs DO).
-- Inverse : down/0039_finalisation-organisations.sql. La session principale renumérote à la fusion si besoin.
--
-- 1. Règle des 60 000 km : kilométrage relevé à la dernière vérification mécanique approuvée (vehicles.mechanical_check_km).
-- 2. Facturation de la plateforme : début du report d'une suspension (subscriptions.suspension_postponed_at).
-- 3. Revue finale V1 : clés étrangères manquantes. Posées NOT VALID (les nouvelles lignes sont contrôlées aussitôt), puis
--    validées une à une ; une ligne orpheline ancienne laisse sa contrainte non validée avec un avis, sans faire échouer la
--    migration (à nettoyer, puis `ALTER TABLE ... VALIDATE CONSTRAINT ...`). Suppression du parent : mise à nul (ou
--    cascade pour les favoris et les liens client-chauffeur), jamais un blocage : les purges et les nettoyages de test
--    continuent de fonctionner. Non posées : invoices.credit_note_of_id (la mise à nul heurterait l'index unique d'une
--    facture par course ; à reprendre avec la passe de conservation) et statement_lines.ride_id (l'essai de l'agent
--    comptable simule une ligne vers une course absente ; à poser avec son nouveau scénario).
-- 4. Index : course active et dernier trajet d'un chauffeur, offres en attente d'un chauffeur (rapport de charge, point 4),
--    colonnes organization_id des tables principales (clés étrangères ci-dessus).
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "mechanical_check_km" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "suspension_postponed_at" timestamp with time zone;--> statement-breakpoint
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN SELECT * FROM (VALUES
    ('sessions', 'sessions_device_id_devices_id_fk', 'device_id', 'devices', 'SET NULL'),
    ('client_driver_links', 'client_driver_links_driver_id_drivers_id_fk', 'driver_id', 'drivers', 'CASCADE'),
    ('clients', 'clients_business_account_id_business_accounts_id_fk', 'business_account_id', 'business_accounts', 'SET NULL'),
    ('clients', 'clients_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'SET NULL'),
    ('favorite_drivers', 'favorite_drivers_driver_id_drivers_id_fk', 'driver_id', 'drivers', 'CASCADE'),
    ('drivers', 'drivers_current_vehicle_id_vehicles_id_fk', 'current_vehicle_id', 'vehicles', 'SET NULL'),
    ('drivers', 'drivers_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'SET NULL'),
    ('vehicles', 'vehicles_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'SET NULL'),
    ('quotes', 'quotes_client_id_clients_id_fk', 'client_id', 'clients', 'SET NULL'),
    ('quotes', 'quotes_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'SET NULL'),
    ('rides', 'rides_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'SET NULL'),
    ('rides', 'rides_promotion_id_promotions_id_fk', 'promotion_id', 'promotions', 'SET NULL'),
    ('pack_purchases', 'pack_purchases_statement_id_weekly_statements_id_fk', 'statement_id', 'weekly_statements', 'SET NULL'),
    ('refunds', 'refunds_credit_id_credits_id_fk', 'credit_id', 'credits', 'SET NULL'),
    ('statement_lines', 'statement_lines_pack_purchase_id_pack_purchases_id_fk', 'pack_purchase_id', 'pack_purchases', 'SET NULL'),
    ('weekly_statements', 'weekly_statements_organization_id_organizations_id_fk', 'organization_id', 'organizations', 'SET NULL')
  ) AS t(tbl, name, col, ref, on_delete)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I(id) ON DELETE %s ON UPDATE NO ACTION NOT VALID', fk.tbl, fk.name, fk.col, fk.ref, fk.on_delete);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.name AND NOT convalidated) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', fk.tbl, fk.name);
      EXCEPTION WHEN foreign_key_violation THEN
        RAISE NOTICE 'Clé étrangère % laissée non validée : lignes orphelines dans %.% (à nettoyer, puis VALIDATE CONSTRAINT)', fk.name, fk.tbl, fk.col;
      END;
    END IF;
  END LOOP;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drivers_org_idx" ON "drivers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vehicles_org_idx" ON "vehicles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ride_offers_driver_pending_idx" ON "ride_offers" USING btree ("driver_id") WHERE "ride_offers"."state" = 'sent';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rides_driver_active_idx" ON "rides" USING btree ("driver_id","updated_at" DESC NULLS LAST) WHERE "rides"."state" IN ('assigned', 'en_route', 'arrived', 'in_progress');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rides_driver_finished_idx" ON "rides" USING btree ("driver_id","updated_at" DESC NULLS LAST) WHERE "rides"."state" IN ('completed', 'rated');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rides_org_idx" ON "rides" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weekly_statements_org_idx" ON "weekly_statements" USING btree ("organization_id");
