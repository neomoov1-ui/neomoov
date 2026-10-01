/**
 * Confirmation de la page de saisie de carte (étape 26) : le navigateur envoie la session signée et le jeton de carte du
 * Web Payments SDK ; le serveur web les valide et les relaie à l'API, sans autre en-tête d'autorisation que la session.
 * En-tête `x-neomoov-card` exigé : un formulaire d'un autre site ne peut pas l'ajouter sans accord CORS.
 */
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { confirmCardSession } from '@/lib/server/card-session';
import { API_URL, forwardHeaders } from '@/lib/server/gateway';

export const dynamic = 'force-dynamic';

/** Corps attendu : quelques centaines d'octets (session, jeton de carte, jeton de vérification). */
const MAX_BODY = 4_096;
const NO_STORE = { 'cache-control': 'no-store' };

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('x-neomoov-card') !== '1') return NextResponse.json({ code: 'CSRF', message: 'En-tête de sécurité manquant' }, { status: 403, headers: NO_STORE });
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Requête trop volumineuse' }, { status: 413, headers: NO_STORE });
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return NextResponse.json({ code: 'VALIDATION_ERROR', message: 'Requête invalide' }, { status: 400, headers: NO_STORE });
  }
  const headers = forwardHeaders(req);
  delete headers['content-type'];
  const result = await confirmCardSession(input, { apiUrl: API_URL, headers });
  return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
}
