-- Inverse de 0023 : retire la facturation de la plateforme (factures, abonnements et prix des formules).
DROP TABLE platform_invoices;
DROP TABLE subscriptions;
ALTER TABLE plans DROP CONSTRAINT plans_prices;
ALTER TABLE plans DROP COLUMN setup_fee_cents;
ALTER TABLE plans DROP COLUMN monthly_price_cents;
ALTER TABLE plans DROP COLUMN annual_price_cents;
ALTER TABLE plans DROP COLUMN per_active_vehicle_cents;
ALTER TABLE plans DROP COLUMN included_vehicles;
ALTER TABLE plans DROP COLUMN currency;
