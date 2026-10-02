-- Inverse de 0032 : retire Neomoov Booster (inspections, rapports de performance, réglages des alertes) ; politiques, droits et déclencheurs partent avec les tables.
DROP TABLE IF EXISTS vehicle_inspections;
DROP TABLE IF EXISTS performance_logs;
DROP TABLE IF EXISTS driver_alert_settings;
