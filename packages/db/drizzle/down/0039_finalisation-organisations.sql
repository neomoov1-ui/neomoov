-- Inverse de 0039 : retire les index, les clés étrangères de la revue finale V1, le début du report de suspension et le
-- kilométrage à la dernière vérification mécanique. Rejouable.
DROP INDEX IF EXISTS weekly_statements_org_idx;
DROP INDEX IF EXISTS rides_org_idx;
DROP INDEX IF EXISTS rides_driver_finished_idx;
DROP INDEX IF EXISTS rides_driver_active_idx;
DROP INDEX IF EXISTS ride_offers_driver_pending_idx;
DROP INDEX IF EXISTS vehicles_org_idx;
DROP INDEX IF EXISTS drivers_org_idx;
ALTER TABLE weekly_statements DROP CONSTRAINT IF EXISTS weekly_statements_organization_id_organizations_id_fk;
ALTER TABLE statement_lines DROP CONSTRAINT IF EXISTS statement_lines_pack_purchase_id_pack_purchases_id_fk;
ALTER TABLE refunds DROP CONSTRAINT IF EXISTS refunds_credit_id_credits_id_fk;
ALTER TABLE pack_purchases DROP CONSTRAINT IF EXISTS pack_purchases_statement_id_weekly_statements_id_fk;
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_promotion_id_promotions_id_fk;
ALTER TABLE rides DROP CONSTRAINT IF EXISTS rides_organization_id_organizations_id_fk;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_organization_id_organizations_id_fk;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_client_id_clients_id_fk;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_organization_id_organizations_id_fk;
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_organization_id_organizations_id_fk;
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_current_vehicle_id_vehicles_id_fk;
ALTER TABLE favorite_drivers DROP CONSTRAINT IF EXISTS favorite_drivers_driver_id_drivers_id_fk;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_organization_id_organizations_id_fk;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_business_account_id_business_accounts_id_fk;
ALTER TABLE client_driver_links DROP CONSTRAINT IF EXISTS client_driver_links_driver_id_drivers_id_fk;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_device_id_devices_id_fk;
ALTER TABLE subscriptions DROP COLUMN IF EXISTS suspension_postponed_at;
ALTER TABLE vehicles DROP COLUMN IF EXISTS mechanical_check_km;
