-- Inverse de 0031 : réservation des crédits à la réservation et état « unknown » des relevés (revue du 2 octobre 2026, constats 3 et 7).
-- La valeur 'unknown' du type statement_status ne se retire pas (PostgreSQL) : les relevés concernés repassent « failed ».
UPDATE "weekly_statements" SET status = 'failed' WHERE status = 'unknown';
UPDATE "organization_statements" SET status = 'failed' WHERE status = 'unknown';
ALTER TABLE "organization_statements" DROP CONSTRAINT IF EXISTS "organization_statements_status";
ALTER TABLE "organization_statements" ADD CONSTRAINT "organization_statements_status" CHECK ("organization_statements"."status" IN ('issued', 'paid', 'failed', 'settled_offline'));
-- Réservations en cours : rendues aux crédits (une réservation retire déjà le montant du reste du crédit) avant la perte de la colonne.
UPDATE "credits" c SET remaining_cents = c.remaining_cents + u.total
FROM (SELECT credit_id, sum(amount_cents)::int AS total FROM "credit_uses" WHERE status = 'reserved' GROUP BY credit_id) u
WHERE u.credit_id = c.id;
DELETE FROM "credit_uses" WHERE status IN ('reserved', 'released');
ALTER TABLE "credit_uses" DROP CONSTRAINT IF EXISTS "credit_uses_status";
ALTER TABLE "credit_uses" DROP COLUMN IF EXISTS "status";
