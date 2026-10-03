/**
 * Lecture de la session de la page de saisie de carte (revue du 2 octobre 2026, sécurité 16) : le navigateur lit la
 * session dans le fragment de l'adresse (jamais envoyé à un serveur) et l'envoie ici dans le corps ; le serveur web la
 * relaie à l'API dans un corps aussi. Aucune chaîne de requête ne porte la session, donc aucun journal d'accès.
 * En-tête `x-neomoov-card` exigé, comme pour la confirmation.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { loadCardSession } from '@/lib/server/card-session';
import { API_URL, forwardHeaders } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

const MAX_BODY = 1_024;
const NO_STORE = { 'cache-control': 'no-store' };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('x-neomoov-card') !== '1') return NextResponse.json({ code: 'CSRF', message: 'En-tête de sécurité manquant' }, { status: 403, headers: NO_STORE });
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Requête trop volumineuse' }, { status: 413, headers: NO_STORE });
  let session: unknown = null;
  try {
    session = (JSON.parse(text) as { session?: unknown }).session ?? null;
  } catch {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Requête invalide' }, { status: 400, headers: NO_STORE });
  }
  const headers = forwardHeaders(req);
  delete headers['content-type'];
  const state = await loadCardSession(typeof session === 'string' ? session : null, { apiUrl: API_URL, headers });
  return NextResponse.json(state, { headers: NO_STORE });
}
