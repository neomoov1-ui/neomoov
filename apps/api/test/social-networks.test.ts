import { describe, expect, it } from 'vitest';
import { authorizeUrl, exchangeCode, pkceChallenge, refreshTokens, SocialNetworkError, validateAccount, validateTelegram, type NetworkOptions } from '../src/modules/marketing/social-networks.js';

/**
 * Réseaux sociaux (3 octobre 2026) : écrans d'autorisation par réseau (paramètres attendus, PKCE), échanges et
 * rafraîchissements contre un serveur HTTP simulé, classement des erreurs, aucun secret dans les messages.
 */
const app = { clientId: 'client-id', clientSecret: 'client-secret' };
const BOT = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const options = (fetch: typeof globalThis.fetch): NetworkOptions => ({ fetch, graphVersion: 'v21.0', linkedinVersion: '202606' });
const input = { app, redirectUri: 'https://api.neomoov.net/v1/social/oauth/callback/x', state: 'etat', codeVerifier: 'v'.repeat(43), graphVersion: 'v21.0' };

describe('réseaux sociaux : appels aux réseaux (serveur simulé)', () => {
  it('écrans d\'autorisation : paramètres de chaque réseau, PKCE pour X et Google seulement', () => {
    const x = new URL(authorizeUrl('x', input));
    expect(x.searchParams.get('code_challenge')).toBe(pkceChallenge('v'.repeat(43)));
    expect(x.searchParams.get('scope')).toContain('offline.access');
    const tiktok = new URL(authorizeUrl('tiktok', input));
    expect(tiktok.searchParams.get('client_key')).toBe('client-id');
    expect(tiktok.searchParams.get('code_challenge')).toBeNull();
    const google = new URL(authorizeUrl('google', input));
    expect(google.searchParams.get('access_type')).toBe('offline');
    expect(google.searchParams.get('prompt')).toBe('consent');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    const linkedin = new URL(authorizeUrl('linkedin', input));
    expect(linkedin.origin + linkedin.pathname).toBe('https://www.linkedin.com/oauth/v2/authorization');
    expect(linkedin.searchParams.get('scope')).toBe('r_organization_social w_organization_social rw_organization_admin');
    for (const url of [x, tiktok, google, linkedin]) expect(url.searchParams.get('state')).toBe('etat');
  });

  it('échange et rafraîchissement : jetons, échéances, jeton de rafraîchissement gardé quand le réseau n\'en rend pas', async () => {
    const tiktok = await exchangeCode('tiktok', options(async () => json(200, { access_token: 'a', refresh_token: 'r', expires_in: 86_400, refresh_expires_in: 31_536_000, open_id: 'o', scope: 'user.info.basic,video.publish' })), { app, code: 'c', redirectUri: 'u', codeVerifier: 'v' });
    expect(tiktok).toMatchObject({ accessToken: 'a', refreshToken: 'r', subject: 'o', scopes: ['user.info.basic', 'video.publish'] });
    expect(tiktok.refreshExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 300 * 86_400_000);
    const google = await refreshTokens('google', options(async () => json(200, { access_token: 'nouveau', expires_in: 3599 })), { app, refreshToken: 'garde' });
    expect(google).toMatchObject({ accessToken: 'nouveau', refreshToken: 'garde' });
    await expect(refreshTokens('x', options(async () => json(400, { error: 'invalid_grant', error_description: 'Value passed for the token was invalid.' })), { app, refreshToken: 'r' })).rejects.toMatchObject({ kind: 'expired' });
    await expect(refreshTokens('linkedin', options(async () => json(503, {})), { app, refreshToken: 'r' })).rejects.toMatchObject({ kind: 'transient' });
    await expect(refreshTokens('meta', options(async () => json(200, {})), { app, refreshToken: 'r' })).rejects.toBeInstanceOf(SocialNetworkError);
  });

  it('validation : jeton Meta expiré (190, 463), réseau injoignable, compte relu', async () => {
    await expect(validateAccount('facebook', options(async () => json(400, { error: { code: 190, error_subcode: 463, message: 'expired' } })), { pageId: '1', pageToken: 't' })).rejects.toMatchObject({ kind: 'expired' });
    await expect(validateAccount('x', options(async () => { throw new TypeError('fetch failed'); }), { accessToken: 't' })).rejects.toMatchObject({ kind: 'transient' });
    await expect(validateAccount('youtube', options(async () => json(200, { items: [{ id: 'UC1', snippet: { title: 'Neomoov', customUrl: '@neomoov' } }] })), { accessToken: 't' })).resolves.toEqual({ accountId: 'UC1', accountName: 'Neomoov', profileUrl: 'https://www.youtube.com/@neomoov' });
    await expect(validateAccount('snapchat', options(async () => json(200, {})), {})).rejects.toMatchObject({ kind: 'config' });
  });

  it('Telegram : bot sans droit de publier refusé, jeton jamais cité dans le message', async () => {
    const fetch: typeof globalThis.fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/getMe')) return json(200, { ok: true, result: { id: 7, username: 'neomoov_bot' } });
      if (path.endsWith('/getChat')) return json(200, { ok: true, result: { id: -100123456, type: 'channel', title: 'Neomoov' } });
      return json(200, { ok: true, result: { status: 'administrator', can_post_messages: false } });
    };
    const error = await validateTelegram(options(fetch), { botToken: BOT, channel: '@neomoov' }).catch((e: unknown) => e as SocialNetworkError);
    expect(error).toMatchObject({ kind: 'invalid' });
    expect((error as Error).message).toContain('Publier des messages');
    const refused = await validateTelegram(options(async () => json(401, { ok: false, description: `Unauthorized ${BOT}` })), { botToken: BOT, channel: '@neomoov' }).then(() => null, (e: unknown) => e as Error);
    expect(refused?.message).toContain('[jeton]');
    expect(refused?.message).not.toContain(BOT);
  });
});
