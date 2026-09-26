/**
 * Client d'API de My Hub dans le navigateur : toutes les requêtes passent par la passerelle Next.js (`/api/v1/*`), qui
 * ajoute le jeton du témoin `httpOnly`. L'en-tête `x-neomoov-hub` accompagne chaque requête (protection CSRF des
 * écritures) ; une session perdue (401 après renouvellement) renvoie à la page de connexion.
 */
import { ApiError, createApiClient } from '@neomoov/api-client';
import type { Language } from './i18n-resources';

function currentLanguage(): Language {
  if (typeof document === 'undefined') return 'fr-CA';
  return /(?:^|;\s*)lang=en(?:;|$)/.test(document.cookie) ? 'en' : 'fr-CA';
}

const guardedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (response.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/hub/connexion')) {
    window.location.assign(`/hub/connexion?expired=1&next=${encodeURIComponent(window.location.pathname)}`);
  }
  return response;
};

export const hubApi = createApiClient({ baseUrl: '/api', headers: { 'x-neomoov-hub': '1' }, language: currentLanguage, fetch: guardedFetch });

/** Session du personnel (profil, jeton court du socket `/admin`), servie par la passerelle. */
export interface HubSession {
  user: { id: string; firstName: string | null; lastName: string | null; email: string | null; roles: string[] };
  socketToken?: string;
}

export async function fetchSession(withSocket = false): Promise<HubSession | null> {
  const res = await fetch(`/api/session${withSocket ? '?socket=1' : ''}`, { cache: 'no-store' });
  return res.ok ? ((await res.json()) as HubSession) : null;
}

export async function logout(): Promise<void> {
  await fetch('/api/session', { method: 'DELETE', headers: { 'x-neomoov-hub': '1' } });
  window.location.assign('/hub/connexion');
}

/** Étapes de connexion relayées : les jetons restent côté serveur. */
export async function staffStep<T>(step: 'login' | 'enroll' | 'confirm' | 'verify' | 'backup', body: unknown): Promise<T> {
  const res = await fetch(`/api/staff-auth/${step}`, { method: 'POST', headers: { 'content-type': 'application/json', 'accept-language': currentLanguage() }, body: JSON.stringify(body) });
  const payload = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
  if (!res.ok) throw new ApiError(res.status, payload.code ?? 'ERROR', payload.message ?? res.statusText);
  return payload as T;
}

export const WRITE_ROLES = ['admin', 'operator'];
export const canWrite = (roles: readonly string[] | undefined) => Boolean(roles?.some((r) => WRITE_ROLES.includes(r)));

export { ApiError };
