/**
 * Adresse de la page de saisie de carte (revue du 2 octobre 2026, sécurité 16) : la session et la langue voyagent dans
 * le fragment (`/carte?v=2#session=…&lang=…`), que le navigateur n'envoie à aucun serveur ; une ancienne adresse
 * (`/carte?session=…`) reste lue. Fonction pure, sans dépendance au navigateur (testée seule).
 */
export function cardLinkOf(hash: string, search: string): { session: string | null; lang: string | null } {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const query = new URLSearchParams(search.replace(/^\?/, ''));
  return { session: fragment.get('session') || query.get('session') || null, lang: fragment.get('lang') || query.get('lang') || null };
}
