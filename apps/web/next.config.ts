import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

const production = process.env['NODE_ENV'] === 'production';
const apiOrigin = new URL(process.env['NEXT_PUBLIC_API_BASE_URL'] || 'http://localhost:4000').origin;
const socketOrigin = apiOrigin.replace(/^http/, 'ws');
const TURNSTILE = 'https://challenges.cloudflare.com';
const TILES = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';
/**
 * Sites autorisés à intégrer la réservation (`/reserver`) en iframe, séparés par des espaces (WordPress, partenaires).
 * Lu au build (les en-têtes sont figés dans l'image) : argument de build de `apps/web/Dockerfile`, passé par
 * `infra/compose.prod.yml` et par la variable GitHub `BOOKING_FRAME_ANCESTORS` du flux Images.
 */
const bookingAncestors = process.env['BOOKING_FRAME_ANCESTORS'] || 'https://neomoov.net https://www.neomoov.net';

/**
 * Web Payments SDK de Square (étape 26), page `/carte` seulement : script et cadres des champs de carte, appels de
 * tokenisation (pci-connect), polices et images du formulaire, vérification 3-D Secure, suivi d'erreurs du SDK. Liste
 * de la documentation de Square (production et bac à sable), élargie aux sous-domaines de son CDN.
 */
const SQUARE = {
  script: 'https://web.squarecdn.com https://sandbox.web.squarecdn.com https://*.squarecdn.com',
  frame: 'https://*.squarecdn.com https://*.squareup.com https://*.squareupsandbox.com https://*.cardinalcommerce.com',
  connect: 'https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://*.squareup.com https://*.squareupsandbox.com https://*.squarecdn.com https://o160250.ingest.sentry.io',
  style: 'https://*.squarecdn.com',
  font: 'https://*.squarecdn.com https://d1g145x70srn7h.cloudfront.net',
  img: 'https://*.squarecdn.com',
};
type Extra = Partial<Record<keyof typeof SQUARE, string>>;

/** Suivi des erreurs (Sentry) : le navigateur envoie les événements à l'adresse d'ingestion du DSN ; rien sans DSN. */
function sentryOrigin(): string {
  const dsn = process.env['NEXT_PUBLIC_SENTRY_DSN']?.trim();
  if (!dsn) return '';
  try {
    return ` ${new URL(dsn).origin}`;
  } catch {
    return '';
  }
}

/**
 * Politique de sécurité du contenu. Les scripts en ligne restent permis (amorçage de Next.js sans nonce) : le passage
 * aux nonces se fait avec le durcissement de l'étape 14. `unsafe-eval` seulement en développement (rechargement à chaud).
 */
function csp(frameAncestors: string, extra: Extra = {}): string {
  const more = (key: keyof Extra) => (extra[key] ? ` ${extra[key]}` : '');
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TURNSTILE}${more('script')}${production ? '' : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'${more('style')}`,
    // `https:` : logo d'une organisation hébergé chez elle (marque par organisation, étape 22), images seulement.
    `img-src 'self' data: blob: https: ${TILES}${more('img')}`,
    `font-src 'self' data:${more('font')}`,
    `connect-src 'self' ${apiOrigin} ${socketOrigin} ${TURNSTILE}${sentryOrigin()}${more('connect')}`,
    `frame-src 'self' blob: ${TURNSTILE}${more('frame')}`,
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
    // Tout le site sauf la réservation et la saisie de carte : aucun cadrage par un autre site.
    { source: '/((?!reserver|carte).*)', headers: [...common, { key: 'X-Frame-Options', value: 'DENY' }, { key: 'Content-Security-Policy', value: csp("'none'") }] },
    // Saisie de carte (étape 26) : formulaire de Square permis, jamais cadrée, aucun référent (la session est dans l'adresse).
    {
      source: '/carte',
      headers: [
        ...common.filter((h) => h.key !== 'Referrer-Policy'), { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Cache-Control', value: 'private, no-store' }, { key: 'Content-Security-Policy', value: csp("'none'", SQUARE) },
      ],
    },
    // Réservation : intégrable en iframe sur les domaines autorisés seulement.
    { source: '/reserver', headers: [...common, { key: 'Content-Security-Policy', value: csp(`'self' ${bookingAncestors}`) }] },
  ],
};

export default nextConfig;
