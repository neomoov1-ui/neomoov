-- Migration écrite à la main (drizzle-kit generate --custom). Inverse : drizzle/down/0001_postgis-triggers-partitions.sql.
-- 1. Tables en ajout seul : audit_log et ride_events refusent UPDATE et DELETE.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul (% interdit)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint
CREATE TRIGGER ride_events_append_only BEFORE UPDATE OR DELETE ON ride_events FOR EACH ROW EXECUTE FUNCTION forbid_change();--> statement-breakpoint

-- 2. driver_locations partitionnée par jour (conservation 90 jours). La table créée par Drizzle est remplacée
--    par une table partitionnée aux mêmes colonnes et index ; le snapshot Drizzle reste exact.
DROP TABLE driver_locations;--> statement-breakpoint
CREATE TABLE driver_locations (
  driver_id uuid NOT NULL,
  position geography(point,4326) NOT NULL,
  speed_mps real,
  heading_degrees real,
  accuracy_meters real,
  ride_id uuid,
  recorded_at timestamp with time zone NOT NULL
) PARTITION BY RANGE (recorded_at);--> statement-breakpoint
CREATE INDEX driver_locations_driver_time_idx ON driver_locations USING btree (driver_id, recorded_at);--> statement-breakpoint
CREATE INDEX driver_locations_ride_idx ON driver_locations USING btree (ride_id) WHERE ride_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE driver_locations_default PARTITION OF driver_locations DEFAULT;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_driver_locations_partition(p_day date) RETURNS text LANGUAGE plpgsql AS $$
DECLARE part text := 'driver_locations_' || to_char(p_day, 'YYYYMMDD');
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF driver_locations FOR VALUES FROM (%L) TO (%L)', part, p_day, p_day + 1);
  RETURN part;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION purge_driver_locations(p_retention_days integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; dropped integer := 0;
BEGIN
  FOR r IN SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
           WHERE p.relname = 'driver_locations' AND c.relname ~ '^driver_locations_[0-9]{8}$'
             AND to_date(substr(c.relname, 18, 8), 'YYYYMMDD') < current_date - p_retention_days
  LOOP
    EXECUTE format('DROP TABLE %I', r.relname);
    dropped := dropped + 1;
  END LOOP;
  RETURN dropped;
END $$;--> statement-breakpoint
SELECT ensure_driver_locations_partition(current_date);--> statement-breakpoint
SELECT ensure_driver_locations_partition(current_date + 1);--> statement-breakpoint

-- 3. Compteurs transactionnels sans trou : numéros de facture (global et par fournisseur), numéros de course du jour.
CREATE TABLE counters (
  scope text PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION next_counter(p_scope text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v integer;
BEGIN
  INSERT INTO counters (scope, last_value) VALUES (p_scope, 1)
  ON CONFLICT (scope) DO UPDATE SET last_value = counters.last_value + 1, updated_at = now()
  RETURNING last_value INTO v;
  RETURN v;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION next_invoice_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'NM-' || lpad(next_counter('invoice:global')::text, 7, '0');
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION next_invoice_supplier_sequence(p_driver_id uuid) RETURNS integer LANGUAGE sql AS $$
  SELECT next_counter('invoice:driver:' || p_driver_id::text);
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION next_ride_public_number(p_time_zone text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE d text := to_char(now() AT TIME ZONE p_time_zone, 'YYYY-MM-DD');
BEGIN
  RETURN 'NM-' || d || '-' || lpad(next_counter('ride:' || d)::text, 4, '0');
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION next_driver_public_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'CH-' || lpad(next_counter('driver:public')::text, 5, '0');
$$;--> statement-breakpoint

-- 4. Requêtes géographiques : chauffeurs disponibles dans un rayon, triés par distance (index GiST de driver_presence).
CREATE OR REPLACE FUNCTION drivers_within(p_lng double precision, p_lat double precision, p_radius_m double precision, p_category vehicle_category DEFAULT NULL)
RETURNS TABLE (driver_id uuid, distance_m double precision, category vehicle_category, vehicle_id uuid) LANGUAGE sql STABLE AS $$
  SELECT dp.driver_id,
         ST_Distance(dp.position, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) AS distance_m,
         dp.category, dp.vehicle_id
  FROM driver_presence dp
  WHERE dp.is_available
    AND ST_DWithin(dp.position, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, p_radius_m)
    AND (p_category IS NULL OR dp.category = p_category)
  ORDER BY distance_m;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION zones_containing(p_lng double precision, p_lat double precision)
RETURNS TABLE (zone_id uuid, code varchar, type zone_type) LANGUAGE sql STABLE AS $$
  SELECT z.id, z.code, z.type FROM zones z
  WHERE z.active AND ST_Covers(z.geometry, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography);
$$;
