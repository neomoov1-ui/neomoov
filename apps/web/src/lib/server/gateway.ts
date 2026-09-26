/**
 * Passerelle entre le navigateur et l'API (côté serveur Next.js seulement). Les jetons du personnel de My Hub vivent
 * dans des témoins `httpOnly`, `SameSite=Strict` : le JavaScript de la page ne les lit jamais ; la passerelle ajoute
 * l'autorisation, renouvelle le jeton d'accès (rotation) et relaie la réponse telle quelle.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

/** Adresse de l'API vue du serveur web (réseau interne en production), sinon celle du navigateur, sinon l'API locale. */
export const API_URL = (process.env['API_INTERNAL_URL'] || process.env['NEXT_PUBLIC_API_BASE_URL'] || 'http://localhost:4000').replace(/\/+$/, '');

export const ACCESS_COOKIE = 'nm_hub_at';
export const REFRESH_COOKIE = 'nm_hub_rt';
export const USER_COOKIE = 'nm_hub_user';
/** En-tête exigé sur les écritures relayées : un site tiers ne peut pas l'ajouter sans accord CORS (protection CSRF). */
export const CSRF_HEADER = 'x-neomoov-hub';

const secure = process.env['NODE_ENV'] === 'production';

export interface HubUser {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  roles: string[];
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  user: { id: string; firstName: string | null; lastName: string | null; email: string | null; roles: string[] };
}

/** Pose les témoins de session à partir des jetons renvoyés par l'API. */
export function setSession(res: NextResponse, tokens: Tokens): void {
  const base = { httpOnly: true, secure, sameSite: 'strict' as const, path: '/' };
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.expiresIn ?? 900 });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, path: '/api', maxAge: 30 * 86_400 });
  const user: HubUser = { id: tokens.user.id, firstName: tokens.user.firstName, lastName: tokens.user.lastName, email: tokens.user.email, roles: tokens.user.roles };
  res.cookies.set(USER_COOKIE, JSON.stringify(user), { ...base, maxAge: 30 * 86_400 });
}

export function clearSession(res: NextResponse): void {
  for (const name of [ACCESS_COOKIE, USER_COOKIE]) res.cookies.set(name, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { path: '/api', maxAge: 0 });
}

export function sessionUser(req: NextRequest): HubUser | null {
  const raw = req.cookies.get(USER_COOKIE)?.value;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as HubUser;
  } catch {
    return null;
  }
}

/** Renouvelle les jetons avec le témoin de rafraîchissement ; null si la session est perdue. */
export async function refreshTokens(refreshToken: string | undefined): Promise<Tokens | null> {
  if (!refreshToken) return null;
  const res = await fetch(`${API_URL}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store' });
  return res.ok ? ((await res.json()) as Tokens) : null;
}

/** En-têtes relayés vers l'API : langue, corrélation, adresse du navigateur (limitation de débit par adresse). */
export function forwardHeaders(req: NextRequest, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { accept: req.headers.get('accept') ?? 'application/json', ...extra };
  for (const name of ['accept-language', 'x-correlation-id', 'content-type']) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) headers['x-forwarded-for'] = ip;
  return headers;
}

/** Réponse de l'API relayée telle quelle (JSON, CSV, image d'un document). */
export async function relay(upstream: Response): Promise<NextResponse> {
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control', 'x-correlation-id', 'retry-after']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers });
}
