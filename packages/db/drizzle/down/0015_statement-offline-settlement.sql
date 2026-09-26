-- Inverse de 0015 : retire la trace des règlements constatés hors plateforme.
ALTER TABLE weekly_statements DROP COLUMN offline_settlement;
