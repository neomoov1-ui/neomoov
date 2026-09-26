/**
 * Session de My Hub : profil du membre du personnel connecté (témoin `httpOnly`) et déconnexion (révocation du jeton de
 * rafraîchissement auprès de l'API, témoins effacés). Le jeton d'accès court sert aussi au socket `/admin` du tableau
 * de bord : il est remis au navigateur à la demande (15 minutes), jamais le jeton de rafraîchissement.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, CSRF_HEADER, REFRESH_COOKIE, clearSession, refreshTokens, sessionUser, setSession } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const user = sessionUser(req);
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Session absente' }, { status: 401 });
  if (req.nextUrl.searchParams.get('socket') !== '1') return NextResponse.json({ user });
  let token = req.cookies.get(ACCESS_COOKIE)?.value;
  let refreshed = null;
  if (!token) {
    refreshed = await refreshTokens(req.cookies.get(REFRESH_COOKIE)?.value);
    token = refreshed?.accessToken;
  }
  if (!token) return NextResponse.json({ code: 'UNAUTHENTICATED', message: 'Session expirée' }, { status: 401 });
  const res = NextResponse.json({ user, socketToken: token });
  if (refreshed) setSession(res, refreshed);
  return res;
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get(CSRF_HEADER) !== '1') return NextResponse.json({ code: 'CSRF', message: 'En-tête de sécurité manquant' }, { status: 403 });
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  if (refreshToken && access) {
    await fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${access}` }, body: JSON.stringify({ refreshToken }), cache: 'no-store' }).catch(() => undefined);
  }
  const res = new NextResponse(null, { status: 204 });
  clearSession(res);
  return res;
}
