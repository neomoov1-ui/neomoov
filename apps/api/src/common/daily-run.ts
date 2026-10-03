/**
 * Garde « une passe par jour » des tâches planifiées, en base (revue du 2 octobre 2026, constat 18). La garde en mémoire
 * d'avant oubliait la journée à chaque redémarrage du worker et laissait deux processus (deux réplicas, ou l'API sans
 * Redis à côté du worker) faire la même passe. Ici, une ligne de `settings` à la portée `jobs` (jamais listée ni
 * modifiable dans My Hub, qui ne lit que la portée `global`, comme la portée `oauth`) : `daily.<tâche>` vaut
 * `{ day, startedAt, finishedAt }`. Une seule réservation réussit par jour civil (écriture conditionnelle atomique) ;
 * une passe commencée mais jamais terminée (processus tué) peut être reprise après `staleMs`.
 */
import { sql } from 'drizzle-orm';
import type { Database } from '../infra/db.module.js';

export const DAILY_RUN_SCOPE = 'jobs';
const DEFAULT_STALE_MS = 2 * 3_600_000;

export interface DailyRunState {
  day: string;
  startedAt: string;
  finishedAt: string | null;
}

/**
 * Réserve la passe `job` du jour `day` (AAAA-MM-JJ, heure locale du service). Vrai si ce processus doit la faire :
 * aucune passe ce jour-là, ou une passe restée sans fin depuis plus de `staleMs` (ou rendue par `releaseDailyRun`).
 */
export async function claimDailyRun(database: Database, job: string, day: string, now: Date, staleMs = DEFAULT_STALE_MS): Promise<boolean> {
  const value = JSON.stringify({ day, startedAt: now.toISOString(), finishedAt: null } satisfies DailyRunState);
  const staleBefore = new Date(now.getTime() - staleMs).toISOString();
  const rows = await database.db.execute<{ key: string }>(sql`
    INSERT INTO settings (key, scope, value, description)
    VALUES (${`daily.${job}`}, ${DAILY_RUN_SCOPE}, ${value}::jsonb, ${`Dernière passe quotidienne de la tâche ${job} (garde technique, ne pas modifier)`})
    ON CONFLICT (key, scope) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE settings.value->>'day' IS DISTINCT FROM EXCLUDED.value->>'day'
       OR (settings.value->>'finishedAt' IS NULL AND (settings.value->>'startedAt')::timestamptz < ${staleBefore}::timestamptz)
    RETURNING key`);
  return rows.length > 0;
}

/** Passe terminée : plus aucune reprise ce jour-là. */
export async function completeDailyRun(database: Database, job: string, day: string, now: Date): Promise<void> {
  await database.db.execute(sql`
    UPDATE settings SET value = jsonb_set(value, '{finishedAt}', to_jsonb(${now.toISOString()}::text)), updated_at = now()
    WHERE key = ${`daily.${job}`} AND scope = ${DAILY_RUN_SCOPE} AND value->>'day' = ${day}`);
}

/** Passe en échec, à reprendre dès le prochain battement : la réservation est rendue (début ramené à l'époque Unix). */
export async function releaseDailyRun(database: Database, job: string, day: string): Promise<void> {
  await database.db.execute(sql`
    UPDATE settings SET value = jsonb_set(value, '{startedAt}', to_jsonb('1970-01-01T00:00:00.000Z'::text)), updated_at = now()
    WHERE key = ${`daily.${job}`} AND scope = ${DAILY_RUN_SCOPE} AND value->>'day' = ${day} AND value->>'finishedAt' IS NULL`);
}

/** État enregistré (exploitation, essais). */
export async function dailyRunState(database: Database, job: string): Promise<DailyRunState | null> {
  const rows = await database.db.execute<{ value: DailyRunState }>(sql`SELECT value FROM settings WHERE key = ${`daily.${job}`} AND scope = ${DAILY_RUN_SCOPE}`);
  return rows[0]?.value ?? null;
}
