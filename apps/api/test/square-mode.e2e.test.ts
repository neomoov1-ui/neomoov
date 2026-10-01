/**
 * Étape 26 (intégration, fournisseur simulé) : page de saisie de carte par jeton (session signée de 15 minutes,
 * expirée ou altérée refusée, confirmation par le serveur web sans jeton d'accès de l'utilisateur), carte par jeton sur
 * la route authentifiée, méthode de prélèvement du chauffeur, webhook Square idempotent, et mode « Square » simulé
 * (capacités du simulateur sans SetupIntent ni Connect) : routes Connect en 409, versements hors plateforme listés et
 * exportés, clôture par settle-offline.
 */
import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockPaymentProvider } from '../src/adapters/mock/index.js';
import { PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { APP_ENV, type AppEnv } from '../src/config/env.js';
import { cardSessionKey, signCardSession } from '../src/modules/payments/card-session.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp } from './helpers.js';

const MOCK_CAPABILITIES = { setupIntent: true, cardToken: true, connect: true };
const SQUARE_LIKE = { setupIntent: false, cardToken: true, connect: false };
const sessionOf = (url: string) => new URL(url).searchParams.get('session')!;

describe('paiements par jeton de carte et versements hors plateforme (étape 26, intégration)', () => {
  let app: NestExpressApplication | null = null;
  let provider: MockPaymentProvider;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (app) provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  });
  beforeEach(async () => {
    if (!app) return;
    await resetHttpLimits(app);
    provider.capabilities = { ...MOCK_CAPABILITIES };
  });
  afterAll(async () => {
    if (app) {
      provider.capabilities = { ...MOCK_CAPABILITIES };
      await cleanupTestData(app);
    }
    await app?.close();
  });

  it('page de saisie : session signée liée à l\'utilisateur, expirée ou altérée refusée, carte confirmée par le serveur web', async () => {
    if (!app) return;
    const client = await loginByOtp(app, undefined, {}, { card: false });
    const setup = (await request(server()).post('/v1/payment-methods/setup-intent').set(bearer(client)).expect(201)).body;
    expect(setup).toMatchObject({ provider: 'mock', simulated: true, squareApplicationId: null, squareLocationId: null, squareEnvironment: null });
    expect(setup.cardFormUrl).toMatch(/\/carte\?session=/);
    const session = sessionOf(setup.cardFormUrl);

    // Aucun jeton d'accès dans l'adresse : seule la session signée y figure.
    expect(setup.cardFormUrl).not.toContain(client.accessToken);
    const info = (await request(server()).get('/v1/payment-methods/card-session').query({ session }).expect(200)).body;
    expect(info).toMatchObject({ provider: 'mock', purpose: 'client_card', returnUrl: 'neomoov://carte-enregistree' });
    expect(new Date(info.expiresAt).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    const env = app.get<AppEnv>(APP_ENV);
    const expired = signCardSession({ userId: client.user.id, purpose: 'client_card', expiresAt: new Date(Date.now() - 1_000) }, cardSessionKey(env.ENCRYPTION_KEY!));
    expect((await request(server()).get('/v1/payment-methods/card-session').query({ session: expired }).expect(401)).body.code).toBe('CARD_SESSION_EXPIRED');
    const confirmExpired = await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session: expired, sourceId: 'cnon:card-nonce-ok' });
    expect(confirmExpired.status).toBe(401);
    expect(confirmExpired.body.code).toBe('CARD_SESSION_EXPIRED');
    const forged = `${session.slice(0, -4)}${session.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA'}`;
    expect((await request(server()).get('/v1/payment-methods/card-session').query({ session: forged }).expect(401)).body.code).toBe('CARD_SESSION_INVALID');
    const otherKey = signCardSession({ userId: client.user.id, purpose: 'client_card', expiresAt: new Date(Date.now() + 60_000) }, cardSessionKey('une-autre-cle-de-chiffrement-32-octets'));
    expect((await request(server()).get('/v1/payment-methods/card-session').query({ session: otherKey }).expect(401)).body.code).toBe('CARD_SESSION_INVALID');

    // Jeton de carte refusé par le fournisseur : 402, aucune carte enregistrée.
    const refused = await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session, sourceId: 'cnon:invalide' });
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('PAYMENT_DECLINED');

    const saved = (await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session, sourceId: 'cnon:card-nonce-ok' }).expect(201)).body;
    expect(saved).toMatchObject({ purpose: 'client_card', debitMethod: null, card: { brand: 'visa', last4: '4242', isDefault: true } });
    // Rejouée (double envoi de la page), la confirmation reprend la même carte.
    const again = (await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session, sourceId: 'cnon:card-nonce-ok' }).expect(201)).body;
    expect(again.card.id).toBe(saved.card.id);
    const methods = (await request(server()).get('/v1/payment-methods').set(bearer(client)).expect(200)).body as Array<{ id: string }>;
    expect(methods.map((m) => m.id)).toEqual([saved.card.id]);
    const [row] = await db(app).select({ provider: schema.clientPaymentMethods.provider }).from(schema.clientPaymentMethods).where(eq(schema.clientPaymentMethods.id, saved.card.id));
    expect(row!.provider).toBe('mock');
  });

  it('route authentifiée : carte par jeton (`sourceId`) ; corps sans SetupIntent ni jeton refusé', async () => {
    if (!app) return;
    const client = await loginByOtp(app, undefined, {}, { card: false });
    const card = (await request(server()).post('/v1/payment-methods/confirm').set(bearer(client)).send({ sourceId: 'cnon:card-nonce-ok', verificationToken: 'verf:test' }).expect(201)).body;
    expect(card).toMatchObject({ brand: 'visa', last4: '4242', isDefault: true });
    expect(provider.calls.some((c) => c.method === 'saveCard' && (c.args[0] as { verificationToken?: string }).verificationToken === 'verf:test')).toBe(true);
    expect((await request(server()).post('/v1/payment-methods/confirm').set(bearer(client)).send({ makeDefault: true })).status).toBe(400);
    // Fournisseur sans jeton de carte (Stripe) : page de saisie absente, jeton refusé en 409.
    provider.capabilities = { setupIntent: true, cardToken: false, connect: true };
    const setup = (await request(server()).post('/v1/payment-methods/setup-intent').set(bearer(client)).expect(201)).body;
    expect(setup.cardFormUrl).toBeNull();
    expect((await request(server()).post('/v1/payment-methods/confirm').set(bearer(client)).send({ sourceId: 'cnon:card-nonce-ok' }).expect(409)).body.code).toBe('CARD_TOKEN_UNAVAILABLE');
  });

  it('webhook Square : signature vérifiée par le fournisseur, événement enregistré une seule fois', async () => {
    if (!app) return;
    const event = { id: `evt_square_${Math.random().toString(36).slice(2, 12)}`, type: 'payment_intent.canceled', data: { object: { id: 'pay_inconnu', status: 'canceled' } } };
    const post = (signature: string) => request(server()).post('/v1/webhooks/square').set('x-square-hmacsha256-signature', signature).set('content-type', 'application/json').send(JSON.stringify(event));
    expect((await post('mock-signature').expect(200)).body).toEqual({ received: true, duplicate: false });
    expect((await post('mock-signature').expect(200)).body).toEqual({ received: true, duplicate: true });
    expect((await post('signature-forgee')).status).toBe(400);
    expect((await request(server()).post('/v1/webhooks/square').set('content-type', 'application/json').send(JSON.stringify(event))).status).toBe(400);
    expect(await db(app).select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, event.id))).toHaveLength(1);
  });

  it('mode Square : Connect refusé (409), versement par virement, prélèvement par la page de saisie, relevé positif à verser hors plateforme', async () => {
    if (!app) return;
    // Comptes créés avant le passage en mode Square : la carte de test des aides passe par un SetupIntent.
    const driver = await createDriver(app);
    const staff = await createStaffAndLogin(app, ['admin']);
    provider.capabilities = { ...SQUARE_LIKE };

    const link = await request(server()).post('/v1/driver/connect/onboarding-link').set(bearer(driver.tokens));
    expect(link.status).toBe(409);
    expect(link.body.code).toBe('CONNECT_UNAVAILABLE');
    expect((await request(server()).get('/v1/driver/payout').set(bearer(driver.tokens)).expect(200)).body).toMatchObject({ linked: false, onboarded: false, payoutMode: 'offline' });
    expect((await request(server()).get('/v1/driver/connect/status').set(bearer(driver.tokens)).expect(200)).body).toMatchObject({ payoutMode: 'offline', payoutsEnabled: false });

    // Méthode de prélèvement (relevés négatifs) : page de saisie avec une session « driver_debit ».
    const setup = (await request(server()).post('/v1/driver/payment-method').set(bearer(driver.tokens)).expect(201)).body;
    expect(setup).toMatchObject({ setupIntentId: null, clientSecret: null });
    const session = sessionOf(setup.cardFormUrl);
    expect((await request(server()).get('/v1/payment-methods/card-session').query({ session }).expect(200)).body).toMatchObject({ purpose: 'driver_debit', returnUrl: 'neomoov-driver://payout' });
    const debit = (await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session, sourceId: 'cnon:card-nonce-ok' }).expect(201)).body;
    expect(debit).toMatchObject({ purpose: 'driver_debit', card: null, debitMethod: { brand: 'visa', last4: '4242' } });
    expect((await request(server()).get('/v1/driver/connect/status').set(bearer(driver.tokens)).expect(200)).body.debitMethod).toEqual({ brand: 'visa', last4: '4242' });

    // Relevé émis au net positif : le règlement ne verse rien et le laisse émis, à verser hors plateforme.
    const [statement] = await db(app)
      .insert(schema.weeklyStatements)
      .values({ driverId: driver.driverId, periodStart: '2026-01-05', periodEnd: '2026-01-11', creditsCents: 12_345, netCents: 12_345, status: 'issued', issuedAt: new Date() })
      .returning({ id: schema.weeklyStatements.id });
    const paid = (await request(server()).post(`/v1/admin/statements/${statement!.id}/pay`).set(bearer(staff.tokens)).expect(200)).body;
    expect(paid).toMatchObject({ status: 'issued', attempts: 0, failureCode: null, transferRef: null });
    expect(provider.calls.some((c) => c.method === 'transfer')).toBe(false);

    const list = (await request(server()).get('/v1/admin/payouts/offline').set(bearer(staff.tokens)).expect(200)).body as Array<{ statementId: string; amountCents: number; reference: string; status: string }>;
    const mine = list.find((p) => p.statementId === statement!.id);
    expect(mine).toMatchObject({ amountCents: 12_345, status: 'issued' });
    expect(mine!.reference).toMatch(/^NM-20260105-/);
    const csv = await request(server()).get('/v1/admin/payouts/offline/export').set(bearer(staff.tokens)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('neomoov-versements-a-faire-');
    expect(csv.text.split('\r\n')[0]).toBe('chauffeur;nom;courriel_interac;periode_debut;periode_fin;montant_cents;reference;releve;etat');
    expect(csv.text).toContain(`;12345;${mine!.reference};${statement!.id};issued`);
    expect(csv.text).toMatch(/\r\nTOTAL;\d+;;;;\d+;;;\r\n$/);
    const driverRead = await request(server()).get('/v1/admin/payouts/offline').set(bearer(driver.tokens));
    expect(driverRead.status).toBe(403);

    const settled = (await request(server()).post(`/v1/admin/statements/${statement!.id}/settle-offline`).set(bearer(staff.tokens)).send({ method: 'bank_transfer', reference: mine!.reference }).expect(200)).body;
    expect(settled).toMatchObject({ status: 'paid', offlineSettlement: { method: 'bank_transfer', reference: mine!.reference } });
    const after = (await request(server()).get('/v1/admin/payouts/offline').set(bearer(staff.tokens)).expect(200)).body as Array<{ statementId: string }>;
    expect(after.some((p) => p.statementId === statement!.id)).toBe(false);
  });
});
