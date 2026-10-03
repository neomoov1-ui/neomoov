/**
 * Chemin relayé par `/api/v1/[...path]` (My Hub) : liste blanche des routes du personnel et des organisations, et
 * contrôle de chaque segment déjà décodé par Next.js (revue du 2 octobre 2026, constat web 19). Un segment `.` ou `..`
 * (envoyé encodé, `%2e%2e`), une barre oblique encodée (`%2F`) ou tout caractère hors de `[A-Za-z0-9._~-]` est refusé :
 * l'adresse appelée côté API est exactement celle que la liste blanche a jugée. Fonction pure, testée.
 */

const ALLOWED = /^(admin\/.+|me|me\/consents|me\/organizations|org\/[0-9a-f-]{36}(\/.+)?|quotes|places\/(autocomplete|details))$/;
const SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Cible relayée (`admin/rides/…`), ou `null` si le chemin est refusé. */
export function relayTarget(path: readonly string[] | undefined): string | null {
  if (!path?.length) return null;
  for (const segment of path) {
    if (segment === '.' || segment === '..' || !SEGMENT.test(segment)) return null;
  }
  const target = path.join('/');
  return ALLOWED.test(target) ? target : null;
}
