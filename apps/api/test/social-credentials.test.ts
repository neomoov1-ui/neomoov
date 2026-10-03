import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { credentialsReady, EnvSocialCredentialsProvider } from '../src/modules/marketing/social-credentials.js';

/**
 * Fournisseur des identifiants des comptes (contrat du 3 octobre 2026), implémentation par défaut : variables
 * d'environnement. Modes direct et relais manuel (sans agrégateur, décision du fondateur) ; compte signalé refusé.
 */
const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/neomoov_test' };

describe('identifiants des comptes par les variables d\'environnement', () => {
  it('direct, manuel, aucun compte ; LinkedIn prêt avec un jeton d\'accès ou un jeton de rafraîchissement et l\'application', async () => {
    const provider = new EnvSocialCredentialsProvider(loadEnv({
      ...base, X_CLIENT_ID: 'x-id', X_REFRESH_TOKEN: 'x-rt', TELEGRAM_BOT_TOKEN: '123:abc', TELEGRAM_CHANNEL_ID: '@neomoov',
      SNAPCHAT_ACCESS_TOKEN: 'ignore', LINKEDIN_ORGANIZATION_ID: '4242', LINKEDIN_ACCESS_TOKEN: 'li', LINKEDIN_ACCESS_TOKEN_EXPIRES_AT: '2026-11-30',
    }, { dotenv: false }));
    expect(await provider.get('x')).toEqual({ mode: 'direct', values: { clientId: 'x-id', refreshToken: 'x-rt' }, accountId: null, accountName: null, profileUrl: null, expiresAt: null });
    expect(await provider.get('telegram')).toMatchObject({ mode: 'direct', values: { botToken: '123:abc', channelId: '@neomoov' }, accountId: '@neomoov', profileUrl: 'https://t.me/neomoov' });
    expect(await provider.get('tiktok')).toBeNull();
    // Snapchat et la chaîne WhatsApp : relais manuel, quelles que soient les variables.
    expect(await provider.get('snapchat')).toEqual({ mode: 'manual', values: {}, accountId: null, accountName: null, profileUrl: null, expiresAt: null });
    expect(await provider.get('whatsapp_channel')).toMatchObject({ mode: 'manual', values: {} });
    expect(await provider.get('youtube')).toBeNull();
    const linkedin = await provider.get('linkedin');
    expect(linkedin).toMatchObject({ mode: 'direct', accountId: '4242', expiresAt: new Date('2026-11-30'), profileUrl: 'https://www.linkedin.com/company/4242/' });
    expect(credentialsReady('linkedin', { ...linkedin!, values: { organizationId: '1', refreshToken: 'r' } })).toBe(false);
    expect(credentialsReady('linkedin', { ...linkedin!, values: { organizationId: '1', refreshToken: 'r', clientId: 'c', clientSecret: 's' } })).toBe(true);
    // Compte refusé : plus rendu jusqu'au redémarrage ; les autres espaces ne changent pas.
    await provider.markInvalid('x', 'X : jeton de rafraîchissement refusé (invalid_request)');
    expect(await provider.get('x')).toBeNull();
    expect(await provider.get('telegram')).not.toBeNull();
    expect(JSON.stringify(provider)).not.toMatch(/x-rt|abc/);
    expect(credentialsReady('x', { mode: 'aggregator', values: { apiKey: 'k' }, accountId: null, accountName: null, profileUrl: null, expiresAt: null })).toBe(false);
  });
});
