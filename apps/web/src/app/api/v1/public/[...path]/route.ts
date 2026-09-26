/**
 * Relais des pages publiques (réservation, inscription des chauffeurs) vers l'API publique limitée : la clé à portée
 * `public:write` reste côté serveur (`NEOMOOV_PUBLIC_API_KEY`) ; seules les routes listées sont relayées.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { API_URL, forwardHeaders, relay } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

const ALLOWED: Record<string, 'GET' | 'POST'> = { leads: 'POST', quotes: 'POST', 'places/autocomplete': 'GET', 'places/details': 'GET' };

async function handle(req: NextRequest, context: { params: Promise<{ path: string[] }> }): Promise<NextResponse> {
  const { path } = await context.params;
  const target = path.join('/');
  if (ALLOWED[target] !== req.method) return NextResponse.json({ code: 'NOT_RELAYED', message: 'Route non relayée' }, { status: 404 });
  const key = process.env['NEOMOOV_PUBLIC_API_KEY'];
  if (!key) return NextResponse.json({ code: 'PUBLIC_KEY_MISSING', message: 'Clé publique non configurée sur le serveur web' }, { status: 503 });
  const init: RequestInit = { method: req.method, headers: forwardHeaders(req, { authorization: `Bearer ${key}` }), cache: 'no-store' };
  if (req.method === 'POST') init.body = await req.text();
  return relay(await fetch(`${API_URL}/v1/public/${target}${req.nextUrl.search}`, init));
}

export { handle as GET, handle as POST };
