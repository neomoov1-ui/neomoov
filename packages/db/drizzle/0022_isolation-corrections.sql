-- Corrections de l'isolation par organisation (étape 20, partie données). Inverse : drizzle/down/0022_isolation-corrections.sql.
-- La migration 0021 n'est pas modifiée : tout ce qui suit s'ajoute.

-- 1. Organisation du contexte courant : dernier segment de app.scope_path (uuid), NULL hors contexte. Sert de défaut aux colonnes
--    organization_id des tables de données : une ligne créée dans une transaction restreinte appartient à l'organisation du
--    contexte sans que le code ait à la donner ; hors contexte, rien ne change (NULL = plateforme).
CREATE OR REPLACE FUNCTION app_scope_organization_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (regexp_match(coalesce(current_setting('app.scope_path', true), ''), '([0-9a-f-]{36})/$'))[1]::uuid
$$;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "drivers" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "quotes" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "rides" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "credits" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "weekly_statements" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "incidents" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint
ALTER TABLE "leads" ALTER COLUMN "organization_id" SET DEFAULT app_scope_organization_id();--> statement-breakpoint

-- 2. Compteurs de numérotation (table counters, hors schéma Drizzle, réservée à la plateforme) et partitions des positions :
--    ces fonctions s'exécutent avec les droits de leur propriétaire pour que la numérotation des courses, des factures et des
--    chauffeurs, et la création des partitions quotidiennes, marchent aussi dans une transaction restreinte.
ALTER FUNCTION next_counter(text) SECURITY DEFINER SET search_path = public;--> statement-breakpoint
ALTER FUNCTION ensure_driver_locations_partition(date) SECURITY DEFINER SET search_path = public;--> statement-breakpoint

-- 3. Personne rattachée à l'organisation du contexte (adhésion, profil chauffeur ou profil client), comme la politique de users.
CREATE OR REPLACE FUNCTION app_scope_allows_user(p_user uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = p_user AND app_scope_allows(m.organization_id))
      OR EXISTS (SELECT 1 FROM drivers d WHERE d.user_id = p_user AND app_scope_allows(d.organization_id))
      OR EXISTS (SELECT 1 FROM clients c WHERE c.user_id = p_user AND app_scope_allows(c.organization_id))
$$;--> statement-breakpoint

-- 4. Politiques manquantes de 0021, nécessaires aux tâches de fond exécutées sous contexte (conformité, envoi des avis).
CREATE POLICY org_isolation ON "compliance_checks" FOR ALL TO neomoov_scoped
  USING ((entity_type = 'driver' AND EXISTS (SELECT 1 FROM drivers d WHERE d.id = compliance_checks.entity_id AND app_scope_allows(d.organization_id)))
      OR (entity_type = 'vehicle' AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = compliance_checks.entity_id AND app_scope_allows(v.organization_id))))
  WITH CHECK ((entity_type = 'driver' AND EXISTS (SELECT 1 FROM drivers d WHERE d.id = compliance_checks.entity_id AND app_scope_allows(d.organization_id)))
      OR (entity_type = 'vehicle' AND EXISTS (SELECT 1 FROM vehicles v WHERE v.id = compliance_checks.entity_id AND app_scope_allows(v.organization_id))));--> statement-breakpoint
CREATE POLICY org_isolation ON "devices" FOR ALL TO neomoov_scoped USING (app_scope_allows_user(user_id)) WITH CHECK (app_scope_allows_user(user_id));--> statement-breakpoint
CREATE POLICY org_read ON "consents" FOR SELECT TO neomoov_scoped USING (app_scope_allows_user(user_id));--> statement-breakpoint
-- Sous-organisation créée sous contexte (étape 21) : seulement sous le sous-arbre autorisé, jamais une racine.
CREATE POLICY org_insert ON "organizations" FOR INSERT TO neomoov_scoped WITH CHECK (parent_id IS NOT NULL AND path LIKE current_setting('app.scope_path', true) || '%');--> statement-breakpoint

-- 5. Organisation dérivée à l'insertion quand l'appelant ne la donne pas (hors contexte) : celle de la course, du chauffeur ou du
--    client concerné. Sous contexte, le défaut de la colonne l'a déjà posée. Sous rôle restreint, les lectures des déclencheurs
--    sont elles-mêmes filtrées par les politiques.
CREATE OR REPLACE FUNCTION org_fill_from_ride() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.ride_id IS NOT NULL THEN
    SELECT r.organization_id INTO NEW.organization_id FROM rides r WHERE r.id = NEW.ride_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION org_fill_from_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT coalesce(d.organization_id, c.organization_id) INTO NEW.organization_id
    FROM users u LEFT JOIN drivers d ON d.user_id = u.id LEFT JOIN clients c ON c.user_id = u.id WHERE u.id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION org_fill_conversation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.ride_id IS NOT NULL THEN
    SELECT r.organization_id INTO NEW.organization_id FROM rides r WHERE r.id = NEW.ride_id;
  END IF;
  IF NEW.organization_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT c.organization_id INTO NEW.organization_id FROM clients c WHERE c.user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION org_fill_notification() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref text;
BEGIN
  IF NEW.organization_id IS NOT NULL OR NEW.data IS NULL THEN RETURN NEW; END IF;
  ref := NEW.data->>'rideId';
  IF ref ~ '^[0-9a-f-]{36}$' THEN SELECT r.organization_id INTO NEW.organization_id FROM rides r WHERE r.id = ref::uuid; END IF;
  IF NEW.organization_id IS NULL THEN
    ref := NEW.data->>'statementId';
    IF ref ~ '^[0-9a-f-]{36}$' THEN SELECT s.organization_id INTO NEW.organization_id FROM weekly_statements s WHERE s.id = ref::uuid; END IF;
  END IF;
  IF NEW.organization_id IS NULL THEN
    ref := NEW.data->>'invoiceId';
    IF ref ~ '^[0-9a-f-]{36}$' THEN SELECT r.organization_id INTO NEW.organization_id FROM invoices i JOIN rides r ON r.id = i.ride_id WHERE i.id = ref::uuid; END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION org_fill_from_driver() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.driver_id IS NOT NULL THEN
    SELECT d.organization_id INTO NEW.organization_id FROM drivers d WHERE d.id = NEW.driver_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION org_fill_from_client() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.client_id IS NOT NULL THEN
    SELECT c.organization_id INTO NEW.organization_id FROM clients c WHERE c.id = NEW.client_id;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER incidents_org_fill BEFORE INSERT ON incidents FOR EACH ROW EXECUTE FUNCTION org_fill_from_ride();--> statement-breakpoint
CREATE TRIGGER conversations_org_fill BEFORE INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION org_fill_conversation();--> statement-breakpoint
CREATE TRIGGER notifications_org_fill BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION org_fill_notification();--> statement-breakpoint
CREATE TRIGGER credits_org_fill BEFORE INSERT ON credits FOR EACH ROW EXECUTE FUNCTION org_fill_from_user();--> statement-breakpoint
CREATE TRIGGER weekly_statements_org_fill BEFORE INSERT ON weekly_statements FOR EACH ROW EXECUTE FUNCTION org_fill_from_driver();--> statement-breakpoint
CREATE TRIGGER vehicles_org_fill BEFORE INSERT ON vehicles FOR EACH ROW EXECUTE FUNCTION org_fill_from_driver();--> statement-breakpoint
CREATE TRIGGER quotes_org_fill BEFORE INSERT ON quotes FOR EACH ROW EXECUTE FUNCTION org_fill_from_client();--> statement-breakpoint

-- 6. Reprise des lignes existantes sans organisation, par la même dérivation.
UPDATE weekly_statements s SET organization_id = d.organization_id FROM drivers d WHERE d.id = s.driver_id AND s.organization_id IS NULL AND d.organization_id IS NOT NULL;--> statement-breakpoint
UPDATE vehicles v SET organization_id = d.organization_id FROM drivers d WHERE d.id = v.driver_id AND v.organization_id IS NULL AND d.organization_id IS NOT NULL;--> statement-breakpoint
UPDATE credits c SET organization_id = d.organization_id FROM drivers d WHERE d.user_id = c.user_id AND c.organization_id IS NULL AND d.organization_id IS NOT NULL;--> statement-breakpoint
UPDATE credits c SET organization_id = cl.organization_id FROM clients cl WHERE cl.user_id = c.user_id AND c.organization_id IS NULL AND cl.organization_id IS NOT NULL;--> statement-breakpoint
UPDATE quotes q SET organization_id = cl.organization_id FROM clients cl WHERE cl.id = q.client_id AND q.organization_id IS NULL AND cl.organization_id IS NOT NULL;--> statement-breakpoint
UPDATE notifications n SET organization_id = r.organization_id FROM rides r WHERE n.organization_id IS NULL AND (n.data->>'rideId') ~ '^[0-9a-f-]{36}$' AND r.id = (n.data->>'rideId')::uuid AND r.organization_id IS NOT NULL;
