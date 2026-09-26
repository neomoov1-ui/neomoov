/**
 * Clients d'API des pages publiques. `publicApi` passe par le relais Next.js (`/api/v1/public/*`), qui ajoute la clé
 * publique côté serveur. `guestApi` appelle l'API directement avec les jetons du client gardés en mémoire seulement
 * (jamais de témoin ni de stockage local : la page peut être intégrée en iframe sur un autre domaine).
 */
import { ApiError, createApiClient, type Language } from '@neomoov/api-client';

export const API_BASE_URL = (process.env['NEXT_PUBLIC_API_BASE_URL'] || 'http://localhost:4000').replace(/\/+$/, '');

function currentLanguage(): Language {
  if (typeof document === 'undefined') return 'fr-CA';
  return /(?:^|;\s*)lang=en(?:;|$)/.test(document.cookie) ? 'en' : 'fr-CA';
}

export const publicApi = createApiClient({ baseUrl: '/api', language: currentLanguage });

export function createGuestApi() {
  let accessToken: string | null = null;
  let refreshToken: string | null = null;
  const api = createApiClient({
    baseUrl: API_BASE_URL,
    language: currentLanguage,
    tokens: {
      getAccessToken: () => accessToken,
      refresh: async () => {
        if (!refreshToken) return null;
        const renewed = await api.auth.refresh(refreshToken).catch(() => null);
        accessToken = renewed?.accessToken ?? null;
        refreshToken = renewed?.refreshToken ?? null;
        return accessToken;
      },
    },
  });
  return {
    api,
    signIn: (tokens: { accessToken: string; refreshToken: string }) => {
      accessToken = tokens.accessToken;
      refreshToken = tokens.refreshToken;
    },
    signedIn: () => accessToken !== null,
  };
}

/** Numéro saisi (formats nord-américains usuels) vers E.164, ou null. */
export function toE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (input.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

export const errorCode = (error: unknown) => (error instanceof ApiError ? error.code : 'ERROR');

export { ApiError };
