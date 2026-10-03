/**
 * Politique de sécurité du contenu (étape 26) : le Web Payments SDK de Square n'est permis que sur la page `/carte`,
 * servie sans référent et jamais cadrée ; le reste du site garde sa politique sans source de Square. Depuis la
 * finalisation, la politique des pages vient du proxy (nonce par requête) ; `next.config.ts` garde les autres en-têtes.
 */
import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';
import { contentSecurityPolicy, pageOf } from '../src/lib/security-headers';

const options = { production: true, apiBaseUrl: 'https://api.neomoov.net', nonce: 'bm9uY2U=' };

describe('en-têtes de la page de saisie de carte', () => {
  it('sources de Square sur /carte seulement, sans référent, jamais cadrée', async () => {
    const card = contentSecurityPolicy(pageOf('/carte'), options);
    expect(card).toMatch(/script-src[^;]*https:\/\/web\.squarecdn\.com[^;]*https:\/\/sandbox\.web\.squarecdn\.com/);
    expect(card).toMatch(/connect-src[^;]*https:\/\/pci-connect\.squareup\.com[^;]*https:\/\/pci-connect\.squareupsandbox\.com/);
    expect(card).toMatch(/frame-src[^;]*https:\/\/\*\.squarecdn\.com/);
    expect(card).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy(pageOf('/hub/releves'), options)).not.toContain('squarecdn');
    expect(contentSecurityPolicy(pageOf('/reserver'), options)).not.toContain('squarecdn');

    const rules = await nextConfig.headers!();
    const value = (source: string, key: string) => rules.find((r) => r.source === source)?.headers.find((h) => h.key === key)?.value ?? '';
    expect(value('/carte', 'Referrer-Policy')).toBe('no-referrer');
    expect(value('/carte', 'X-Frame-Options')).toBe('DENY');
    expect(value('/carte', 'Cache-Control')).toBe('private, no-store');

    const general = rules.find((r) => r.source.startsWith('/((?!'))!;
    expect(general.headers.find((h) => h.key === 'X-Frame-Options')?.value).toBe('DENY');
    const pattern = new RegExp(`^${general.source}$`);
    expect(pattern.test('/carte')).toBe(false);
    expect(pattern.test('/reserver')).toBe(false);
    expect(pattern.test('/hub/releves')).toBe(true);
    expect(pattern.test('/api/carte')).toBe(true);
    // Routes d'API : politique d'avant (pas de page, pas de nonce), sans Square.
    const api = value('/api/:path*', 'Content-Security-Policy');
    expect(api).toContain("frame-ancestors 'none'");
    expect(api).not.toContain('squarecdn');
  });
});
