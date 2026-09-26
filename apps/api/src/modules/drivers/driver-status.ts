/**
 * Statut d'un chauffeur à la fin d'une suspension (conformité, sécurité, qualité, décision humaine) : il reste suspendu
 * tant qu'une autre suspension est en cours ou que son solde le bloque ; sinon il redevient restreint si une restriction
 * est encore en cours (revue finale : la levée d'une suspension effaçait une restriction), sinon actif.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../../infra/db.module.js';

type Executor = Pick<Database['db'], 'execute'>;

export async function statusAfterSuspension(db: Executor, driverId: string, now = new Date()): Promise<'suspended' | 'restricted' | 'active'> {
  const at = now.toISOString();
  const [row] = await db.execute<{ suspensions: number; restrictions: number; balance: number }>(sql`
    SELECT
      (SELECT count(*)::int FROM sanctions WHERE driver_id = ${driverId}::uuid AND type = 'suspension' AND (ends_at IS NULL OR ends_at > ${at}::timestamptz)) AS suspensions,
      (SELECT count(*)::int FROM sanctions WHERE driver_id = ${driverId}::uuid AND type = 'restriction' AND (ends_at IS NULL OR ends_at > ${at}::timestamptz)) AS restrictions,
      (SELECT count(*)::int FROM driver_balances WHERE driver_id = ${driverId}::uuid AND suspended_for_balance_at IS NOT NULL) AS balance`);
  if (Number(row?.suspensions ?? 0) > 0 || Number(row?.balance ?? 0) > 0) return 'suspended';
  return Number(row?.restrictions ?? 0) > 0 ? 'restricted' : 'active';
}

/** Applique ce statut à un chauffeur suspendu (jamais à un chauffeur radié ou en attente) ; renvoie le statut obtenu ou null. */
export async function liftSuspension(db: Executor, driverId: string, now = new Date()): Promise<'suspended' | 'restricted' | 'active' | null> {
  const next = await statusAfterSuspension(db, driverId, now);
  if (next === 'suspended') return 'suspended';
  const rows = await db.execute<{ id: string }>(sql`UPDATE drivers SET status = ${next} WHERE id = ${driverId}::uuid AND status = 'suspended' RETURNING id`);
  return rows.length ? next : null;
}
