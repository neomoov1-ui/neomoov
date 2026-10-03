/**
 * Politique de sécurité du contenu avec nonce (revue finale V1, lancement commercial) : aucun script en ligne permis sur
 * une page, un nonce neuf par requête transmis à Next.js (en-tête de la requête) et au navigateur (en-tête de la
 * réponse), Turnstile, Sentry et l'API permis, réservation intégrable seulement chez les sites autorisés.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '../src/proxy';
import { contentSecurityPolicy, createNonce, DEFAULT_BOOKING_ANCESTORS, pageOf } from '../src/lib/security-headers';

const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

describe('politique des pages avec nonce', () => {
  it('scripts : nonce et strict-dynamic, jamais unsafe-inline ; unsafe-eval en développement seulement', () => {
    const prod = contentSecurityPolicy('default', { production: true, apiBaseUrl: 'https://api.neomoov.net/v1', sentryDsn: 'https://abc@o1.ingest.sentry.io/2', nonce: 'QUJDRA==' });
    const scripts = directive(prod, 'script-src');
    expect(scripts).toContain("'nonce-QUJDRA=='");
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).toContain('https://challenges.cloudflare.com');
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(directive(prod, 'connect-src')).toContain('https://api.neomoov.net wss://api.neomoov.net https://challenges.cloudflare.com https://neomoov.net https://o1.ingest.sentry.io');
    expect(directive(prod, 'frame-src')).toContain('https://challenges.cloudflare.com');
    expect(prod).toContain("frame-ancestors 'none'");
    expect(prod).toContain('upgrade-insecure-requests');
    // Styles en ligne gardés (attributs de React, de Leaflet, couleurs d'une marque) : pas de nonce dans style-src.
    expect(directive(prod, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    const dev = contentSecurityPolicy('default', { production: false, apiBaseUrl: 'http://localhost:4000', nonce: 'QUJDRA==' });
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
    expect(dev).not.toContain('upgrade-insecure-requests');
  });

  it('réservation : intégrable chez les sites autorisés ; autres pages jamais cadrées', () => {
    expect(pageOf('/reserver')).toBe('booking');
    expect(pageOf('/carte')).toBe('card');
    expect(pageOf('/hub/connexion')).toBe('default');
    expect(pageOf('/reservations')).toBe('default');
    expect(contentSecurityPolicy('booking', { production: true, apiBaseUrl: 'https://api.neomoov.net' })).toContain(`frame-ancestors 'self' ${DEFAULT_BOOKING_ANCESTORS}`);
    expect(contentSecurityPolicy('booking', { production: true, apiBaseUrl: 'https://api.neomoov.net', bookingAncestors: 'https://partenaire.ca' })).toContain("frame-ancestors 'self' https://partenaire.ca");
  });

  it('un nonce neuf par requête, imprévisible', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(nonces.size).toBe(50);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('le proxy pose la politique sur la réponse et la transmet à Next.js dans la requête (nonce des scripts du rendu)', () => {
    const first = proxy(new NextRequest('http://localhost:3000/reserver'));
    const second = proxy(new NextRequest('http://localhost:3000/hub/connexion'));
    const policy = first.headers.get('content-security-policy')!;
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    expect(nonce).toBeTruthy();
    expect(policy).toContain("frame-ancestors 'self'");
    // En-têtes de la requête réécrits pour le rendu (mécanisme de NextResponse.next).
    expect(first.headers.get('x-middleware-request-x-nonce')).toBe(nonce);
    expect(first.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(second.headers.get('content-security-policy')).not.toContain(nonce!);
    expect(second.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('le proxy laisse les routes d\'API et les fichiers de Next.js, et les préchargements du routeur', () => {
    const matcher = config.matcher[0]!;
    const pattern = new RegExp(`^${matcher.source}$`);
    for (const path of ['/', '/reserver', '/carte', '/hub', '/hub/organisations', '/suivi/abc.def', '/robots.txt']) expect(pattern.test(path), path).toBe(true);
    for (const path of ['/api/v1/admin/rides', '/api/session', '/api', '/_next/static/chunks/main.js', '/_next/image', '/favicon.ico']) expect(pattern.test(path), path).toBe(false);
    expect(matcher.missing.map((m) => m.key)).toEqual(['next-router-prefetch', 'purpose']);
  });
});
