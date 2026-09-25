/**
 * Adresse de l'API : variable publique Expo `EXPO_PUBLIC_API_BASE_URL` (fixée par profil EAS : staging, production),
 * sinon l'API locale du poste de développement. Aucune clé secrète ici : l'application n'en contient aucune.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/** Intervalle de rafraîchissement HTTP d'une course quand le socket est indisponible (7.3 : 5 secondes). */
export const POLL_FALLBACK_MS = 5_000;
