import { ApiError, createApiClient, OfflineQueue } from '@neomoov/api-client';
import type { TokensView } from '@neomoov/domain';
import { isRefreshRefused } from '@neomoov/mobile-core/session-end';
import { i18n } from '@/i18n';
import { observeResponse } from './clock';
import { API_BASE_URL } from './config';
import { useSession } from './session';
import { secureStorage } from './storage';

/**
 * Session perdue : routine de sortie complète, branchée par `session-end.ts` au chargement de l'application (sans
 * importation circulaire) ; à défaut, la session seule est effacée.
 */
let onSessionLost: () => void = () => void useSession.getState().signOut();

export function handleSessionLost(handler: () => void): void {
  onSessionLost = handler;
}

/**
 * Client de l'API pour l'application : jeton d'accès de la session, rafraîchissement automatique (rotation), langue de
 * l'interface, écart d'horloge mesuré sur chaque réponse. Seul un refus du jeton de rafraîchissement (400, 401, 403)
 * perd la session et ramène à l'écran de connexion ; une panne passagère (réseau, délai, 5xx, 429) la garde (revue du
 * 2 octobre 2026, constat mobile 3).
 */
export const api = createApiClient({
  baseUrl: API_BASE_URL,
  language: () => (i18n.language === 'en' ? 'en' : 'fr-CA'),
  headers: { 'x-client-app': 'mobile-client' },
  onResponse: observeResponse,
  tokens: {
    getAccessToken: () => useSession.getState().accessToken,
    refresh: async () => {
      const refreshToken = useSession.getState().refreshToken;
      if (!refreshToken) return null;
      let tokens: TokensView;
      try {
        tokens = await api.auth.refresh(refreshToken);
      } catch (error) {
        if (isRefreshRefused(error)) return null;
        // Panne passagère : la session est gardée, l'appelant réessaiera.
        throw error;
      }
      await useSession.getState().signIn(tokens);
      return tokens.accessToken;
    },
  },
  onUnauthorized: () => onSessionLost(),
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

/** Erreur de l'API (code et détails), ou null pour une autre exception. */
export function apiErrorOf(error: unknown): ApiError | null {
  return error instanceof ApiError ? error : null;
}
