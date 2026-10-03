/**
 * Lecture du témoin de profil de My Hub (`nm_hub_user`, posé par la passerelle). Il n'ouvre que l'interface : chaque
 * donnée reste autorisée par l'API avec le jeton. Revue du 2 octobre 2026 (constat web 18) : un témoin altéré ou mal
 * formé (identifiant absent, rôles qui ne sont pas des chaînes) compte comme une absence de session, jamais comme un
 * profil partiel affiché dans le cadre. Fonction pure, testée sans navigateur.
 */
import type { HubUser } from './server/gateway';

const MAX_LENGTH = 4096;
const nullableString = (value: unknown): value is string | null => value === null || typeof value === 'string';

export function parseHubUserCookie(raw: string | undefined | null): HubUser | null {
  if (!raw || raw.length > MAX_LENGTH) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || !/^[0-9a-f-]{36}$/i.test(v['id'])) return null;
  if (!Array.isArray(v['roles']) || !v['roles'].every((r) => typeof r === 'string' && r.length <= 64)) return null;
  const firstName = v['firstName'] ?? null;
  const lastName = v['lastName'] ?? null;
  const email = v['email'] ?? null;
  if (!nullableString(firstName) || !nullableString(lastName) || !nullableString(email)) return null;
  return { id: v['id'], firstName, lastName, email, roles: v['roles'] as string[] };
}

/**
 * Chemin de My Hub à retrouver après la connexion (même règle que la page de connexion : chemin de My Hub, sans chaîne
 * de requête) ; `/hub` sinon.
 */
export function hubReturnPath(pathname: string): string {
  return /^\/hub(\/[\w/-]*)?$/.test(pathname) && !pathname.startsWith('/hub/connexion') ? pathname : '/hub';
}
