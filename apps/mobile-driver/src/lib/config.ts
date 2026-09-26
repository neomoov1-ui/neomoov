/**
 * Adresse de l'API : variable publique Expo `EXPO_PUBLIC_API_BASE_URL` (fixée par profil EAS), sinon l'API locale du
 * poste de développement. Aucune clé secrète dans l'application.
 */
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

/**
 * Suivi des erreurs (Sentry) : DSN public et environnement fixés par profil EAS (`EXPO_PUBLIC_SENTRY_DSN`,
 * `EXPO_PUBLIC_SENTRY_ENVIRONMENT`) ; sans DSN, aucun suivi et aucun appel réseau.
 */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
export const SENTRY_ENVIRONMENT = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;

/** Rafraîchissement HTTP quand le socket est indisponible (7.3 : 5 secondes) ; 15 secondes en mode économie de données. */
export const POLL_FALLBACK_MS = 5_000;
export const POLL_DATA_SAVER_MS = 15_000;
