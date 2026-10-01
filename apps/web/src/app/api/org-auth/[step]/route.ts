/**
 * Étape 21 : connexion des membres d'une organisation cliente à My Hub, relayée. Code SMS (comptes existants
 * seulement : un compte se crée par le lien d'invitation), puis, quand une permission sensible l'exige, second facteur
 * TOTP du membre (inscription ou vérification). Les jetons renvoyés par l'API sont posés en témoins `httpOnly` et retirés
 * de la réponse, comme pour le personnel ; le navigateur ne reçoit que le profil (et les codes de secours une fois).
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, CSRF_HEADER, REFRESH_COOKIE, forwardHeaders, refreshTokens, setSession } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

/** Étape web → route de l'API ; `auth` : la route exige le jeton de la session en cours. */
const STEPS: Record<string, { path: string; auth?: boolean }> = {
  request: { path: 'auth/otp/request' },
  verify: { path: 'auth/otp/verify' },
  'mfa-start': { path: 'auth/mfa/start', auth: true },
  'mfa-enroll': { path: 'auth/mfa/enroll' },
  'mfa-confirm': { path: 'auth/mfa/confirm' },
  'mfa-verify': { path: 'auth/mfa/verify' },
  'mfa-backup': { path: 'auth/mfa/backup' },
};

type Tokens = { accessToken: string; refreshToken: string; expiresIn?: number; user: { id: string; firstName: string | null; lastName: string | null; email: string | null; roles: string[] }; backupCodes?: string[] };

export async function POST(req: NextRequest, context: { params: Promise<{ step: string }> }): Promise<NextResponse> {
  const { step } = await context.params;
  const target = STEPS[step];
  if (!target) return NextResponse.json({ code: 'NOT_FOUND', message: 'Étape inconnue' }, { status: 404 });
  if (req.headers.get(CSRF_HEADER) !== '1') return NextResponse.json({ code: 'CSRF', message: 'En-tête de sécurité manquant' }, { status: 403 });
  const body = await req.text();
  const send = (token?: string) => fetch(`${API_URL}/v1/${target.path}`, {
    method: 'POST', headers: forwardHeaders(req, { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }), body, cache: 'no-store',
  });
  let renewed: Tokens | null = null;
  let upstream = await send(target.auth ? req.cookies.get(ACCESS_COOKIE)?.value : undefined);
  if (target.auth && upstream.status === 401) {
    renewed = (await refreshTokens(req.cookies.get(REFRESH_COOKIE)?.value)) as Tokens | null;
    if (renewed) upstream = await send(renewed.accessToken);
  }
  const payload = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok || typeof payload['accessToken'] !== 'string') {
    const res = NextResponse.json(payload, { status: upstream.status });
    if (renewed) setSession(res, renewed);
    return res;
  }
  const tokens = payload as unknown as Tokens;
  const res = NextResponse.json({ user: { id: tokens.user.id, firstName: tokens.user.firstName, lastName: tokens.user.lastName, roles: tokens.user.roles }, ...(tokens.backupCodes ? { backupCodes: tokens.backupCodes } : {}) });
  setSession(res, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, ...(tokens.expiresIn ? { expiresIn: tokens.expiresIn } : {}), user: tokens.user });
  return res;
}
