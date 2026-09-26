import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const production = process.env['NODE_ENV'] === 'production';
const apiOrigin = new URL(process.env['NEXT_PUBLIC_API_BASE_URL'] || 'http://localhost:4000').origin;
const socketOrigin = apiOrigin.replace(/^http/, 'ws');
const TURNSTILE = 'https://challenges.cloudflare.com';
const TILES = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';
/** Sites autorisés à intégrer la réservation (`/reserver`) en iframe, séparés par des espaces (WordPress, partenaires). */
const bookingAncestors = process.env['BOOKING_FRAME_ANCESTORS'] || 'https://neomoov.net https://www.neomoov.net';

/**
 * Politique de sécurité du contenu. Les scripts en ligne restent permis (amorçage de Next.js sans nonce) : le passage
 * aux nonces se fait avec le durcissement de l'étape 14. `unsafe-eval` seulement en développement (rechargement à chaud).
 */
function csp(frameAncestors: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TURNSTILE}${production ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${TILES}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin} ${socketOrigin} ${TURNSTILE}`,
    `frame-src 'self' blob: ${TURNSTILE}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  ...(production ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Image Docker minimale (apps/web/Dockerfile) : serveur autonome, tracé depuis la racine du monorepo.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  // Les paquets internes sont consommés depuis leur dist compilé (ESM) ; domain reste transpilé pour ses sources partagées.
  transpilePackages: ['@neomoov/domain'],
  headers: async () => [
    // Tout le site sauf la réservation : aucun cadrage par un autre site.
    { source: '/((?!reserver).*)', headers: [...common, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: csp("'none'") }] },
    // Réservation : intégrable en iframe sur les domaines autorisés seulement.
    { source: '/reserver', headers: [...common, { key: 'Content-Security-Policy', value: csp(`'self' ${bookingAncestors}`) }] },
  ],
};

export default nextConfig;
