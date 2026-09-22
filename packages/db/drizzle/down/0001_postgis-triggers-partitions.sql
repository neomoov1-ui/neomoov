-- Inverse de 0001 : retire les fonctions, les compteurs et rétablit driver_locations en table simple (données perdues).
DROP FUNCTION IF EXISTS zones_containing(double precision, double precision);--> statement-breakpoint
DROP FUNCTION IF EXISTS drivers_within(double precision, double precision, double precision, vehicle_category);--> statement-breakpoint
DROP FUNCTION IF EXISTS next_driver_public_number();--> statement-breakpoint
DROP FUNCTION IF EXISTS next_ride_public_number(text);--> statement-breakpoint
DROP FUNCTION IF EXISTS next_invoice_supplier_sequence(uuid);--> statement-breakpoint
DROP FUNCTION IF EXISTS next_invoice_number();--> statement-breakpoint
DROP FUNCTION IF EXISTS next_counter(text);--> statement-breakpoint
DROP TABLE IF EXISTS counters;--> statement-breakpoint
DROP FUNCTION IF EXISTS purge_driver_locations(integer);--> statement-breakpoint
DROP FUNCTION IF EXISTS ensure_driver_locations_partition(date);--> statement-breakpoint
DROP TABLE IF EXISTS driver_locations;--> statement-breakpoint
CREATE TABLE driver_locations (
  driver_id uuid NOT NULL,
  position geography(point,4326) NOT NULL,
  speed_mps real,
  heading_degrees real,
  accuracy_meters real,
  ride_id uuid,
  recorded_at timestamp with time zone NOT NULL
);--> statement-breakpoint
CREATE INDEX driver_locations_driver_time_idx ON driver_locations USING btree (driver_id, recorded_at);--> statement-breakpoint
CREATE INDEX driver_locations_ride_idx ON driver_locations USING btree (ride_id) WHERE ride_id IS NOT NULL;--> statement-breakpoint
DROP TRIGGER IF EXISTS ride_events_append_only ON ride_events;--> statement-breakpoint
DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;--> statement-breakpoint
DROP FUNCTION IF EXISTS forbid_change();