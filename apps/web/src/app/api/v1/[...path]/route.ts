/**
 * Relais authentifié de My Hub : `/api/v1/*` du web vers `/v1/*` de l'API, avec le jeton du témoin `httpOnly`.
 * Écritures : en-tête anti-CSRF exigé. Jeton expiré : renouvellement une fois, puis nouvel essai. Seules les routes
 * du personnel sont relayées (`admin/*`, `auth/logout`, `me`) : le relais n'élargit jamais ce que le jeton permet.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, CSRF_HEADER, REFRESH_COOKIE, clearSession, forwardHeaders, refreshTokens, relay, setSession } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

const ALLOWED = /^(admin\/.+|me|me\/consents|quotes|places\/(autocomplete|details))$/;

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const target = path.join('/');
  if (!ALLOWED.test(target)) return NextResponse.json({ code: 'NOT_RELAYED', message: 'Route non relayée' }, { status: 404 });
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.get(CSRF_HEADER) !== '1') return NextResponse.json({ code: 'CSRF', message: 'En-tête de sécurité manquant' }, { status: 403 });
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const url = `${API_URL}/v1/${target}${req.nextUrl.search}`;
  const send = (token: string | undefined) => fetch(url, { method: req.method, headers: forwardHeaders(req, token ? { authorization: `Bearer ${token}` } : {}), body, cache: 'no-store' });

  let upstream = await send(req.cookies.get(ACCESS_COOKIE)?.value);
  if (upstream.status !== 401) return relay(upstream);
  const tokens = await refreshTokens(req.cookies.get(REFRESH_COOKIE)?.value);
  if (!tokens) {
    const res = await relay(upstream);
    clearSession(res);
    return res;
  }
  upstream = await send(tokens.accessToken);
  const res = await relay(upstream);
  setSession(res, tokens);
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
