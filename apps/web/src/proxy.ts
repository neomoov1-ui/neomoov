/**
 * Proxy Next.js (anciennement « middleware ») : politique de sécurité du contenu avec un nonce par requête sur chaque
 * page (revue finale V1, lancement commercial). Next.js lit le nonce dans l'en-tête de la requête et l'ajoute à ses
 * scripts ; toutes les pages sont rendues à la demande (la mise en page racine lit les témoins), donc chaque page reçoit
 * le sien. Les routes `/api/*`, les fichiers statiques et les préchargements du routeur gardent les en-têtes de
 * `next.config.ts`. `BOOKING_FRAME_ANCESTORS` est figé au build (clé `env` de `next.config.ts`).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy, createNonce, pageOf } from './lib/security-headers';

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = contentSecurityPolicy(pageOf(request.nextUrl.pathname), {
    production: process.env.NODE_ENV === 'production',
    apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000',
    sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    bookingAncestors: process.env.BOOKING_FRAME_ANCESTORS,
    nonce,
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Tout sauf les routes d'API et les fichiers de Next.js (un fichier public reçoit la politique, sans effet). Pas
      // d'exclusion par extension : un chemin de page peut contenir un point (jeton de suivi).
      source: '/((?!api(?:/|$)|_next/static|_next/image|favicon\\.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
