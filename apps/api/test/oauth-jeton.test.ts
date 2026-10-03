import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authorizeUrl, createPkce, exchangeCode, parseRedirect, PROVIDER_SPECS, waitForCode, writeTokenFile } from '../src/scripts/oauth-authorization.js';
import { SocialServer } from './social-server.js';

/**
 * Outil `oauth:jeton` (3 octobre 2026) : adresse de l'écran d'autorisation par réseau (portées, PKCE, accès hors ligne de
 * Google), échange du code contre un serveur simulé, retour reçu sur l'adresse locale, jeton écrit dans un fichier du
 * dossier des clés (jamais dans un `.env`, jamais affiché). Le dossier des clés de l'essai est temporaire.
 */
describe('outil oauth:jeton', () => {
  it('adresses d\'autorisation : Google (hors ligne, PKCE), TikTok (client_key, défi hexadécimal), LinkedIn (sans PKCE), X (offline.access)', () => {
    const pkce = createPkce('base64url', 'v'.repeat(64));
    expect(pkce.challenge).toBe(createHash('sha256').update('v'.repeat(64)).digest('base64url'));
    const google = new URL(authorizeUrl(PROVIDER_SPECS['google-business'], { clientId: 'id.apps.googleusercontent.com', redirectUri: 'http://127.0.0.1:53682/rappel', state: 'etat', pkce }));
    expect(Object.fromEntries(google.searchParams)).toEqual({
      client_id: 'id.apps.googleusercontent.com', response_type: 'code', redirect_uri: 'http://127.0.0.1:53682/rappel', scope: 'https://www.googleapis.com/auth/business.manage', state: 'etat',
      code_challenge: pkce.challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    });
    expect(new URL(authorizeUrl(PROVIDER_SPECS.youtube, { clientId: 'c', redirectUri: 'r', state: 's', pkce })).searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.force-ssl');
    const hex = createPkce('hex', 'w'.repeat(64));
    expect(hex.challenge).toBe(createHash('sha256').update('w'.repeat(64)).digest('hex'));
    const tiktok = new URL(authorizeUrl(PROVIDER_SPECS.tiktok, { clientId: 'aw-cle', redirectUri: 'https://neomoov.net/oauth/rappel', state: 's', pkce: hex }));
    expect(tiktok.searchParams.get('client_key')).toBe('aw-cle');
    expect(tiktok.searchParams.get('client_id')).toBeNull();
    expect(tiktok.searchParams.get('scope')).toBe('user.info.basic,video.publish,video.upload,video.list');
    const linkedin = new URL(authorizeUrl(PROVIDER_SPECS.linkedin, { clientId: 'li', redirectUri: 'r', state: 's', pkce: null }));
    expect(linkedin.searchParams.get('code_challenge')).toBeNull();
    expect(linkedin.searchParams.get('scope')).toBe('w_organization_social r_organization_social rw_organization_admin');
    expect(new URL(authorizeUrl(PROVIDER_SPECS.x, { clientId: 'x', redirectUri: 'r', state: 's', pkce })).searchParams.get('scope')).toContain('offline.access');
  });

  it('échange du code : Basic chez X, secret et vérificateur dans le corps chez Google ; erreur sans secret', async () => {
    const pkce = createPkce('base64url');
    const server = new SocialServer()
      .on('POST', 'api.x.com/2/oauth2/token', { json: { access_token: 'acces', refresh_token: 'rt-x', expires_in: 7_200, scope: 'tweet.write offline.access' } })
      .on('POST', 'oauth2.googleapis.com/token', { json: { access_token: 'ya29', refresh_token: '1//rt', expires_in: 3_599 } }, { status: 400, json: { error: 'invalid_grant', error_description: 'Bad Request' } });
    expect(await exchangeCode(PROVIDER_SPECS.x, { clientId: 'x-id', clientSecret: 'x-secret', code: 'code-x', redirectUri: 'http://127.0.0.1:1/rappel', pkce }, server.fetch)).toMatchObject({ refreshToken: 'rt-x', expiresIn: 7_200 });
    const x = server.to('api.x.com')[0]!;
    expect(x.headers['authorization']).toBe(`Basic ${Buffer.from('x-id:x-secret').toString('base64')}`);
    expect(x.form).toEqual({ grant_type: 'authorization_code', code: 'code-x', redirect_uri: 'http://127.0.0.1:1/rappel', client_id: 'x-id', code_verifier: pkce.verifier });
    expect(await exchangeCode(PROVIDER_SPECS.youtube, { clientId: 'g', clientSecret: 'GOCSPX-s', code: 'c', redirectUri: 'r', pkce }, server.fetch)).toMatchObject({ refreshToken: '1//rt' });
    expect(server.to('googleapis')[0]!.form).toMatchObject({ client_id: 'g', client_secret: 'GOCSPX-s', code_verifier: pkce.verifier });
    const error = await exchangeCode(PROVIDER_SPECS.youtube, { clientId: 'g', clientSecret: 'GOCSPX-s', code: 'c', redirectUri: 'r', pkce }, server.fetch).catch((e: Error) => e);
    expect((error as Error).message).toBe('YouTube : échange du code refusé (invalid_grant : Bad Request)');
  });

  it('retour sur l\'adresse locale : code rendu si l\'état concorde, refus sinon ; jeton écrit seul dans le dossier des clés', async () => {
    const port = 54000 + Math.floor(Math.random() * 1_000);
    const received = await waitForCode(port, 'bon-etat', async (redirect) => {
      expect(redirect).toBe(`http://127.0.0.1:${port}/rappel`);
      const page = await fetch(`${redirect}?code=le-code&state=bon-etat`);
      expect(await page.text()).toContain('Autorisation reçue');
    });
    expect(received).toEqual({ code: 'le-code', redirectUri: `http://127.0.0.1:${port}/rappel` });
    await expect(waitForCode(port + 1, 'bon-etat', async (redirect) => { await fetch(`${redirect}?code=x&state=autre`); })).rejects.toThrow(/état différent/);
    await expect(waitForCode(port + 2, 'e', async (redirect) => { await fetch(`${redirect}?error=access_denied&state=e`); })).rejects.toThrow(/access_denied/);

    const directory = await mkdtemp(join(tmpdir(), 'cles-neomoov-essai-'));
    try {
      const path = await writeTokenFile(join(directory, 'cles'), 'x-refresh-token', 'jeton-tres-secret');
      expect(path).toBe(join(directory, 'cles', 'x-refresh-token.txt'));
      expect(await readFile(path, 'utf8')).toBe('jeton-tres-secret');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    expect(parseRedirect('https://neomoov.net/oauth/rappel?code=abc&state=s1')).toEqual({ code: 'abc', state: 's1', error: null });
    expect(parseRedirect(' abc ')).toEqual({ code: 'abc', state: null, error: null });
    expect(parseRedirect('https://neomoov.net/oauth/rappel?error=access_denied&error_description=Refus')).toMatchObject({ code: null, error: 'Refus' });
  });
});
