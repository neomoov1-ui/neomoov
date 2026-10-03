-- Inverse de 0036 : retire la redevance Neomoov (lignes par course, taux par chauffeur, réglage global). La redevance gouvernementale (redevance_ledger) n'est pas touchée.
DROP TABLE IF EXISTS platform_fees;
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_platform_fee_bps_range;
ALTER TABLE drivers DROP COLUMN IF EXISTS platform_fee_bps;
DELETE FROM settings WHERE key IN ('drivers.platform_fee_default_bps', 'dispatch.pack_priority_seconds') AND scope = 'global';
