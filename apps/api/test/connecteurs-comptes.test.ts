import { describe, expect, it } from 'vitest';
import type { SocialPublishInput } from '../src/adapters/marketing.types.js';
import type { CredentialedPublisher } from '../src/adapters/real/credentialed.js';
import { realSocialPublishers } from '../src/adapters/real/marketing.js';
import { AppError } from '../src/common/app-error.js';
import { loadEnv } from '../src/config/env.js';
import { PublishingService } from '../src/modules/marketing/publishing.service.js';
import type { SocialCredentials, SocialCredentialsProvider } from '../src/modules/marketing/social-credentials.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Connecteurs tirés des identifiants des comptes (contrat `SOCIAL_CREDENTIALS`, 3 octobre 2026), avec un fournisseur
 * simulé qui sait écrire les jetons renouvelés (`update`, comme la table des comptes de My Hub) : jeton de X remplacé à
 * chaque échange et écrit dans le compte, relu avant l'échange suivant ; compte relié de nouveau pris en compte ;
 * adaptateur gardé tant que seuls les jetons changent ; compte refusé signalé (`markInvalid`) ; relais manuel ; la
 * diffusion ne relance pas une publication à relayer à la main.
 */
const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/neomoov_test', MARKETING_PROVIDER: 'real' };

class FakeAccounts implements SocialCredentialsProvider {
  readonly accounts = new Map<string, SocialCredentials>();
  readonly invalid: Array<{ space: string; reason: string }> = [];
  readonly updates: Array<{ space: string; keys: string[] }> = [];
  set(space: string, mode: SocialCredentials['mode'], values: Record<string, string> = {}) {
    this.accounts.set(space, { mode, values: { ...values }, accountId: null, accountName: null, profileUrl: null, expiresAt: null });
  }
  async get(space: string) {
    const account = this.accounts.get(space);
    return account ? { ...account, values: { ...account.values } } : null;
  }
  async markInvalid(space: string, reason: string) {
    this.invalid.push({ space, reason });
    this.accounts.delete(space);
  }
  async update(space: string, values: Record<string, string>) {
    const account = this.accounts.get(space)!;
    account.values = { ...account.values, ...values };
    this.updates.push({ space, keys: Object.keys(values).sort() });
  }
}

const input = (space: string): SocialPublishInput => ({
  itemId: 'item', space: space as never, format: 'post', language: 'fr', title: null, body: 'Texte', caption: null, hashtags: [], text: 'Texte', ctaUrl: null, media: null, draft: false,
});

describe('connecteurs tirés des identifiants des comptes', () => {
  it('X : jeton remplacé écrit dans le compte, relu avant l\'échange suivant, sans reconstruire l\'adaptateur ; nouvelle connexion prise en compte', async () => {
    const accounts = new FakeAccounts();
    accounts.set('x', 'direct', { clientId: 'x-id', clientSecret: 'x-secret', refreshToken: 'rt-connexion' });
    const time = clock();
    let n = 0;
    const server = new SocialServer()
      .on('POST', 'api.x.com/2/oauth2/token', tokenReplies(['x-acces-1', 'x-acces-2', 'x-acces-3'], { expiresIn: 7_200, rotate: true }))
      .on('POST', '/2/tweets', () => ({ status: 201, json: { data: { id: `tw${++n}` } } }));
    const publishers = realSocialPublishers(loadEnv(base, { dotenv: false }), { credentials: accounts, fetchImpl: server.fetch, now: time.now });
    const x = publishers.get('x') as CredentialedPublisher;
    const adapter = await x.resolve();
    await x.publish(input('x'));
    expect(accounts.accounts.get('x')!.values).toMatchObject({ refreshToken: 'rt-tourne-1', accessToken: 'x-acces-1', accessTokenExpiresAt: '2026-10-03T14:00:00.000Z' });
    expect(accounts.updates).toEqual([{ space: 'x', keys: ['accessToken', 'accessTokenExpiresAt', 'refreshToken'] }]);
    // Seuls les jetons ont changé : même adaptateur, jeton d'accès en cache, aucun nouvel échange.
    await x.publish(input('x'));
    expect(await x.resolve()).toBe(adapter);
    expect(server.to('oauth2/token')).toHaveLength(1);
    // Jeton échu : relecture du compte avant l'échange (le dernier jeton, pas celui de la connexion).
    time.advance(3 * 3_600_000);
    await x.publish(input('x'));
    expect(server.to('oauth2/token').map((c) => c.form!['refresh_token'])).toEqual(['rt-connexion', 'rt-tourne-1']);
    // Nouvelle connexion dans My Hub (jeton neuf, sans jeton d'accès) : prise en compte au prochain échange.
    accounts.accounts.get('x')!.values = { clientId: 'x-id', clientSecret: 'x-secret', refreshToken: 'rt-reconnexion' };
    time.advance(3 * 3_600_000);
    await x.publish(input('x'));
    expect(server.to('oauth2/token').at(-1)!.form!['refresh_token']).toBe('rt-reconnexion');
    // Autre valeur que les jetons (application changée) : adaptateur reconstruit.
    accounts.accounts.get('x')!.values['clientId'] = 'x-autre-id';
    expect(await x.resolve()).not.toBe(adapter);
    expect(JSON.stringify(x)).not.toMatch(/secret|acces|rt-/);
  });

  it('jeton refusé à l\'échange : compte signalé à reconnecter, connecteur non configuré ensuite', async () => {
    const accounts = new FakeAccounts();
    accounts.set('tiktok', 'direct', { clientKey: 'tk', clientSecret: 'ts', refreshToken: 'rft-revoque' });
    const server = new SocialServer().on('POST', '/oauth/token/', { status: 400, json: { error: 'invalid_grant', error_description: 'Refresh token is invalid or expired.' } });
    const publishers = realSocialPublishers(loadEnv(base, { dotenv: false }), { credentials: accounts, fetchImpl: server.fetch });
    const tiktok = publishers.get('tiktok') as CredentialedPublisher;
    await tiktok.resolve();
    expect(tiktok.configured).toBe(true);
    const video = { ...input('tiktok'), media: { key: 'v', contentType: 'video/mp4', body: Buffer.alloc(4), url: null } };
    await expect(tiktok.publish(video)).rejects.toMatchObject({ code: 'SOCIAL_AUTH_FAILED' });
    expect(accounts.invalid).toEqual([{ space: 'tiktok', reason: expect.stringContaining('invalid_grant') }]);
    expect(accounts.invalid[0]!.reason).not.toContain('rft-revoque');
    await tiktok.resolve();
    expect(tiktok.configured).toBe(false);
    await expect(tiktok.publish(video)).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('relais manuel : publication refusée par SOCIAL_MANUAL_RELAY, aucun commentaire, mesures nulles ; mode agrégateur refusé (connexions directes seulement)', async () => {
    const accounts = new FakeAccounts();
    accounts.set('linkedin', 'manual');
    accounts.set('youtube', 'aggregator', { apiKey: 'k' });
    const publishers = realSocialPublishers(loadEnv(base, { dotenv: false }), { credentials: accounts });
    const linkedin = publishers.get('linkedin') as CredentialedPublisher;
    await linkedin.resolve();
    expect([linkedin.configured, linkedin.name, linkedin.mode]).toEqual([true, 'manual', 'manual']);
    await expect(linkedin.publish(input('linkedin'))).rejects.toMatchObject({ code: 'SOCIAL_MANUAL_RELAY', status: 409 });
    const ref = { itemId: 'i', externalId: 'e', externalUrl: null };
    expect(await linkedin.comments(ref, new Date(0))).toEqual([]);
    expect(await linkedin.metrics(ref)).toMatchObject({ reach: 0, raw: { manual: true } });
    await expect(publishers.get('youtube')!.publish(input('youtube'))).rejects.toMatchObject({ code: 'SOCIAL_MANUAL_RELAY', message: expect.stringContaining('agrégateur non pris en charge') });
  });

  it('diffusion : une publication à relayer à la main n\'est jamais relancée (échec immédiat, alerte de relais manuel)', async () => {
    const sets: Array<Record<string, unknown>> = [];
    const alerts: Array<Record<string, unknown>> = [];
    const database = { db: { update: () => ({ set: (values: Record<string, unknown>) => { sets.push(values); return { where: async () => undefined }; } }) } };
    const svc = new PublishingService(
      database as never, new Map() as never, null as never, null as never, { number: async (_key: string, fallback: number) => fallback } as never, null as never,
      { recordSystem: async () => undefined } as never, { queueForStaff: async (_t: string, data: Record<string, unknown>) => { alerts.push(data); } } as never, null as never, null as never, null as never,
    );
    const record = (error: unknown) => (svc as unknown as { recordFailure: (...args: unknown[]) => Promise<void> }).recordFailure({ id: 'item', space: 'linkedin' }, 1, error, new Date('2026-10-03T12:00:00Z'));
    await record(new AppError('SOCIAL_APPROVAL_PENDING', 'LinkedIn : droits de publication absents', 409));
    await record(new AppError('SOCIAL_MANUAL_RELAY', 'Snapchat : publication à relayer à la main', 409));
    expect(sets.map((s) => [s['status'], s['nextAttemptAt']])).toEqual([['failed', null], ['failed', null]]);
    expect(String(sets[0]!['lastError'])).toMatch(/^SOCIAL_APPROVAL_PENDING : /);
    expect(alerts.map((a) => a['reason'])).toEqual(['marketing_manual_relay', 'marketing_manual_relay']);
    expect(alerts[0]!['summary']).toBe('LinkedIn : publication à relayer à la main (LinkedIn : droits de publication absents)');
  });
});
