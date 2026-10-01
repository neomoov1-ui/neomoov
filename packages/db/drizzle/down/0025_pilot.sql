-- Inverse de 0022 : retire Neomoov Pilote (réglages, décisions, coûts et revenus saisis) ; politiques et droits partent avec les tables.
DROP TABLE IF EXISTS driver_pilot_decisions;
DROP TABLE IF EXISTS driver_pilot_settings;
DROP TABLE IF EXISTS driver_cost_entries;
