import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';
import { contentSecurityPolicy } from './src/lib/security-headers';

const production = process.env['NODE_ENV'] === 'production';
/**
 * Sites autorisés à intégrer la réservation (`/reserver`) en iframe, séparés par des espaces (WordPress, partenaires).
 * Lu au build (les en-têtes sont figés dans l'image) : argument de build de `apps/web/Dockerfile`, passé par
 * `infra/compose.prod.yml` et par la variable GitHub `BOOKING_FRAME_ANCESTORS` du flux Images. Transmis au proxy par la
 * clé `env` ci-dessous (valeur inscrite dans le bundle au build, comme avant).
 */
const bookingAncestors = process.env['BOOKING_FRAME_ANCESTORS'] || 'https://neomoov.net https://www.neomoov.net';

/**
 * Politique de sécurité du contenu : celle des pages porte un nonce par requête et vient du proxy (`src/proxy.ts`,
 * `src/lib/security-headers.ts`). Ici, seulement celle des routes `/api/*` (aucune page, scripts en ligne sans effet),
 * inchangée. `unsafe-eval` seulement en développement (rechargement à chaud).
 */
const apiCsp = contentSecurityPolicy('default', {
  production,
  apiBaseUrl: process.env['NEXT_PUBLIC_API_BASE_URL'] || 'http://localhost:4000',
  sentryDsn: process.env['NEXT_PUBLIC_SENTRY_DSN'],
});

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
  // Lu par le proxy (frame-ancestors de `/reserver`) : figé au build, comme l'étaient les en-têtes.
  env: { BOOKING_FRAME_ANCESTORS: bookingAncestors },
  headers: async () => [
    // Tout le site sauf la réservation et la saisie de carte : aucun cadrage par un autre site.
    { source: '/((?!reserver|carte).*)', headers: [...common, { key: 'X-Frame-Options', value: 'DENY' }] },
    // Routes d'API (passerelle, PDF, CSV) : pas de page, donc pas de nonce ; politique d'avant.
    { source: '/api/:path*', headers: [{ key: 'Content-Security-Policy', value: apiCsp }] },
    // Saisie de carte (étape 26) : jamais cadrée, aucun référent (la session est dans l'adresse) ; sources de Square dans la politique du proxy.
    {
      source: '/carte',
      headers: [
        ...common.filter((h) => h.key !== 'Referrer-Policy'), { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Cache-Control', value: 'private, no-store' },
      ],
    },
    // Réservation : intégrable en iframe sur les domaines autorisés seulement (frame-ancestors de la politique du proxy).
    { source: '/reserver', headers: common },
  ],
};

export default nextConfig;
