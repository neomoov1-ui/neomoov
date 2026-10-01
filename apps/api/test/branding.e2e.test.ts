import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { NEOMOOV_BRAND, type TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockEmailProvider, MockPushProvider, MockSmsProvider } from '../src/adapters/mock/index.js';
import { EMAIL_PROVIDER, PUSH_PROVIDER, SMS_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { APP_ENV, type AppEnv } from '../src/config/env.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import { parseSender } from '../src/modules/branding/branding.service.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';
import { NotificationsOutbox } from '../src/modules/rides/notifications-outbox.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, startTestApp, testEmail, type StaffSession } from './helpers.js';

/**
 * Étape 22 : deux organisations de test, deux marques, une seule application. Marque publique par code et par domaine,
 * rattachement d'un client par code, marque de chaque utilisateur dans `GET /v1/config`, permission `brand.edit`,
 * contraste WCAG AA, expéditeur des avis par marque, politique d'isolation sur `brands`.
 */
const tag = () => Math.random().toString(36).slice(2, 10);

describe('marque par organisation (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let rootId = '';
  const orgs: Record<'A' | 'B', { id: string; path: string; joinCode: string }> = { A: { id: '', path: '', joinCode: '' }, B: { id: '', path: '', joinCode: '' } };
  const createdRoles: string[] = [];
  const notificationOwners: string[] = [];
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    admin = await createStaffAndLogin(app, ['admin']);
    const list = await request(server()).get('/v1/admin/organizations').set(bearer(admin.tokens)).expect(200);
    rootId = (list.body as Array<{ id: string; parentId: string | null }>).find((o) => o.parentId === null)!.id;
    for (const key of ['A', 'B'] as const) {
      const res = await request(server()).post('/v1/admin/organizations').set(bearer(admin.tokens)).send({ parentId: rootId, code: `brand-${key.toLowerCase()}-${tag()}`, name: `Taxi ${key === 'A' ? 'Alpha' : 'Beta'}`, type: 'taxi_company' }).expect(201);
      const [row] = await db(app).select({ joinCode: schema.organizations.joinCode }).from(schema.organizations).where(eq(schema.organizations.id, res.body.id));
      orgs[key] = { id: res.body.id, path: res.body.path, joinCode: row!.joinCode };
    }
  });
  afterAll(async () => {
    if (app) {
      if (notificationOwners.length) await db(app).delete(schema.notifications).where(inArray(schema.notifications.recipientUserId, notificationOwners));
      await cleanupTestData(app);
      if (createdRoles.length) await db(app).delete(schema.roles).where(inArray(schema.roles.id, createdRoles));
      const ids = [orgs.A.id, orgs.B.id].filter(Boolean);
      if (ids.length) await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, ids));
    }
    await app?.close();
  });

  it('deux marques ; marque publique par code puis par domaine vérifié ; couleurs et contraste validés', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Le code de rattachement est généré par la base : 8 caractères sans ambiguïté, distinct par organisation.
    expect(orgs.A.joinCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(orgs.B.joinCode).not.toBe(orgs.A.joinCode);

    const alpha = await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(admin.tokens))
      .send({ displayName: 'Taxi Alpha', colors: { primary: '#123456', accent: '#22aa55' }, supportPhone: '+15145550101', tagline: 'Alpha vous conduit', texts: { welcomeTitle: 'Bienvenue chez Alpha' }, termsUrl: 'https://taxi-alpha.test/conditions' })
      .expect(200);
    expect(alpha.body.joinCode).toBe(orgs.A.joinCode);
    expect(alpha.body.brand).toMatchObject({
      displayName: 'Taxi Alpha', colors: { primary: '#123456', accent: '#22AA55', secondary: NEOMOOV_BRAND.colors.secondary, background: NEOMOOV_BRAND.colors.background, text: NEOMOOV_BRAND.colors.text },
      support: { phone: '+15145550101' }, tagline: 'Alpha vous conduit', texts: { welcomeTitle: 'Bienvenue chez Alpha' }, termsUrl: 'https://taxi-alpha.test/conditions', privacyUrl: expect.stringContaining('http'),
    });
    // Le nom d'expéditeur suit le nom commercial ; l'adresse reste celle de la plateforme (domaine d'envoi non authentifié).
    expect(alpha.body.brand.emailSender).toEqual({ name: 'Taxi Alpha', address: parseSender(app.get<AppEnv>(APP_ENV).EMAIL_FROM).address });
    expect(alpha.body.stored).toMatchObject({ displayName: 'Taxi Alpha', colors: { primary: '#123456', accent: '#22AA55' }, supportEmail: null });
    expect(alpha.body.updatedAt).toEqual(expect.any(String));

    const beta = await request(server()).put(`/v1/admin/organizations/${orgs.B.id}/brand`).set(bearer(admin.tokens)).send({ displayName: 'Taxi Beta', colors: { primary: '#7A1F1F' }, emailSenderName: 'Service Taxi Beta' }).expect(200);
    expect(beta.body.brand).toMatchObject({ displayName: 'Taxi Beta', colors: { primary: '#7A1F1F' }, emailSender: { name: 'Service Taxi Beta' } });
    // Une mise à jour partielle conserve le reste ; null efface.
    const partial = await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(admin.tokens)).send({ tagline: null, supportEmail: 'aide@taxi-alpha.test' }).expect(200);
    expect(partial.body.brand).toMatchObject({ displayName: 'Taxi Alpha', tagline: NEOMOOV_BRAND.tagline, support: { phone: '+15145550101', email: 'aide@taxi-alpha.test' }, colors: { primary: '#123456' } });

    // Validation : couleur non hexadécimale, puis contraste sous WCAG AA (couleur principale trop claire, texte trop pâle).
    expect((await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(admin.tokens)).send({ colors: { primary: 'bleu' } })).status).toBe(400);
    const light = await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(admin.tokens)).send({ colors: { primary: '#FFD400' } });
    expect(light.status).toBe(400);
    expect(light.body.code).toBe('BRAND_CONTRAST');
    expect(light.body.details.issues[0]).toMatchObject({ pair: 'button_text_on_primary', minimum: 4.5 });
    const pale = await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(admin.tokens)).send({ colors: { text: '#AAB6C4' } });
    expect(pale.body).toMatchObject({ code: 'BRAND_CONTRAST', details: { issues: [{ pair: 'text_on_background' }] } });
    // Rien n'a été enregistré par les refus.
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(admin.tokens)).expect(200)).body.brand.colors.primary).toBe('#123456');
    expect((await request(server()).get(`/v1/admin/organizations/00000000-0000-4000-8000-000000000001/brand`).set(bearer(admin.tokens))).status).toBe(404);

    // Marque publique par code : sans jeton, code saisi en minuscules avec un tiret, cache d'une minute, aucune donnée personnelle.
    const lower = `${orgs.A.joinCode.slice(0, 4).toLowerCase()}-${orgs.A.joinCode.slice(4)}`;
    const byCode = await request(server()).get('/v1/public/brand').query({ code: lower }).expect(200);
    expect(byCode.headers['cache-control']).toBe('public, max-age=60');
    expect(Object.keys(byCode.body).sort()).toEqual(['brand', 'joinCode', 'organizationId', 'organizationName']);
    expect(byCode.body).toMatchObject({ organizationId: orgs.A.id, organizationName: 'Taxi Alpha', joinCode: orgs.A.joinCode, brand: { displayName: 'Taxi Alpha', colors: { primary: '#123456' } } });
    expect((await request(server()).get('/v1/public/brand').query({ code: orgs.B.joinCode }).expect(200)).body.brand.displayName).toBe('Taxi Beta');
    expect((await request(server()).get('/v1/public/brand').query({ code: 'ZZZZZZZZ' })).body.code).toBe('ORGANIZATION_CODE_NOT_FOUND');
    expect((await request(server()).get('/v1/public/brand')).status).toBe(400);
    expect((await request(server()).get('/v1/public/brand').query({ code: orgs.A.joinCode, domain: 'a.test' })).status).toBe(400);

    // Domaines : jeton et enregistrement TXT rendus à la création ; rien n'est servi avant la vérification manuelle par la plateforme.
    const domain = `reservation-${tag()}.taxi-alpha.test`;
    const created = await request(server()).post(`/v1/admin/organizations/${orgs.A.id}/domains`).set(bearer(admin.tokens)).send({ domain: domain.toUpperCase(), kind: 'booking' }).expect(201);
    expect(created.body).toMatchObject({ domain, kind: 'booking', verifiedAt: null, dnsRecord: { type: 'TXT', name: `_neomoov-verification.${domain}` } });
    expect(created.body.dnsRecord.value).toBe(`neomoov-verification=${created.body.verificationToken}`);
    expect((await request(server()).get('/v1/public/brand').query({ domain })).body.code).toBe('DOMAIN_NOT_FOUND');
    expect((await request(server()).post(`/v1/admin/organizations/${orgs.B.id}/domains`).set(bearer(admin.tokens)).send({ domain })).body.code).toBe('DOMAIN_TAKEN');
    expect((await request(server()).post(`/v1/admin/organizations/${orgs.A.id}/domains`).set(bearer(admin.tokens)).send({ domain: 'pas un domaine' })).status).toBe(400);
    const verified = await request(server()).post(`/v1/admin/organizations/${orgs.A.id}/domains/${created.body.id}/verify`).set(bearer(admin.tokens)).expect(200);
    expect(verified.body.verifiedAt).toEqual(expect.any(String));
    const byDomain = await request(server()).get('/v1/public/brand').query({ domain: `https://${domain.toUpperCase()}:443/reserver` }).expect(200);
    expect(byDomain.body).toMatchObject({ organizationId: orgs.A.id, brand: { displayName: 'Taxi Alpha' } });
    const listed = await request(server()).get(`/v1/admin/organizations/${orgs.A.id}/domains`).set(bearer(admin.tokens)).expect(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).not.toHaveProperty('verificationToken');
    await request(server()).delete(`/v1/admin/organizations/${orgs.A.id}/domains/${created.body.id}`).set(bearer(admin.tokens)).expect(204);
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.A.id}/domains`).set(bearer(admin.tokens)).expect(200)).body).toEqual([]);
    expect((await request(server()).delete(`/v1/admin/organizations/${orgs.A.id}/domains/${created.body.id}`).set(bearer(admin.tokens))).status).toBe(404);
  });

  it('rattachement par code ; GET /v1/config renvoie la marque de chaque utilisateur et ses organisations ; consentement journalisé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const clientA = await loginByOtp(app);
    const clientB = await loginByOtp(app);
    const anonymous = await request(server()).get('/v1/config').expect(200);
    expect(anonymous.body.brand.displayName).toBe('Neomoov');
    expect(anonymous.body.brand.colors).toEqual(NEOMOOV_BRAND.colors);
    expect(anonymous.body.organizations).toEqual([]);
    const before = await request(server()).get('/v1/config').set(bearer(clientA)).expect(200);
    expect(before.body.brand.displayName).toBe('Neomoov');

    const attached = await request(server()).post('/v1/me/organizations/attach').set(bearer(clientA)).send({ code: orgs.A.joinCode.toLowerCase() }).expect(200);
    expect(attached.body).toMatchObject({ organization: { id: orgs.A.id, name: 'Taxi Alpha', joinCode: orgs.A.joinCode, current: true, brand: { displayName: 'Taxi Alpha', primary: '#123456' } }, brand: { displayName: 'Taxi Alpha' } });
    await request(server()).post('/v1/me/organizations/attach').set(bearer(clientB)).send({ code: orgs.B.joinCode }).expect(200);

    const configA = await request(server()).get('/v1/config').set(bearer(clientA)).expect(200);
    expect(configA.body.brand).toMatchObject({ displayName: 'Taxi Alpha', colors: { primary: '#123456' }, support: { phone: '+15145550101' } });
    expect(configA.body.organizations).toEqual([{ id: orgs.A.id, name: 'Taxi Alpha', joinCode: orgs.A.joinCode, current: true, brand: { displayName: 'Taxi Alpha', logoUrl: null, primary: '#123456' } }]);
    const configB = await request(server()).get('/v1/config').set(bearer(clientB)).expect(200);
    expect(configB.body.brand).toMatchObject({ displayName: 'Taxi Beta', colors: { primary: '#7A1F1F' } });
    // La configuration commune reste la même pour tous.
    expect(configB.body.booking).toEqual(configA.body.booking);

    const [client] = await db(app).select({ id: schema.clients.id, organizationId: schema.clients.organizationId }).from(schema.clients).where(eq(schema.clients.userId, clientA.user.id));
    expect(client!.organizationId).toBe(orgs.A.id);
    const consent = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'client.organization_attached'), eq(schema.auditLog.entityId, client!.id)));
    expect(consent).toHaveLength(1);
    expect(consent[0]!.actorUserId).toBe(clientA.user.id);
    expect(consent[0]!.after).toMatchObject({ organizationId: orgs.A.id, joinCode: orgs.A.joinCode, consent: 'code_entered_by_user' });

    // Idempotent ; code inconnu refusé ; changement d'organisation possible (une seule organisation cliente par profil en V1).
    await request(server()).post('/v1/me/organizations/attach').set(bearer(clientA)).send({ code: orgs.A.joinCode }).expect(200);
    expect(await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'client.organization_attached'), eq(schema.auditLog.entityId, client!.id)))).toHaveLength(1);
    expect((await request(server()).post('/v1/me/organizations/attach').set(bearer(clientA)).send({ code: 'ZZZZZZZZ' })).body.code).toBe('ORGANIZATION_CODE_NOT_FOUND');
    expect((await request(server()).post('/v1/me/organizations/attach').set(bearer(clientA)).send({ code: 'abc' })).status).toBe(400);
    expect((await request(server()).post('/v1/me/organizations/attach').send({ code: orgs.A.joinCode })).status).toBe(401);
    const switched = await request(server()).post('/v1/me/organizations/attach').set(bearer(clientA)).send({ code: orgs.B.joinCode }).expect(200);
    expect(switched.body.brand.displayName).toBe('Taxi Beta');
    expect((await request(server()).get('/v1/config').set(bearer(clientA)).expect(200)).body.organizations.map((o: { id: string }) => o.id)).toEqual([orgs.B.id]);
    await request(server()).post('/v1/me/organizations/attach').set(bearer(clientA)).send({ code: orgs.A.joinCode }).expect(200);
  });

  it('modification par un administrateur avec la permission brand.edit, refus sans ; lecture avec organizations.read', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const member = await loginByOtp(app);
    const refused = await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(member)).send({ displayName: 'Pirate' });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['brand.edit'] } });
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(member))).status).toBe(403);

    const createRole = async (permissions: string[]) => {
      const res = await request(server()).post('/v1/admin/roles').set(bearer(admin.tokens)).send({ organizationId: rootId, code: `brand_${tag()}`, name: 'Rôle marque', level: 2, permissions }).expect(201);
      createdRoles.push(res.body.id);
      await db(app!).insert(schema.memberships).values({ userId: member.user.id, organizationId: rootId, roleId: res.body.id });
      app!.get(AccessService).invalidate(member.user.id);
      return res.body.id as string;
    };
    await createRole(['organizations.read']);
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(member)).expect(200)).body.brand.displayName).toBe('Taxi Alpha');
    expect((await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(member)).send({ displayName: 'Pirate' })).status).toBe(403);
    expect((await request(server()).post(`/v1/admin/organizations/${orgs.A.id}/domains`).set(bearer(member)).send({ domain: 'x.taxi-alpha.test' })).status).toBe(403);

    await createRole(['brand.edit']);
    const updated = await request(server()).put(`/v1/admin/organizations/${orgs.A.id}/brand`).set(bearer(member)).send({ tagline: 'Alpha, toujours à l\'heure' }).expect(200);
    expect(updated.body.brand).toMatchObject({ displayName: 'Taxi Alpha', tagline: 'Alpha, toujours à l\'heure' });
    const [entry] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'organization.brand_updated'), eq(schema.auditLog.entityId, orgs.A.id), eq(schema.auditLog.actorUserId, member.user.id)));
    expect(entry!.after).toMatchObject({ tagline: 'Alpha, toujours à l\'heure' });
  });

  it('courriels et textos : deux organisations, deux expéditeurs ; la plateforme garde Neomoov', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const email = app.get<MockEmailProvider>(EMAIL_PROVIDER);
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    const delivery = app.get(NotificationDeliveryService);
    const outbox = app.get(NotificationsOutbox);
    const platformSender = parseSender(app.get<AppEnv>(APP_ENV).EMAIL_FROM);
    const users: Array<{ tokens: TokensView; code: string | null }> = [];
    for (const code of [orgs.A.joinCode, orgs.B.joinCode, null]) {
      const tokens = await loginByOtp(app);
      notificationOwners.push(tokens.user.id);
      await db(app).update(schema.users).set({ email: testEmail('brand') }).where(eq(schema.users.id, tokens.user.id));
      if (code) await request(server()).post('/v1/me/organizations/attach').set(bearer(tokens)).send({ code }).expect(200);
      users.push({ tokens, code });
    }
    const data = { rideId: '00000000-0000-4000-8000-000000000001', publicNumber: 'NM-2026-09-30-0001', finalPriceCents: 4_250 };
    const sentFor = async (userId: string, channel: 'email' | 'sms') => {
      await outbox.queue({ recipientUserId: userId, template: 'ride.completed', channel, data });
      const [row] = await db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.channel, channel)));
      expect(await delivery.deliver(row!.id)).toBe('sent');
      return row!.id;
    };

    // Client rattaché à Alpha (marque lue du profil client) ; client rattaché à Beta ; client de la plateforme.
    await sentFor(users[0]!.tokens.user.id, 'email');
    const alpha = email.sent.at(-1)!;
    expect(alpha.from).toBe(`Taxi Alpha <${platformSender.address}>`);
    expect(alpha.subject).toBe('Course terminée · Taxi Alpha');
    expect(alpha.html).toContain('Taxi Alpha, propulsé par Neomoov.');
    expect(alpha.html).toContain('voyagé avec Taxi Alpha');
    // Coordonnées de l'assistance de la marque dans le pied du courriel.
    expect(alpha.html).toContain('+15145550101');
    expect(alpha.html).toContain('aide@taxi-alpha.test');
    await sentFor(users[1]!.tokens.user.id, 'email');
    expect(email.sent.at(-1)!.from).toBe(`Service Taxi Beta <${platformSender.address}>`);

    // Adresse d'expéditeur de la marque : employée seulement si son domaine est authentifié (réglage email.sender_domains).
    await request(server()).put(`/v1/admin/organizations/${orgs.B.id}/brand`).set(bearer(admin.tokens)).send({ emailSenderAddress: 'avis@taxi-beta.test' }).expect(200);
    const resend = async () => {
      await db(app!).delete(schema.notifications).where(and(eq(schema.notifications.recipientUserId, users[1]!.tokens.user.id), eq(schema.notifications.channel, 'email')));
      await sentFor(users[1]!.tokens.user.id, 'email');
      return email.sent.at(-1)!.from;
    };
    expect(await resend()).toBe(`Service Taxi Beta <${platformSender.address}>`);
    const settings = app.get(SettingsService);
    const [existing] = await db(app).select().from(schema.settings).where(and(eq(schema.settings.key, 'email.sender_domains'), eq(schema.settings.scope, 'global')));
    try {
      if (existing) await db(app).update(schema.settings).set({ value: ['taxi-beta.test'] }).where(and(eq(schema.settings.key, 'email.sender_domains'), eq(schema.settings.scope, 'global')));
      else await db(app).insert(schema.settings).values({ key: 'email.sender_domains', scope: 'global', value: ['taxi-beta.test'], description: 'Test de la marque (étape 22)' });
      settings.invalidate();
      expect(await resend()).toBe('Service Taxi Beta <avis@taxi-beta.test>');
    } finally {
      if (existing) await db(app).update(schema.settings).set({ value: existing.value as object }).where(and(eq(schema.settings.key, 'email.sender_domains'), eq(schema.settings.scope, 'global')));
      else await db(app).delete(schema.settings).where(and(eq(schema.settings.key, 'email.sender_domains'), eq(schema.settings.scope, 'global')));
      settings.invalidate();
    }

    // Push : le nom dans les notifications reste « Neomoov » (règles 4.2.6 et 4.3 d'Apple), même pour un client rattaché.
    const push = app.get<MockPushProvider>(PUSH_PROVIDER);
    const pushToken = `ExponentPushToken[brand-${tag()}]`;
    const [device] = await db(app).insert(schema.devices).values({ userId: users[0]!.tokens.user.id, platform: 'ios', pushToken }).returning({ id: schema.devices.id });
    try {
      await outbox.queue({ recipientUserId: users[0]!.tokens.user.id, template: 'ride.completed', channel: 'push', data });
      const [pushRow] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, users[0]!.tokens.user.id), eq(schema.notifications.channel, 'push')));
      expect(await delivery.deliver(pushRow!.id)).toBe('sent');
      const sentPush = push.sent.at(-1)!;
      expect(sentPush.tokens).toEqual([pushToken]);
      expect(sentPush.body).toContain('Neomoov');
      expect(sentPush.body).not.toContain('Taxi Alpha');
    } finally {
      await db(app).delete(schema.devices).where(eq(schema.devices.id, device!.id));
    }
    await sentFor(users[2]!.tokens.user.id, 'email');
    const platform = email.sent.at(-1)!;
    expect(platform.from).toBe(`${platformSender.name} <${platformSender.address}>`);
    expect(platform.subject).toBe('Course terminée · Neomoov');
    expect(platform.html).not.toContain('propulsé par');

    await sentFor(users[0]!.tokens.user.id, 'sms');
    expect(sms.sent.at(-1)!.body.startsWith('Taxi Alpha : ')).toBe(true);
    await sentFor(users[2]!.tokens.user.id, 'sms');
    expect(sms.sent.at(-1)!.body.startsWith('Neomoov : ')).toBe(true);

    // Avis portant lui-même son organisation (`notifications.organization_id`) : la marque de la ligne l'emporte sur le profil.
    const [row] = await db(app).insert(schema.notifications).values({ recipientUserId: users[2]!.tokens.user.id, organizationId: orgs.B.id, channel: 'email', template: 'ride.completed', language: 'en', data }).returning({ id: schema.notifications.id });
    expect(await delivery.deliver(row!.id)).toBe('sent');
    const beta = email.sent.at(-1)!;
    expect(beta.from).toBe(`Service Taxi Beta <${platformSender.address}>`);
    expect(beta.subject).toBe('Ride completed · Taxi Beta');
    expect(beta.html).toContain('Taxi Beta, powered by Neomoov.');
  });

  it('dans OrgScopeService.run(A), la marque et les domaines de B sont invisibles et inaccessibles en écriture (politique)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const scope = app.get(OrgScopeService);
    await db(app).insert(schema.organizationDomains).values([
      { organizationId: orgs.A.id, domain: `hub-${tag()}.taxi-alpha.test`, kind: 'hub', verificationToken: 'tokenA' },
      { organizationId: orgs.B.id, domain: `hub-${tag()}.taxi-beta.test`, kind: 'hub', verificationToken: 'tokenB' },
    ]);
    const brands = await scope.run(orgs.A.path, async (tx) => tx.select({ organizationId: schema.brands.organizationId }).from(schema.brands).where(inArray(schema.brands.organizationId, [orgs.A.id, orgs.B.id])));
    expect(brands.map((b) => b.organizationId)).toEqual([orgs.A.id]);
    const domains = await scope.run(orgs.A.path, async (tx) => tx.select({ organizationId: schema.organizationDomains.organizationId }).from(schema.organizationDomains).where(inArray(schema.organizationDomains.organizationId, [orgs.A.id, orgs.B.id])));
    expect(domains.map((d) => d.organizationId)).toEqual([orgs.A.id]);
    // Aucune écriture ne peut viser B depuis A ; A reste modifiable.
    const touched = await scope.run(orgs.A.path, async (tx) => tx.update(schema.brands).set({ displayName: 'Pirate' }).where(eq(schema.brands.organizationId, orgs.B.id)).returning({ id: schema.brands.id }));
    expect(touched).toHaveLength(0);
    await expect(scope.run(orgs.A.path, async (tx) => tx.insert(schema.organizationDomains).values({ organizationId: orgs.B.id, domain: `pirate-${tag()}.taxi-beta.test`, verificationToken: 'x' }))).rejects.toThrow();
    const own = await scope.run(orgs.A.path, async (tx) => tx.update(schema.brands).set({ tagline: 'Depuis la portée A' }).where(eq(schema.brands.organizationId, orgs.A.id)).returning({ id: schema.brands.id }));
    expect(own).toHaveLength(1);
    expect((await db(app).select({ displayName: schema.brands.displayName }).from(schema.brands).where(eq(schema.brands.organizationId, orgs.B.id)))[0]!.displayName).toBe('Taxi Beta');
    // Hors transaction restreinte, la plateforme voit les deux marques.
    expect(await db(app).select({ id: schema.brands.id }).from(schema.brands).where(inArray(schema.brands.organizationId, [orgs.A.id, orgs.B.id]))).toHaveLength(2);
  });
});
