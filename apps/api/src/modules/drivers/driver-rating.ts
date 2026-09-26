/**
 * Note du chauffeur selon la Charte d'équité (D7, 26 septembre 2026) : moyenne des notes des clients sur les
 * `quality.rating_window` (100) dernières courses notées qui comptent, pour la note affichée comme pour l'agent qualité.
 * Ne comptent pas : une note exclue par une personne (réponse du chauffeur admise), une note qui signale une cause hors
 * de son contrôle (circulation, prix, application) et une course où le client l'a fait attendre au-delà du délai
 * gratuit (attente facturée). Même règle que `isRatingCounted` du domaine, écrite en SQL (alias `rr` et `r`).
 */
import { RATING_EXTERNAL_TAGS } from '@neomoov/domain';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../infra/db.module.js';

export const COUNTED_RATING: SQL = sql.raw(
  `rr.author_kind = 'client' AND rr.excluded_at IS NULL AND r.wait_charge_cents = 0 AND NOT jsonb_exists_any(rr.tags, ARRAY[${RATING_EXTERNAL_TAGS.map((t) => `'${t}'`).join(', ')}])`,
);

/** Recalcule la note affichée du chauffeur (moyenne et nombre de notes retenues) ; sans note retenue, la note reste. */
export async function refreshDriverRating(db: Database['db'], driverId: string, window: number): Promise<void> {
  await db.execute(sql`
    UPDATE drivers d SET rating_average = coalesce(x.avg, d.rating_average), rating_count = x.n
    FROM (
      SELECT round(avg(s.score)::numeric, 2) AS avg, count(*)::int AS n FROM (
        SELECT rr.score FROM ride_ratings rr JOIN rides r ON r.id = rr.ride_id
        WHERE r.driver_id = ${driverId}::uuid AND ${COUNTED_RATING}
        ORDER BY rr.created_at DESC LIMIT ${window}
      ) s
    ) x
    WHERE d.id = ${driverId}::uuid`);
}
