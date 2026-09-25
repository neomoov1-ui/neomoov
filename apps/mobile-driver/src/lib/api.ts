import { ApiError, createApiClient } from '@neomoov/api-client';
import { i18n } from '@/i18n';
import { API_BASE_URL } from './config';
import { useSession } from './session';

/**
 * Client de l'API pour l'application chauffeur : jeton de la session, rafraîchissement automatique (rotation), langue
 * de l'interface ; une session perdue (401 malgré le rafraîchissement) ramène à l'écran de connexion.
 */
export const api = createApiClient({
  baseUrl: API_BASE_URL,
  language: () => (i18n.language === 'en' ? 'en' : 'fr-CA'),
  headers: { 'x-client-app': 'mobile-driver' },
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

/** Renouvelle le jeton après la candidature : le nouveau jeton porte le rôle chauffeur. */
export async function refreshRoles(): Promise<void> {
  const refreshToken = useSession.getState().refreshToken;
  if (!refreshToken) return;
  await useSession.getState().signIn(await api.auth.refresh(refreshToken));
}

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

/** Raisons d'un refus de passage en ligne (`DRIVER_NOT_ELIGIBLE`), pour les afficher une à une. */
export function eligibilityReasons(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'DRIVER_NOT_ELIGIBLE') return [];
  const reasons = (error.details as { reasons?: unknown } | undefined)?.reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === 'string') : [];
}
