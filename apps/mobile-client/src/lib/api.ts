import { ApiError, createApiClient, OfflineQueue } from '@neomoov/api-client';
import { i18n } from '@/i18n';
import { API_BASE_URL } from './config';
import { useSession } from './session';
import { secureStorage } from './storage';

/**
 * Client de l'API pour l'application : jeton d'accès de la session, rafraîchissement automatique (rotation), langue de
 * l'interface ; une session perdue (401 malgré le rafraîchissement) ramène à l'écran de connexion.
 */
export const api = createApiClient({
  baseUrl: API_BASE_URL,
  language: () => (i18n.language === 'en' ? 'en' : 'fr-CA'),
  headers: { 'x-client-app': 'mobile-client' },
  tokens: {
    getAccessToken: () => useSession.getState().accessToken,
    refresh: async () => {
      const refreshToken = useSession.getState().refreshToken;
      if (!refreshToken) return null;
      try {
        const tokens = await api.auth.refresh(refreshToken);
        await useSession.getState().signIn(tokens);
        return tokens.accessToken;
      } catch (error) {
        // Sans réseau, la session n'est pas perdue : l'appelant réessaiera.
        if (error instanceof ApiError && error.isNetwork) throw error;
        return null;
      }
    },
  },
  onUnauthorized: () => {
    void useSession.getState().signOut();
  },
});

/** Évaluations et messages faits sans réseau : gardés puis renvoyés au retour de la connexion (prompt 10, tâche 1). */
export const offlineQueue = new OfflineQueue(api, secureStorage, { maxItems: 20 });

/**
 * Message d'erreur lisible : traduction de l'application pour les codes courants, sinon le message de l'API (dans la
 * langue demandée par Accept-Language), sinon le message générique.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'TIMEOUT') return i18n.t('errors.timeout');
    if (error.isNetwork) return i18n.t('errors.network');
    const key = `errors.codes.${error.code}`;
    return i18n.exists(key) ? i18n.t(key) : error.message || i18n.t('errors.generic');
  }
  return i18n.t('errors.generic');
}

export function errorCode(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}
