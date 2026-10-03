import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SocialAccountsRegistry, SocialHttp } from '../src/modules/marketing/social-accounts.registry.js';
import { SOCIAL_CREDENTIALS, type SocialCredentialsProvider } from '../src/modules/marketing/social-credentials.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, resetHttpLimits, startTestApp, type StaffSession } from './helpers.js';

/**
 * Réseaux sociaux (3 octobre 2026, agent S1) : les dix comptes dans My Hub, connexion OAuth de bout en bout contre un
 * simulateur HTTP (Meta : page Facebook et compte Instagram en un parcours, choix entre plusieurs pages ; X avec PKCE),
 * `state` modifié, expiré ou d'un autre réseau refusé, formulaire Telegram validé contre un simulateur de la Bot API,
 * lien public des relais manuels, liens publics de la page Contact (seulement les comptes reliés, validés et visibles),
 * valeurs secrètes jamais rendues par l'API et chiffrées en base, droits d'accès. La table est vidée pendant l'essai et
 * rendue telle quelle à la fin (base de développement partagée).
 */
const API = 'https://api.test.neomoov.local';
const WEB = 'https://hub.test.neomoov.local';
const PAGE_TOKEN = 'PAGE-TOKEN-TRES-SECRET-0123456789';
const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ';
const X_REFRESH = 'x-refresh-tres-secret';

type Page = { id: string; name: string; link: string; access_token: string; instagram_business_account?: { id: string; username: string } };

describe('réseaux sociaux : comptes, connexion, validation, liens publics (intégration, réseaux simulés)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let readonly: StaffSession;
  let saved: Array<typeof schema.socialAccounts.$inferSelect> = [];
  const startedAt = new Date();
  const server = () => app!.getHttpServer();
  const calls: Array<{ url: string; body: string | null }> = [];
  let pages: Page[] = [];
  let telegramBroken = false;

  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const simulator: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url: url.toString(), body });
    if (url.hostname === 'graph.facebook.com') {
      if (url.pathname.endsWith('/oauth/access_token')) {
        if (url.searchParams.get('grant_type') === 'fb_exchange_token') return json(200, { access_token: 'long-user-token', token_type: 'bearer', expires_in: 5_184_000 });
        return url.searchParams.get('code') === 'bon-code' ? json(200, { access_token: 'short-user-token', token_type: 'bearer', expires_in: 3600 }) : json(400, { error: { code: 100, message: 'Invalid verification code' } });
      }
      if (url.pathname.endsWith('/me/accounts')) return json(200, { data: pages });
      const id = url.pathname.split('/').pop();
      const page = pages.find((p) => p.id === id);
      if (page) return json(200, { id: page.id, name: page.name, link: page.link });
      const ig = pages.find((p) => p.instagram_business_account?.id === id)?.instagram_business_account;
      if (ig) return json(200, { id: ig.id, username: ig.username });
      return json(400, { error: { code: 100, message: 'Unknown object' } });
    }
    if (url.hostname === 'api.x.com') {
      if (url.pathname === '/2/oauth2/token') {
        // Rafraîchissement : X remplace le jeton de rafraîchissement à chaque échange.
        if (new URLSearchParams(body ?? '').get('grant_type') === 'refresh_token') return json(200, { token_type: 'bearer', access_token: 'x-access-renouvele', refresh_token: 'x-refresh-renouvele', expires_in: 7200 });
        return json(200, { token_type: 'bearer', access_token: 'x-access', refresh_token: X_REFRESH, expires_in: 7200, scope: 'tweet.read tweet.write users.read offline.access media.write' });
      }
      if (url.pathname === '/2/users/me') return json(200, { data: { id: '42', name: 'Neomoov', username: 'neomoov' } });
    }
    if (url.hostname === 'api.telegram.org') {
      if (telegramBroken || !url.pathname.startsWith(`/bot${BOT_TOKEN}/`)) return json(401, { ok: false, error_code: 401, description: 'Unauthorized' });
      if (url.pathname.endsWith('/getMe')) return json(200, { ok: true, result: { id: 999, is_bot: true, username: 'neomoov_bot' } });
      if (url.pathname.endsWith('/getChat')) return json(200, { ok: true, result: { id: -1001234567890, type: 'channel', title: 'Neomoov', username: 'neomoov' } });
      if (url.pathname.endsWith('/getChatMember')) return json(200, { ok: true, result: { status: 'administrator', can_post_messages: true } });
    }
    return json(404, { error: 'not found' });
  };

  const list = async (session = admin) => (await request(server()).get('/v1/admin/social').set(bearer(session.tokens)).expect(200)).body as Array<Record<string, unknown> & { space: string; status: string }>;
  const account = async (space: string) => (await list()).find((a) => a.space === space)!;
  const connectUrl = async (space: string) => new URL((await request(server()).get(`/v1/admin/social/${space}/connect`).set(bearer(admin.tokens)).expect(200)).body.url as string);
  const credentials = () => app!.get<SocialCredentialsProvider>(SOCIAL_CREDENTIALS);

  beforeAll(async () => {
    // Variables du poste neutralisées pour les réseaux de l'essai ; X a un jeton de rafraîchissement posé « sur le serveur » (repli).
    app = await startTestApp({
      APP_BASE_URL: API, WEB_BASE_URL: WEB, META_APP_ID: '1234567890', META_APP_SECRET: 'f'.repeat(32), X_CLIENT_ID: 'x-client', X_CLIENT_SECRET: 'x-client-secret', X_REFRESH_TOKEN: 'x-env-refresh',
      META_PAGE_ID: '', META_PAGE_TOKEN: '', META_IG_USER_ID: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHANNEL_ID: '', LINKEDIN_ACCESS_TOKEN: '', LINKEDIN_ORGANIZATION_ID: '', LINKEDIN_CLIENT_ID: '', LINKEDIN_CLIENT_SECRET: '',
      TIKTOK_CLIENT_KEY: '', TIKTOK_CLIENT_SECRET: '', TIKTOK_REFRESH_TOKEN: '', YOUTUBE_API_AUDITED: 'off', TIKTOK_APP_AUDITED: 'off',
    });
    if (!app) return;
    app.get(SocialHttp).fetch = simulator;
    saved = await db(app).select().from(schema.socialAccounts);
    await db(app).delete(schema.socialAccounts);
    admin = await createStaffAndLogin(app, ['admin']);
    readonly = await createStaffAndLogin(app, ['readonly']);
  });

  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });

  afterAll(async () => {
    if (!app) return;
    const database = db(app);
    await database.delete(schema.socialAccounts);
    if (saved.length) await database.insert(schema.socialAccounts).values(saved);
    await database.delete(schema.notifications).where(and(eq(schema.notifications.template, 'alert.agent_escalation'), gte(schema.notifications.createdAt, startedAt), sql`${schema.notifications.data}->>'reason' LIKE 'social_account_%'`));
    await cleanupTestData(app);
    await app.close();
  });

  it('liste les dix espaces dans l\'ordre, sans valeur secrète ; LinkedIn, TikTok et YouTube en attente d\'approbation', async () => {
    if (!app) return;
    const accounts = await list();
    expect(accounts.map((a) => a.space)).toEqual(['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel']);
    const by = new Map(accounts.map((a) => [a.space, a]));
    expect(by.get('linkedin')!.status).toBe('pending_approval');
    expect(by.get('youtube')!.status).toBe('pending_approval');
    expect(by.get('snapchat')!.modes).toEqual(['manual']);
    expect(by.get('facebook')!.callbackUrl).toBe(`${API}/v1/social/oauth/callback/facebook`);
    expect(by.get('instagram')!.callbackUrl).toBe(`${API}/v1/social/oauth/callback/facebook`);
    expect(by.get('facebook')!.appConfigured).toBe(true);
    expect(by.get('tiktok')!.appConfigured).toBe(false);
    for (const a of accounts) expect((a.modes as string[]).includes('aggregator')).toBe(false);
    await request(server()).get('/v1/admin/social/tiktok/connect').set(bearer(admin.tokens)).expect(409);
    await request(server()).get('/v1/admin/social/telegram/connect').set(bearer(admin.tokens)).expect(400);
  });

  it('Meta : un seul parcours relie la page Facebook et le compte Instagram ; jetons chiffrés, jamais rendus', async () => {
    if (!app) return;
    pages = [{ id: '111', name: 'Neomoov', link: 'https://www.facebook.com/neomoov', access_token: PAGE_TOKEN, instagram_business_account: { id: '1789', username: 'neomoov' } }];
    const url = await connectUrl('instagram');
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(url.searchParams.get('client_id')).toBe('1234567890');
    expect(url.searchParams.get('redirect_uri')).toBe(`${API}/v1/social/oauth/callback/facebook`);
    expect(url.searchParams.get('scope')).toContain('instagram_content_publish');
    const state = url.searchParams.get('state')!;
    const res = await request(server()).get('/v1/social/oauth/callback/facebook').query({ code: 'bon-code', state }).expect(302);
    expect(res.headers['location']).toBe(`${WEB}/hub/reseaux?connecte=facebook`);
    const accounts = await list();
    const fb = accounts.find((a) => a.space === 'facebook')!;
    const ig = accounts.find((a) => a.space === 'instagram')!;
    expect(fb).toMatchObject({ status: 'connected', accountName: 'Neomoov', accountId: '111', profileUrl: 'https://www.facebook.com/neomoov', credentialSource: 'database' });
    expect(ig).toMatchObject({ status: 'connected', accountName: '@neomoov', profileUrl: 'https://www.instagram.com/neomoov/' });
    expect(JSON.stringify(accounts)).not.toContain(PAGE_TOKEN);
    const [row] = await db(app).select().from(schema.socialAccounts).where(eq(schema.socialAccounts.space, 'instagram'));
    expect(row!.credentials).toMatch(/^v1\./);
    expect(row!.credentials).not.toContain(PAGE_TOKEN);
    const creds = await credentials().get('instagram');
    expect(creds).toMatchObject({ mode: 'direct', values: { pageId: '111', pageToken: PAGE_TOKEN, igUserId: '1789' } });
    const audit = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'social.connect'), gte(schema.auditLog.occurredAt, startedAt)));
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(audit)).not.toContain(PAGE_TOKEN);
  });

  it('refuse un state modifié, absent, d\'un autre réseau ou expiré', async () => {
    if (!app) return;
    const state = (await connectUrl('facebook')).searchParams.get('state')!;
    const [body, signature] = state.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), u: '00000000-0000-0000-0000-000000000000' })).toString('base64url')}.${signature}`;
    expect((await request(server()).get('/v1/social/oauth/callback/facebook').query({ code: 'bon-code', state: forged }).expect(400)).body.code).toBe('SOCIAL_OAUTH_STATE_INVALID');
    await request(server()).get('/v1/social/oauth/callback/facebook').query({ code: 'bon-code' }).expect(400);
    await request(server()).get('/v1/social/oauth/callback/x').query({ code: 'bon-code', state }).expect(400);
    const expired = `${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body!, 'base64url').toString()), x: 1 })).toString('base64url')}.${signature}`;
    await request(server()).get('/v1/social/oauth/callback/facebook').query({ code: 'bon-code', state: expired }).expect(400);
    // Refus de l'utilisateur sur l'écran du réseau : retour vers My Hub avec l'erreur, rien n'est enregistré.
    const refused = await request(server()).get('/v1/social/oauth/callback/facebook').query({ error: 'access_denied', state }).expect(302);
    expect(refused.headers['location']).toBe(`${WEB}/hub/reseaux?reseau=facebook&erreur=refus`);
  });

  it('Meta : plusieurs pages, choix dans My Hub (candidats sans jeton), puis compte relié', async () => {
    if (!app) return;
    pages = [
      { id: '111', name: 'Neomoov', link: 'https://www.facebook.com/neomoov', access_token: PAGE_TOKEN, instagram_business_account: { id: '1789', username: 'neomoov' } },
      { id: '222', name: 'Neomoov Academy', link: 'https://www.facebook.com/neomoovacademy', access_token: 'AUTRE-PAGE-TOKEN-SECRET' },
    ];
    const state = (await connectUrl('facebook')).searchParams.get('state')!;
    const res = await request(server()).get('/v1/social/oauth/callback/facebook').query({ code: 'bon-code', state }).expect(302);
    expect(res.headers['location']).toBe(`${WEB}/hub/reseaux?reseau=facebook&choisir=1`);
    const fb = await account('facebook');
    expect(fb['candidates']).toEqual([{ id: '111', name: 'Neomoov', detail: 'Instagram : @neomoov' }, { id: '222', name: 'Neomoov Academy', detail: 'Aucun compte Instagram professionnel rattaché' }]);
    expect(JSON.stringify(fb)).not.toContain('AUTRE-PAGE-TOKEN-SECRET');
    await request(server()).post('/v1/admin/social/facebook/select').set(bearer(admin.tokens)).send({ accountId: '999' }).expect(404);
    const chosen = await request(server()).post('/v1/admin/social/facebook/select').set(bearer(admin.tokens)).send({ accountId: '222' }).expect(200);
    expect(chosen.body).toMatchObject({ status: 'connected', accountId: '222', accountName: 'Neomoov Academy', candidates: [] });
    const creds = await credentials().get('facebook');
    expect(creds?.values['pageToken']).toBe('AUTRE-PAGE-TOKEN-SECRET');
  });

  it('jetons renouvelés par un connecteur (update) : un compte des variables du serveur est enregistré chiffré, sans les identifiants de l\'application', async () => {
    if (!app) return;
    expect(await credentials().get('x')).toMatchObject({ mode: 'direct', values: { refreshToken: 'x-env-refresh', clientId: 'x-client' } });
    await credentials().update!('x', { refreshToken: 'x-refresh-tourne', accessToken: 'x-access-tourne', accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), clientSecret: 'ignore' });
    const [row] = await db(app).select().from(schema.socialAccounts).where(eq(schema.socialAccounts.space, 'x'));
    expect(row).toMatchObject({ mode: 'direct', status: 'connected' });
    expect(row!.credentials).not.toContain('x-refresh-tourne');
    expect(app.get(SocialAccountsRegistry).sealed(row!).values).toEqual({ refreshToken: 'x-refresh-tourne', accessToken: 'x-access-tourne', accessTokenExpiresAt: expect.any(String) });
    expect(await credentials().get('x')).toMatchObject({ mode: 'direct', values: { refreshToken: 'x-refresh-tourne', accessToken: 'x-access-tourne', clientId: 'x-client', clientSecret: 'x-client-secret' } });
  });

  it('X : écran d\'autorisation avec PKCE, échange du code avec le vérificateur, compte relié', async () => {
    if (!app) return;
    const url = await connectUrl('x');
    expect(url.origin + url.pathname).toBe('https://x.com/i/oauth2/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const challenge = url.searchParams.get('code_challenge')!;
    await request(server()).get('/v1/social/oauth/callback/x').query({ code: 'code-x', state: url.searchParams.get('state')! }).expect(302);
    const exchange = calls.filter((c) => c.url === 'https://api.x.com/2/oauth2/token').at(-1)!;
    const verifier = new URLSearchParams(exchange.body!).get('code_verifier')!;
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);
    expect(await account('x')).toMatchObject({ status: 'connected', accountName: 'Neomoov', profileUrl: 'https://x.com/neomoov' });
    const creds = await credentials().get('x');
    expect(creds?.values).toMatchObject({ accessToken: 'x-access', refreshToken: X_REFRESH, clientId: 'x-client', clientSecret: 'x-client-secret' });
    expect(JSON.stringify(await list())).not.toContain(X_REFRESH);
    // Jeton d'accès échu : renouvelé sous verrou avant d'être servi, le nouveau jeton de rafraîchissement est écrit dans le compte.
    await credentials().update!('x', { accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect(await credentials().get('x')).toMatchObject({ values: { accessToken: 'x-access-renouvele', refreshToken: 'x-refresh-renouvele' } });
    const refreshes = calls.filter((c) => c.url === 'https://api.x.com/2/oauth2/token' && new URLSearchParams(c.body ?? '').get('grant_type') === 'refresh_token');
    expect(refreshes).toHaveLength(1);
    expect(new URLSearchParams(refreshes[0]!.body!).get('refresh_token')).toBe(X_REFRESH);
    expect((await credentials().get('x'))?.values['refreshToken']).toBe('x-refresh-renouvele');
  });

  it('Telegram : jeton du bot et canal validés contre la Bot API (bot administrateur), jeton jamais rendu', async () => {
    if (!app) return;
    const bad = await request(server()).post('/v1/admin/social/telegram/connect').set(bearer(admin.tokens)).send({ botToken: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', channel: '@neomoov' }).expect(422);
    expect(bad.body.code).toBe('SOCIAL_VALIDATION_FAILED');
    expect(JSON.stringify(bad.body)).not.toContain('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await request(server()).post('/v1/admin/social/telegram/connect').set(bearer(admin.tokens)).send({ botToken: BOT_TOKEN, channel: 'pas un canal !' }).expect(400);
    const ok = await request(server()).post('/v1/admin/social/telegram/connect').set(bearer(admin.tokens)).send({ botToken: BOT_TOKEN, channel: 'https://t.me/neomoov' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'connected', accountId: '-1001234567890', accountName: 'Neomoov', profileUrl: 'https://t.me/neomoov' });
    expect(JSON.stringify(ok.body)).not.toContain(BOT_TOKEN);
    expect(await credentials().get('telegram')).toMatchObject({ mode: 'direct', values: { botToken: BOT_TOKEN, channelId: '-1001234567890' } });
    // Bot retiré du canal : la revalidation passe le compte en refus, il n'est plus servi aux connecteurs.
    telegramBroken = true;
    const revalidated = await request(server()).post('/v1/admin/social/telegram/validate').set(bearer(admin.tokens)).expect(200);
    expect(revalidated.body.status).toBe('invalid');
    expect(revalidated.body.lastError).not.toContain(BOT_TOKEN);
    expect(await credentials().get('telegram')).toBeNull();
    telegramBroken = false;
    expect((await request(server()).post('/v1/admin/social/telegram/validate').set(bearer(admin.tokens)).expect(200)).body.status).toBe('connected');
  });

  it('relais manuel : lien public vérifié (domaine du réseau), compte relié en mode manuel', async () => {
    if (!app) return;
    await request(server()).post('/v1/admin/social/whatsapp_channel/link').set(bearer(admin.tokens)).send({ profileUrl: 'https://exemple.com/channel/abc' }).expect(400);
    const ok = await request(server()).post('/v1/admin/social/whatsapp_channel/link').set(bearer(admin.tokens)).send({ profileUrl: 'https://whatsapp.com/channel/0029VaNeomoov' }).expect(200);
    expect(ok.body).toMatchObject({ status: 'connected', mode: 'manual' });
    expect(await credentials().get('whatsapp_channel')).toMatchObject({ mode: 'manual', profileUrl: 'https://whatsapp.com/channel/0029VaNeomoov' });
    await request(server()).patch('/v1/admin/social/snapchat').set(bearer(admin.tokens)).send({ mode: 'direct' }).expect(400);
    await request(server()).patch('/v1/admin/social/facebook').set(bearer(admin.tokens)).send({ appApproved: true }).expect(400);
  });

  it('approbation en attente : publication en relais manuel tant que le fondateur ne confirme pas l\'approbation', async () => {
    if (!app) return;
    await app.get(SocialAccountsRegistry).upsert('linkedin', { mode: 'direct', validation: 'connected', sealed: { values: { accessToken: 'li-token', organizationId: '5555' } }, accountId: '5555', accountName: 'Neomoov', profileUrl: 'https://www.linkedin.com/company/neomoov/', lastValidatedAt: new Date() });
    expect((await account('linkedin')).status).toBe('pending_approval');
    expect((await credentials().get('linkedin'))?.mode).toBe('manual');
    const approved = await request(server()).patch('/v1/admin/social/linkedin').set(bearer(admin.tokens)).send({ appApproved: true }).expect(200);
    expect(approved.body).toMatchObject({ status: 'connected', appApproved: true });
    expect((await credentials().get('linkedin'))?.mode).toBe('direct');
  });

  it('liens publics : seulement les comptes reliés, validés et marqués « afficher sur le site », dans l\'ordre ; sans clé', async () => {
    if (!app) return;
    await request(server()).patch('/v1/admin/social/x').set(bearer(admin.tokens)).send({ showOnSite: false }).expect(200);
    await credentials().markInvalid('instagram', 'Jeton refusé par Meta (190)');
    const res = await request(server()).get('/v1/public/social-links').expect(200);
    expect(res.headers['cache-control']).toBe('public, max-age=600');
    expect(res.body.links).toEqual([
      { space: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/neomoovacademy' },
      { space: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/company/neomoov/' },
      { space: 'telegram', label: 'Telegram', url: 'https://t.me/neomoov' },
      { space: 'whatsapp_channel', label: 'Chaîne WhatsApp', url: 'https://whatsapp.com/channel/0029VaNeomoov' },
    ]);
    expect((await account('instagram')).status).toBe('invalid');
    // Alerte au personnel (écrite en arrière-plan) : attendue quelques instants.
    let alerts = 0;
    for (let i = 0; i < 20 && !alerts; i += 1) {
      alerts = (await db(app).select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.agent_escalation'), gte(schema.notifications.createdAt, startedAt), sql`${schema.notifications.data}->>'space' = 'instagram'`))).length;
      if (!alerts) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(alerts).toBeGreaterThan(0);
  });

  it('déconnexion et droits : lecture seule pour le rôle readonly, jetons effacés à la déconnexion', async () => {
    if (!app) return;
    expect((await list(readonly)).length).toBe(10);
    await request(server()).get('/v1/admin/social/facebook/connect').set(bearer(readonly.tokens)).expect(403);
    await request(server()).delete('/v1/admin/social/telegram').set(bearer(readonly.tokens)).expect(403);
    await request(server()).get('/v1/admin/social').expect(401);
    const res = await request(server()).delete('/v1/admin/social/telegram').set(bearer(admin.tokens)).expect(200);
    expect(res.body).toMatchObject({ status: 'not_connected', accountId: null, profileUrl: null, credentialSource: 'none' });
    const [row] = await db(app).select().from(schema.socialAccounts).where(eq(schema.socialAccounts.space, 'telegram'));
    expect(row!.credentials).toBeNull();
    expect(await credentials().get('telegram')).toBeNull();
    await request(server()).delete('/v1/admin/social/site_blog').set(bearer(admin.tokens)).expect(400);
  });
});
