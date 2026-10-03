import { CONTENT_SPACES, type ContentSpace } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import type { CredentialStatus, SocialPublisher, SocialPublishers } from '../src/adapters/marketing.types.js';
import { MockSocialPublisher } from '../src/adapters/mock/marketing.mock.js';
import { GoogleBusinessPublisher } from '../src/adapters/real/google-business.js';
import { LinkedInPublisher } from '../src/adapters/real/linkedin.js';
import { NotConfiguredPublisher, realSocialPublishers } from '../src/adapters/real/marketing.js';
import { OAuthSession, quoteBigIntegers, retryAfterSeconds, SocialApi, socialError, type OAuthTokenStore } from '../src/adapters/real/oauth.js';
import { TikTokPublisher } from '../src/adapters/real/tiktok.js';
import { XPublisher } from '../src/adapters/real/x.js';
import { YouTubePublisher } from '../src/adapters/real/youtube.js';
import { AppError } from '../src/common/app-error.js';
import { loadEnv } from '../src/config/env.js';
import { PublishingService } from '../src/modules/marketing/publishing.service.js';
import { clock, SocialServer, tokenReplies } from './social-server.js';

/**
 * Socle des connecteurs OAuth (3 octobre 2026) : un seul échange de jeton pour des appels simultanés, délais d'un 429,
 * erreurs typées, identifiants int64, conservation en échec ; choix des connecteurs selon les variables ; alerte
 * quotidienne au personnel avant l'échéance d'une autorisation. Sans base ni réseau.
 */
const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://user:pass@localhost:5432/neomoov_test', MARKETING_PROVIDER: 'real' };

describe('socle OAuth des connecteurs', () => {
  it('appels simultanés : un seul échange de jeton ; erreurs typées (5xx, réseau) sans jeton dans le message', async () => {
    let resolve!: () => void;
    const gate = new Promise<void>((r) => { resolve = r; });
    const server = new SocialServer()
      .on('GET', '/ressource', { json: { ok: true } }, { status: 503, text: 'indisponible' });
    // Échange retenu jusqu'à ce que les trois appels l'attendent.
    const slowFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/token')) {
        await gate;
        return new Response(JSON.stringify({ access_token: 'acces-unique', expires_in: 3_600 }), { status: 200 });
      }
      return server.fetch(input, init);
    }) as typeof fetch;
    const session = new OAuthSession({ provider: 'youtube', label: 'Essai', tokenUrl: 'https://auth.example/token', clientId: 'c', clientSecret: 's', refreshToken: 'r-secret', clientAuth: 'body', fetchImpl: slowFetch });
    const pending = Promise.all([session.accessToken(), session.accessToken(), session.accessToken()]);
    resolve();
    expect(await pending).toEqual(['acces-unique', 'acces-unique', 'acces-unique']);
    const api = new SocialApi({ label: 'Essai', session, fetchImpl: slowFetch });
    expect((await api.call<{ ok: boolean }>('https://api.example/ressource?jeton=jamais')).data).toEqual({ ok: true });
    const down = await api.call('https://api.example/ressource?jeton=jamais').catch((e: Error) => e);
    expect(down).toMatchObject({ code: 'SOCIAL_PROVIDER_ERROR', status: 502, message: 'Essai 503 sur api.example/ressource : indisponible' });
    const offline = new SocialApi({ label: 'Essai', session, fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch });
    await expect(offline.call('https://api.example/x')).rejects.toMatchObject({ code: 'SOCIAL_PROVIDER_ERROR', message: expect.stringContaining('injoignable') });
    expect(JSON.stringify(session)).not.toMatch(/secret|acces/);
  });

  it('délai d\'un 429 : Retry-After en secondes ou en date, x-rate-limit-reset ; codes des erreurs', () => {
    const now = Date.parse('2026-10-03T12:00:00Z');
    expect(retryAfterSeconds(new Headers({ 'retry-after': '30' }), now)).toBe(30);
    expect(retryAfterSeconds(new Headers({ 'retry-after': 'Sat, 03 Oct 2026 12:05:00 GMT' }), now)).toBe(300);
    expect(retryAfterSeconds(new Headers({ 'x-rate-limit-reset': String(now / 1_000 + 61) }), now)).toBe(61);
    expect(retryAfterSeconds(new Headers(), now)).toBeNull();
    expect(socialError('R', 403, 'https://a.b/c?t=1', 'interdit')).toMatchObject({ code: 'SOCIAL_FORBIDDEN', message: 'R 403 sur a.b/c : interdit' });
    expect(socialError('R', 409, 'https://a.b/c', null)).toMatchObject({ code: 'SOCIAL_VALIDATION_ERROR', message: 'R 409 sur a.b/c : sans détail' });
    expect(quoteBigIntegers('{"a":[7300000000000000001, 12],"b":1700000000000,"c":"9999999999999999999"}')).toBe('{"a":["7300000000000000001", 12],"b":1700000000000,"c":"9999999999999999999"}');
  });

  it('jeton renouvelé non conservé (base en panne) : le processus continue, l\'état de l\'autorisation le signale', async () => {
    const failing: OAuthTokenStore = { load: async () => null, save: async () => { throw new Error('connexion refusée'); } };
    const server = new SocialServer().on('POST', '/token', tokenReplies(['a1'], { rotate: true }));
    const session = new OAuthSession({ provider: 'x', label: 'X', tokenUrl: 'https://auth.example/token', clientId: 'c', clientSecret: null, refreshToken: 'r', clientAuth: 'basic', rotates: true, store: failing, fetchImpl: server.fetch });
    expect(await session.accessToken()).toBe('a1');
    expect(await session.credentials()).toMatchObject({ renewable: true, problem: expect.stringContaining('non conservé') });
  });
});

describe('choix des connecteurs réels (3 octobre 2026)', () => {
  it('chaque réseau devient réel dès que ses variables sont posées ; Snapchat reste non configuré', () => {
    const env = loadEnv({
      ...base,
      GOOGLE_BUSINESS_CLIENT_ID: 'g', GOOGLE_BUSINESS_CLIENT_SECRET: 'gs', GOOGLE_BUSINESS_REFRESH_TOKEN: 'gr', GOOGLE_BUSINESS_ACCOUNT_ID: 'accounts/111', GOOGLE_BUSINESS_LOCATION_ID: 'accounts/111/locations/222',
      LINKEDIN_ORGANIZATION_ID: 'urn:li:organization:4242', LINKEDIN_ACCESS_TOKEN: 'la', LINKEDIN_ACCESS_TOKEN_EXPIRES_AT: '2026-11-30',
      YOUTUBE_CLIENT_ID: 'y', YOUTUBE_CLIENT_SECRET: 'ys', YOUTUBE_REFRESH_TOKEN: 'yr', YOUTUBE_PRIVACY_STATUS: 'unlisted',
      X_CLIENT_ID: 'x', X_REFRESH_TOKEN: 'xr',
      TIKTOK_CLIENT_KEY: 't', TIKTOK_CLIENT_SECRET: 'ts', TIKTOK_REFRESH_TOKEN: 'tr', TIKTOK_PRIVACY_LEVEL: 'SELF_ONLY',
      SNAPCHAT_ACCESS_TOKEN: 's', SNAPCHAT_PROFILE_ID: 'p',
    }, { dotenv: false });
    const publishers = realSocialPublishers(env);
    expect(publishers.get('google_business')).toBeInstanceOf(GoogleBusinessPublisher);
    expect(publishers.get('linkedin')).toBeInstanceOf(LinkedInPublisher);
    expect(publishers.get('youtube')).toBeInstanceOf(YouTubePublisher);
    expect(publishers.get('x')).toBeInstanceOf(XPublisher);
    expect(publishers.get('tiktok')).toBeInstanceOf(TikTokPublisher);
    expect(publishers.get('snapchat')).toBeInstanceOf(NotConfiguredPublisher);
    expect(JSON.parse(JSON.stringify(publishers.get('google_business')))).toMatchObject({ locationId: '222' });
    expect(JSON.parse(JSON.stringify(publishers.get('linkedin')))).toMatchObject({ organizationId: '4242', version: '202606' });
    expect(JSON.parse(JSON.stringify(publishers.get('youtube')))).toMatchObject({ privacyStatus: 'unlisted' });
    expect(JSON.parse(JSON.stringify(publishers.get('tiktok')))).toMatchObject({ privacyLevel: 'SELF_ONLY', uploadMode: 'file' });
    // Variables incomplètes : connecteur non configuré (LinkedIn avec un jeton de rafraîchissement sans les identifiants de l'application).
    const partial = realSocialPublishers(loadEnv({ ...base, LINKEDIN_ORGANIZATION_ID: '1', LINKEDIN_REFRESH_TOKEN: 'r', GOOGLE_BUSINESS_CLIENT_ID: 'g' }, { dotenv: false }));
    expect(partial.get('linkedin')!.configured).toBe(false);
    expect(partial.get('google_business')!.configured).toBe(false);
    expect(() => loadEnv({ ...base, LINKEDIN_ACCESS_TOKEN_EXPIRES_AT: 'bientôt' }, { dotenv: false })).toThrow(/LINKEDIN_ACCESS_TOKEN_EXPIRES_AT/);
  });
});

describe('alerte avant l\'échéance d\'une autorisation', () => {
  function service(publishers: SocialPublisher[]) {
    const alerts: Array<Record<string, unknown>> = [];
    const map = new Map<ContentSpace, SocialPublisher>(CONTENT_SPACES.map((space) => [space, new MockSocialPublisher(space)]));
    for (const p of publishers) map.set(p.space, p);
    const settings = { number: async (_key: string, fallback: number) => fallback };
    const outbox = { queueForStaff: async (_template: string, data: Record<string, unknown>) => { alerts.push(data); } };
    const audit = { recordSystem: async () => undefined };
    const svc = new PublishingService(null as never, map as SocialPublishers, null as never, null as never, settings as never, null as never, audit as never, outbox as never, null as never, null as never, null as never);
    return { svc, alerts };
  }
  const withCredentials = (space: ContentSpace, status: () => Promise<CredentialStatus>): SocialPublisher =>
    Object.assign(new MockSocialPublisher(space), { credentials: status }) as SocialPublisher;

  it('alerte à moins de 7 jours ou sur un échec, une fois par jour et par réseau ; rien pour une échéance lointaine', async () => {
    const now = new Date('2026-10-03T13:00:00Z');
    const { svc, alerts } = service([
      withCredentials('linkedin', async () => ({ renewable: false, renewBy: new Date('2026-10-08T00:00:00Z'), problem: null })),
      withCredentials('x', async () => ({ renewable: true, renewBy: null, problem: 'X : jeton de rafraîchissement refusé (invalid_request)' })),
      withCredentials('youtube', async () => ({ renewable: true, renewBy: new Date('2027-09-01T00:00:00Z'), problem: null })),
      withCredentials('tiktok', async () => { throw new Error('panne inattendue'); }),
    ]);
    expect(await svc.credentialsPass(now)).toBe(3);
    expect(alerts.map((a) => a['summary'])).toEqual([
      'LinkedIn : autorisation à refaire avant le 2026-10-08 (docs/marketing/connecteurs.md, commande oauth:jeton)',
      'TikTok : autorisation en échec (panne inattendue). Refaire l\'autorisation : docs/marketing/connecteurs.md',
      'X : autorisation en échec (X : jeton de rafraîchissement refusé (invalid_request)). Refaire l\'autorisation : docs/marketing/connecteurs.md',
    ]);
    expect(alerts.every((a) => a['reason'] === 'marketing_token_expiring')).toBe(true);
    expect(await svc.credentialsPass(new Date('2026-10-03T20:00:00Z'))).toBe(0);
    expect(await svc.credentialsPass(new Date('2026-10-04T13:00:00Z'))).toBe(3);
  });

  it('jeton de 60 jours posé à la main : échéance tirée de LINKEDIN_ACCESS_TOKEN_EXPIRES_AT', async () => {
    const time = clock(Date.parse('2026-11-25T12:00:00Z'));
    const linkedin = new LinkedInPublisher({ organizationId: '1', accessToken: 'jeton', accessExpiresAt: Date.parse('2026-11-30'), refreshToken: null, clientId: null, clientSecret: null, version: '202606', fetchImpl: new SocialServer().fetch, now: time.now });
    const { svc, alerts } = service([linkedin]);
    expect(await svc.credentialsPass(new Date(time.now()))).toBe(1);
    expect(alerts[0]!['summary']).toContain('avant le 2026-11-30');
  });
});

describe('nouvelle tentative de la diffusion après une limite atteinte', () => {
  it('attend au moins le délai demandé par le réseau (5 minutes au moins, 26 heures au plus) ; dernière tentative : échec', async () => {
    const sets: Array<Record<string, unknown>> = [];
    const database = { db: { update: () => ({ set: (values: Record<string, unknown>) => { sets.push(values); return { where: async () => undefined }; } }) } };
    const svc = new PublishingService(
      database as never, new Map() as never, null as never, null as never, { number: async (_key: string, fallback: number) => fallback } as never, null as never,
      { recordSystem: async () => undefined } as never, { queueForStaff: async () => undefined } as never, null as never, null as never, null as never,
    );
    const now = new Date('2026-10-03T12:00:00Z');
    const record = (error: unknown, attempt = 1) => (svc as unknown as { recordFailure: (...args: unknown[]) => Promise<void> }).recordFailure({ id: 'item', space: 'x' }, attempt, error, now);
    await record(new AppError('SOCIAL_RATE_LIMITED', 'X 429', 503, { retryAfterSeconds: 900 }));
    await record(new AppError('SOCIAL_RATE_LIMITED', 'X 429', 503, { retryAfterSeconds: 60 }));
    await record(new AppError('SOCIAL_RATE_LIMITED', 'YouTube 429', 503, { retryAfterSeconds: 400_000 }));
    await record(new AppError('SOCIAL_PROVIDER_ERROR', 'panne', 502), 2);
    await record(new Error('panne'), 3);
    expect(sets.map((s) => (s['nextAttemptAt'] as Date | null)?.getTime() ?? null)).toEqual([
      now.getTime() + 900_000, now.getTime() + 300_000, now.getTime() + 26 * 3_600_000, now.getTime() + 1_800_000, null,
    ]);
    expect(sets.at(-1)).toMatchObject({ status: 'failed', lastError: 'panne' });
  });
});
