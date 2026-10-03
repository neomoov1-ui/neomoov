/**
 * Politique de sécurité du contenu du web (revue finale V1, lancement commercial) : les pages reçoivent un nonce par
 * requête (`proxy.ts`), les scripts en ligne ne sont plus permis. `'strict-dynamic'` laisse les scripts chargés par un
 * script de confiance (morceaux de Next.js, Turnstile, Web Payments SDK de Square) ; les sources nommées restent pour les
 * navigateurs qui l'ignorent. Les styles en ligne restent permis (attributs `style` de React, de Leaflet et de la marque
 * d'une organisation) : un nonce dans `style-src` y ferait ignorer `'unsafe-inline'`. Sans nonce (routes `/api/*`, qui ne
 * servent pas de page), la politique d'avant est gardée. Fonctions pures, testées ; lues par `next.config.ts` (au build)
 * et par `proxy.ts` (à chaque requête).
 */

export const TURNSTILE = 'https://challenges.cloudflare.com';
export const TILES = 'https://tile.openstreetmap.org https://*.tile.openstreetmap.org';
export const DEFAULT_BOOKING_ANCESTORS = 'https://neomoov.net https://www.neomoov.net';

/**
 * Web Payments SDK de Square (étape 26), page `/carte` seulement : script et cadres des champs de carte, appels de
 * tokenisation (pci-connect), polices et images du formulaire, vérification 3-D Secure, suivi d'erreurs du SDK. Liste
 * de la documentation de Square (production et bac à sable), élargie aux sous-domaines de son CDN.
 */
export const SQUARE = {
  script: 'https://web.squarecdn.com https://sandbox.web.squarecdn.com https://*.squarecdn.com',
  frame: 'https://*.squarecdn.com https://*.squareup.com https://*.squareupsandbox.com https://*.cardinalcommerce.com',
  connect: 'https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://*.squareup.com https://*.squareupsandbox.com https://*.squarecdn.com https://o160250.ingest.sentry.io',
  style: 'https://*.squarecdn.com',
  font: 'https://*.squarecdn.com https://d1g145x70srn7h.cloudfront.net',
  img: 'https://*.squarecdn.com',
};
type Extra = Partial<Record<keyof typeof SQUARE, string>>;

/** Pages à politique propre : la réservation (intégrable en iframe chez les sites autorisés) et la saisie de carte. */
export type CspPage = 'default' | 'booking' | 'card';

export interface CspOptions {
  production: boolean;
  /** Adresse de l'API vue du navigateur (`NEXT_PUBLIC_API_BASE_URL`). */
  apiBaseUrl: string;
  /** DSN public de Sentry (`NEXT_PUBLIC_SENTRY_DSN`) : son adresse d'ingestion est permise ; vide, rien. */
  sentryDsn?: string | undefined;
  /** Sites autorisés à intégrer `/reserver` (`BOOKING_FRAME_ANCESTORS`, figé au build). */
  bookingAncestors?: string | undefined;
  /** Nonce de la requête ; absent : scripts en ligne permis (routes `/api/*` seulement). */
  nonce?: string | undefined;
}

export function pageOf(pathname: string): CspPage {
  if (pathname === '/reserver' || pathname.startsWith('/reserver/')) return 'booking';
  if (pathname === '/carte' || pathname.startsWith('/carte/')) return 'card';
  return 'default';
}

function originOf(url: string | undefined): string {
  if (!url?.trim()) return '';
  try {
    return new URL(url.trim()).origin;
  } catch {
    return '';
  }
}

export function contentSecurityPolicy(page: CspPage, options: CspOptions): string {
  const extra: Extra = page === 'card' ? SQUARE : {};
  const more = (key: keyof Extra) => (extra[key] ? ` ${extra[key]}` : '');
  const apiOrigin = originOf(options.apiBaseUrl) || 'http://localhost:4000';
  const socketOrigin = apiOrigin.replace(/^http/, 'ws');
  const sentry = originOf(options.sentryDsn);
  const frameAncestors = page === 'booking' ? `'self' ${options.bookingAncestors?.trim() || DEFAULT_BOOKING_ANCESTORS}` : "'none'";
  const scripts = options.nonce ? `'self' 'nonce-${options.nonce}' 'strict-dynamic'` : "'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src ${scripts} ${TURNSTILE}${more('script')}${options.production ? '' : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'${more('style')}`,
    // `https:` : logo d'une organisation hébergé chez elle (marque par organisation, étape 22), images seulement.
    `img-src 'self' data: blob: https: ${TILES}${more('img')}`,
    `font-src 'self' data:${more('font')}`,
    // `https://neomoov.net` : vérification des attestations Neomoov Chauffeur Pro (API publique de l'Academy) depuis My Hub.
    `connect-src 'self' ${apiOrigin} ${socketOrigin} ${TURNSTILE} https://neomoov.net${sentry ? ` ${sentry}` : ''}${more('connect')}`,
    `frame-src 'self' blob: ${TURNSTILE}${more('frame')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    ...(options.production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** Nonce d'une requête : 16 octets aléatoires en base 64 (Web Crypto, disponible dans Node.js comme à la périphérie). */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
