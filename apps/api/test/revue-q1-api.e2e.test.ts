import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { authorizationCents, type TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockPaymentProvider } from '../src/adapters/mock/index.js';
import { PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { AntiBotService } from '../src/common/anti-bot.service.js';
import { RateLimitService } from '../src/common/rate-limit.service.js';
import { SettingsService } from '../src/common/settings.service.js';
import { StatementsService } from '../src/modules/settlement/statements.service.js';
import {
  bearer, cleanupTestData, createDriver, createStaffAndLogin, currentPolicyVersion, db, loginByOtp, requestOtp, resetHttpLimits, startTestApp, testPhone, trackUser,
  type StaffSession, type TestDriver,
} from './helpers.js';

/**
 * Revue Q1 du 3 octobre 2026 (restes de la revue du 2 octobre, API) : contre-proposition acceptée au-dessus de
 * l'autorisation bancaire (métier 13), courses non réglées de plus de 8 semaines (métier 14), code SMS d'un tiers
 * (sécurité 17), session de saisie de carte à usage unique hors de l'adresse (sécurité 16), défi Turnstile exigé
 * seulement après plusieurs échecs (connexion du personnel, codes SMS d'un navigateur, devis publics du web).
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
/** Course longue (environ 55 km) : la contre-proposition dépasse l'autorisation posée au prix maximal consenti. */
const SAINT_JEROME = { address: '10 rue de la Gare, Saint-Jérôme', coordinates: { lat: 45.78, lng: -74.003 } };
const key = () => `rq1-${Math.random().toString(36).slice(2, 14)}`;
const CONSENT = 'J\'accepte le nouveau prix maximal proposé par le chauffeur.';
/** Adresses de documentation (RFC 5737), une par scénario du défi : les compteurs ne se mélangent pas. */
const IP = { staff: '203.0.113.10', staffOther: '203.0.113.11', otp: '203.0.113.20', quotes: '203.0.113.30', off: '203.0.113.40' };
type Tokens = Pick<TokensView, 'accessToken'> & { user: { id: string } };
interface RideBody { id: string; quote: { totalCents: number }; negotiation: { agreedTotalCents: number | null } | null }

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('revue Q1 du 3 octobre 2026 : argent, codes SMS, session de carte, défi anti-robots (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let operator: StaffSession;
  const server = () => app!.getHttpServer();
  const provider = () => app!.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  const statements = () => app!.get(StatementsService);

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on', FEATURE_NEGOTIATION: 'on', FEATURE_NEGOTIATION_ABOVE_MAX: 'on' });
    if (!app) return;
    operator = await createStaffAndLogin(app, ['operator']);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const paymentOf = async (rideId: string) => (await db(app!).select().from(schema.payments).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'ride'))))[0]!;
  const rideRow = async (rideId: string) => (await db(app!).select().from(schema.rides).where(eq(schema.rides.id, rideId)))[0]!;
  const eventsOf = async (rideId: string) => (await db(app!).select({ type: schema.rideEvents.type, data: schema.rideEvents.data }).from(schema.rideEvents).where(eq(schema.rideEvents.rideId, rideId)));
  const rules = async () => {
    const settings = app!.get(SettingsService);
    return { marginPpm: await settings.number('payments.authorization_margin_ppm', 150_000), marginCapCents: await settings.number('payments.authorization_margin_cap_cents', 2_000) };
  };

  /**
   * Course immédiate payée par carte (autorisation au prix maximal consenti), puis négociation ouverte en base : la
   * proposition du client au prix affiché, adressée à ce chauffeur, et sa contre-proposition au-dessus du prix affiché
   * par la route du chauffeur.
   */
  async function counteredRide(client: Tokens, driver: TestDriver): Promise<{ rideId: string; displayed: number; counterId: string; counterCents: number }> {
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: SAINT_JEROME }).expect(201)).body.quotes[0] as { id: string; totalCents: number; maxConsentedCents: number };
    const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'immediate', paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const ride = created.body as RideBody;
    const displayed = quote.totalCents;
    await db(app!).update(schema.rides).set({ negotiationMode: 'negotiation', proposedTotalCents: displayed }).where(eq(schema.rides.id, ride.id));
    const [proposal] = await db(app!).insert(schema.rideOffers).values({
      rideId: ride.id, driverId: driver.driverId, type: 'client_proposal', state: 'sent', driverFareCents: Math.round(displayed * 0.7), proposedTotalCents: displayed, displayedTotalCents: displayed, expiresAt: new Date(Date.now() + 600_000),
    }).returning({ id: schema.rideOffers.id });
    // Sous le plafond des contre-propositions (130 % du prix affiché) et au-dessus de l'autorisation en place.
    const counterCents = Math.round((displayed * 1.25) / 100) * 100;
    const counter = await request(server()).post(`/v1/driver/offers/${proposal!.id}/counter`).set(bearer(driver.tokens)).send({ proposedTotalCents: counterCents, reason: 'event' });
    expect(counter.status, JSON.stringify(counter.body)).toBe(201);
    return { rideId: ride.id, displayed, counterId: counter.body.id as string, counterCents };
  }

  it('métier 13 : contre-proposition au-dessus de l\'autorisation, nouvelle autorisation au nouveau plafond, capture entière, rien de rejoué', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const { rideId, counterId, counterCents } = await counteredRide(client, driver);
    const before = await paymentOf(rideId);
    expect(before).toMatchObject({ status: 'authorized' });
    const expected = authorizationCents(counterCents, await rules());
    // Sans nouvelle autorisation, la capture de fin de course serait plafonnée sous le prix convenu.
    expect(expected).toBeGreaterThan(before.authorizedCents);

    const accepted = await request(server()).post(`/v1/rides/${rideId}/offers/${counterId}/accept`).set(bearer(client)).send({ consentText: CONSENT });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ state: 'assigned', driver: { id: driver.driverId }, negotiation: { agreedTotalCents: counterCents } });
    const after = await paymentOf(rideId);
    expect(after).toMatchObject({ status: 'authorized', authorizedCents: expected });
    expect(after.stripePaymentIntentId).not.toBe(before.stripePaymentIntentId);
    // L'ancienne empreinte est levée ; une seule nouvelle autorisation, clé fixée par la course et le montant.
    expect(provider().intents.get(before.stripePaymentIntentId!)?.status).toBe('canceled');
    const reauths = () => provider().calls.filter((c) => c.method === 'authorize' && (c.args[0] as { idempotencyKey: string }).idempotencyKey.startsWith(`ride-reauth:${rideId}:`));
    expect(reauths().map((c) => (c.args[0] as { idempotencyKey: string }).idempotencyKey)).toEqual([`ride-reauth:${rideId}:${expected}`]);
    expect(await rideRow(rideId)).toMatchObject({ maxConsentedCents: counterCents, agreedTotalCents: counterCents, driverId: driver.driverId });
    expect((await eventsOf(rideId)).map((e) => e.type)).toEqual(expect.arrayContaining(['payment_reauthorized', 'negotiation_above_max_accepted', 'negotiation_agreed']));

    // Acceptation rejouée (double envoi) : refusée, aucune seconde empreinte.
    expect((await request(server()).post(`/v1/rides/${rideId}/offers/${counterId}/accept`).set(bearer(client)).send({ consentText: CONSENT })).status).toBe(409);
    expect(reauths()).toHaveLength(1);

    // Fin de course : le prix convenu est capturé en entier, sans solde dû.
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(driver.tokens)).expect(200);
    const completed = await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 56_000, measuredDurationSeconds: 5_900 });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    expect(completed.body.finalPriceCents).toBe(counterCents);
    const ride = await rideRow(rideId);
    const captured = await until(() => paymentOf(rideId), (p) => p.status !== 'authorized', 'capture de fin de course');
    expect(captured).toMatchObject({ status: 'captured', capturedCents: counterCents - ride.creditsAppliedCents });
    const shortfall = await db(app).select({ id: schema.incidents.id }).from(schema.incidents).where(and(eq(schema.incidents.rideId, rideId), sql`${schema.incidents.description} LIKE 'Paiement non encaissé%'`));
    expect(shortfall).toHaveLength(0);
  });

  it('métier 13 : nouvelle autorisation refusée par la banque, acceptation refusée (402), course, offre et paiement inchangés', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const { rideId, counterId } = await counteredRide(client, driver);
    const before = await paymentOf(rideId);
    const rideBefore = await rideRow(rideId);
    // La carte de la course est refusée à la nouvelle autorisation (simulateur : référence terminée par « _declined »).
    await db(app).update(schema.payments).set({ stripePaymentMethodId: `${before.stripePaymentMethodId}_declined` }).where(eq(schema.payments.id, before.id));

    const refused = await request(server()).post(`/v1/rides/${rideId}/offers/${counterId}/accept`).set(bearer(client)).send({ consentText: CONSENT });
    expect(refused.status, JSON.stringify(refused.body)).toBe(402);
    expect(refused.body.code).toBe('PAYMENT_DECLINED');
    expect(await rideRow(rideId)).toMatchObject({ driverId: null, maxConsentedCents: rideBefore.maxConsentedCents, agreedTotalCents: null, state: rideBefore.state });
    const [offer] = await db(app).select({ state: schema.rideOffers.state }).from(schema.rideOffers).where(eq(schema.rideOffers.id, counterId));
    expect(offer!.state).toBe('sent');
    expect(await paymentOf(rideId)).toMatchObject({ status: 'authorized', stripePaymentIntentId: before.stripePaymentIntentId, authorizedCents: before.authorizedCents });
    expect(provider().intents.get(before.stripePaymentIntentId!)?.status).toBe('authorized');
    const types = (await eventsOf(rideId)).map((e) => e.type);
    expect(types).toContain('payment_reauthorization_failed');
    expect(types).not.toContain('negotiation_above_max_accepted');
  });

  it('métier 14 : course jamais réglée de plus de 8 semaines reprise une seule fois avec alerte ; pourboire tardif d\'une vieille course versé', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    let hour = 3;
    /** Course planifiée créée par l'API, puis terminée à la date voulue (paiement par carte : réglée par le relevé). */
    const ride = async (at: string, fareCents = 2_000) => {
      hour += 2;
      const requestedAt = new Date(Date.now() + hour * 3_600_000).toISOString();
      const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
      const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
        .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201);
      const id = created.body.id as string;
      await db(app!).update(schema.rides).set({
        state: 'completed', driverId: driver.driverId, paymentChoice: 'prepaid', paymentMethod: 'card_app', fareCents, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 115, qstCents: 229, tipCents: 0,
        stateTimestamps: { completed: at },
      }).where(eq(schema.rides.id, id));
      return id;
    };
    const lateNotices = (statementId: string) => db(app!).select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.settlement_late_rides'), sql`${schema.notifications.data}->>'statementId' = ${statementId}`));
    const lateAudits = (statementId: string) => db(app!).select({ after: schema.auditLog.after }).from(schema.auditLog).where(and(eq(schema.auditLog.action, 'statement.late_rides_caught_up'), eq(schema.auditLog.entityId, statementId)));

    // Janvier : une course réglée par un relevé émis.
    const settled = await ride('2026-01-07T15:00:00Z');
    const january = (await statements().generate({ periodStart: '2026-01-05', driverId: driver.driverId })).statements[0]!;
    expect(january.lines.map((l) => l.rideId)).toContain(settled);
    await statements().issue(january.id!, new Date('2026-01-12T12:00:00Z'));
    // Course de janvier inscrite en retard (jamais portée par un relevé) et une course récente.
    const forgotten = await ride('2026-01-06T15:00:00Z');
    const recent = await ride('2026-06-03T15:00:00Z');

    // La passe de tous les chauffeurs (aperçu, sans écriture) retient ce chauffeur malgré l'âge de la course oubliée.
    const pass = await statements().generate({ periodStart: '2026-06-01', preview: true });
    expect(pass.statements.some((s) => s.driverId === driver.driverId)).toBe(true);
    const june = (await statements().generate({ periodStart: '2026-06-01', driverId: driver.driverId })).statements[0]!;
    expect(june.lines.map((l) => l.rideId)).toEqual(expect.arrayContaining([forgotten, recent]));
    // La course déjà réglée, sans élément tardif, n'est pas reprise.
    expect(june.lines.map((l) => l.rideId)).not.toContain(settled);
    // Exploitation avertie : avis au personnel et audit, une seule fois même si le brouillon est recalculé.
    const notices = await until(() => lateNotices(june.id!), (rows) => rows.length > 0, 'avis des courses anciennes');
    await until(() => lateAudits(june.id!), (rows) => rows.length > 0, 'audit des courses anciennes');
    const again = (await statements().generate({ periodStart: '2026-06-01', driverId: driver.driverId })).statements[0]!;
    expect(again.id).toBe(june.id);
    expect(again.lines.filter((l) => l.rideId === forgotten).length).toBe(june.lines.filter((l) => l.rideId === forgotten).length);
    await new Promise((r) => setTimeout(r, 300));
    expect(await lateNotices(june.id!)).toHaveLength(notices.length);
    const audits = await lateAudits(june.id!);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.after).toMatchObject({ rideIds: [forgotten], count: 1 });
    await statements().issue(june.id!, new Date('2026-06-08T12:00:00Z'));

    // Pourboire laissé des mois après une course réglée : porté par le relevé suivant, une seule fois.
    await db(app).update(schema.rides).set({ tipCents: 500 }).where(eq(schema.rides.id, settled));
    const next = (await statements().generate({ periodStart: '2026-06-08', driverId: driver.driverId })).statements[0];
    expect(next).toBeDefined();
    expect(next!.lines.map((l) => ({ kind: l.kind, rideId: l.rideId, amountCents: l.amountCents }))).toEqual([{ kind: 'tip_platform', rideId: settled, amountCents: 500 }]);
    await statements().issue(next!.id!, new Date('2026-06-15T12:00:00Z'));
    expect((await statements().generate({ periodStart: '2026-06-15', driverId: driver.driverId })).statements).toHaveLength(0);
  });

  it('sécurité 17 : le code demandé par un tiers n\'invalide pas celui du titulaire ; tentatives comptées sur tous les codes du numéro', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    const verify = async (code: string) => request(server()).post('/v1/auth/otp/verify').send({ phone, code, acceptTerms: true, privacyPolicyVersion: await currentPolicyVersion(app!) });
    const mine = await requestOtp(app, phone);
    let theirs = await requestOtp(app, phone);
    for (let i = 0; theirs === mine && i < 3; i += 1) theirs = await requestOtp(app, phone);
    expect(theirs).not.toBe(mine);
    // Le titulaire saisit son code après la demande du tiers : la connexion s'ouvre.
    const ok = await verify(mine);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    trackUser(ok.body.user.id as string);
    // Le code du tiers est clos par la connexion réussie.
    expect((await verify(theirs)).body.code).toBe('OTP_EXPIRED');

    // Deux codes valides : chaque tentative fausse compte pour le numéro, pas pour un seul code.
    await requestOtp(app, phone);
    const last = await requestOtp(app, phone);
    const wrong = last === '000000' ? '111111' : '000000';
    const first = await verify(wrong);
    expect(first.body.code).toBe('OTP_INVALID');
    let left = first.body.details.attemptsLeft as number;
    let res = first;
    while (left > 0) {
      res = await verify(wrong);
      left = res.body.details?.attemptsLeft ?? 0;
      if (res.body.code !== 'OTP_INVALID') break;
    }
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('OTP_LOCKED');
    // Plus aucun code du numéro ne sert, même le bon.
    expect((await verify(last)).body.code).toBe('OTP_EXPIRED');
  });

  it('sécurité 16 : session de carte dans le fragment de l\'adresse, lue par le corps, à usage unique (rejeu et envoi simultané refusés)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app, undefined, {}, { card: false });
    const setup = (await request(server()).post('/v1/payment-methods/setup-intent').set(bearer(client)).expect(201)).body as { cardFormUrl: string };
    const url = new URL(setup.cardFormUrl);
    expect(url.pathname).toBe('/carte');
    expect(url.searchParams.get('session')).toBeNull();
    expect(url.searchParams.get('v')).toBe('2');
    const session = new URLSearchParams(url.hash.slice(1)).get('session')!;
    expect(session).toBeTruthy();

    // Lecture par le corps d'une requête ; l'ancienne lecture par la chaîne de requête n'existe plus.
    const info = (await request(server()).post('/v1/payment-methods/card-session/info').send({ session }).expect(200)).body as { expiresAt: string; purpose: string };
    expect(info.purpose).toBe('client_card');
    expect(new Date(info.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(10 * 60_000);
    expect((await request(server()).get('/v1/payment-methods/card-session').query({ session })).status).toBe(404);

    // Deux confirmations simultanées : une seule passe.
    const both = await Promise.all([0, 1].map(() => request(server()).post('/v1/payment-methods/card-session/confirm').send({ session, sourceId: 'cnon:card-nonce-ok' })));
    expect(both.map((r) => r.status).sort()).toEqual([201, 401]);
    expect(both.find((r) => r.status === 401)!.body.code).toBe('CARD_SESSION_USED');
    // Rejouée ou relue ensuite : refusée.
    expect((await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session, sourceId: 'cnon:card-nonce-ok' }).expect(401)).body.code).toBe('CARD_SESSION_USED');
    expect((await request(server()).post('/v1/payment-methods/card-session/info').send({ session }).expect(401)).body.code).toBe('CARD_SESSION_USED');
    const methods = (await request(server()).get('/v1/payment-methods').set(bearer(client)).expect(200)).body as Array<{ id: string }>;
    expect(methods).toHaveLength(1);

    // Carte refusée : la session est rendue pour un nouvel essai sur la même page.
    const retry = new URLSearchParams(new URL(((await request(server()).post('/v1/payment-methods/setup-intent').set(bearer(client)).expect(201)).body as { cardFormUrl: string }).cardFormUrl).hash.slice(1)).get('session')!;
    expect((await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session: retry, sourceId: 'cnon:invalide' })).status).toBe(402);
    await request(server()).post('/v1/payment-methods/card-session/confirm').send({ session: retry, sourceId: 'cnon:card-nonce-ok' }).expect(201);
  });

  it('défi anti-robots éteint sans clé secrète : aucun jeton demandé, même après plusieurs échecs', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    for (let i = 0; i < 4; i += 1) {
      const res = await request(server()).post('/v1/auth/staff/login').set('X-Forwarded-For', IP.off).send({ email: operator.email, password: 'mauvais-mot-de-passe' });
      expect(res.status).toBe(401);
    }
    await request(server()).post('/v1/auth/staff/login').set('X-Forwarded-For', IP.off).send({ email: operator.email, password: operator.password }).expect(200);
  });

  describe('défi Turnstile après plusieurs échecs (clé secrète de test, vérification simulée)', () => {
    let guarded: NestExpressApplication | null = null;
    let admin: StaffSession;
    const otpPhones: string[] = [];
    const quoteIds: string[] = [];
    let apiKeyId: string | null = null;
    const http = () => guarded!.getHttpServer();

    beforeAll(async () => {
      if (!app) return;
      guarded = await startTestApp({ TURNSTILE_SECRET_KEY: 'cle-de-test-turnstile' });
      if (guarded) admin = await createStaffAndLogin(guarded, ['admin']);
    });
    afterAll(async () => {
      if (guarded) {
        if (otpPhones.length) await db(guarded).delete(schema.otpCodes).where(inArray(schema.otpCodes.phone, otpPhones));
        if (quoteIds.length) await db(guarded).delete(schema.quotes).where(inArray(schema.quotes.id, quoteIds));
        if (apiKeyId) await db(guarded).delete(schema.apiKeys).where(eq(schema.apiKeys.id, apiKeyId));
      }
      await guarded?.close();
    });

    it('connexion du personnel : jeton exigé après 3 mots de passe faux depuis une adresse, refusé s\'il échoue, compteur remis à zéro par une connexion', async ({ skip }) => {
      if (!guarded) return skip('DATABASE_URL absente');
      const login = (ip: string, password: string, token?: string) => {
        const req = request(http()).post('/v1/auth/staff/login').set('X-Forwarded-For', ip);
        if (token) req.set('x-turnstile-token', token);
        return req.send({ email: admin.email, password });
      };
      for (let i = 0; i < 3; i += 1) expect((await login(IP.staff, 'mauvais-mot-de-passe')).status).toBe(401);
      const required = await login(IP.staff, admin.password);
      expect(required.status).toBe(403);
      expect(required.body.code).toBe('TURNSTILE_REQUIRED');
      expect((await login(IP.staff, admin.password, 'fail')).body.code).toBe('TURNSTILE_FAILED');
      // Une autre adresse n'est pas touchée.
      expect((await login(IP.staffOther, 'mauvais-mot-de-passe')).status).toBe(401);
      // Défi réussi et bon mot de passe : connexion ; le compteur de l'adresse repart de zéro.
      expect((await login(IP.staff, admin.password, 'jeton-valide')).status).toBe(200);
      expect((await login(IP.staff, 'mauvais-mot-de-passe')).status).toBe(401);
    });

    it('codes SMS : défi pour un navigateur après 5 demandes par adresse, jamais pour les applications', async ({ skip }) => {
      if (!guarded) return skip('DATABASE_URL absente');
      const limits = guarded.get(RateLimitService);
      const ask = async (headers: Record<string, string>) => {
        await limits.reset(`otp:ip:${IP.otp}`);
        const phone = testPhone();
        otpPhones.push(phone);
        return request(http()).post('/v1/auth/otp/request').set({ 'X-Forwarded-For': IP.otp, ...headers }).send({ phone });
      };
      for (let i = 0; i < 5; i += 1) expect((await ask({ 'x-neomoov-client': 'web' })).status).toBe(200);
      const required = await ask({ 'x-neomoov-client': 'web' });
      expect(required.status).toBe(403);
      expect(required.body.code).toBe('TURNSTILE_REQUIRED');
      expect((await ask({ Origin: 'https://neomoov.net' })).body.code).toBe('TURNSTILE_REQUIRED');
      expect((await ask({ 'x-neomoov-client': 'web', 'x-turnstile-token': 'fail' })).body.code).toBe('TURNSTILE_FAILED');
      expect((await ask({ 'x-neomoov-client': 'web', 'x-turnstile-token': 'jeton-valide' })).status).toBe(200);
      // Application (ni Origin ni relais du web) : jamais de défi.
      expect((await ask({})).status).toBe(200);
    });

    it('devis publics : défi pour le relais du web au-delà du seuil horaire par adresse, jamais pour un site partenaire qui appelle depuis son serveur', async ({ skip }) => {
      if (!guarded) return skip('DATABASE_URL absente');
      const created = await request(http()).post('/v1/admin/api-keys').set(bearer(admin.tokens)).send({ name: 'Relais de test Q1', scopes: ['public:write'] }).expect(201);
      apiKeyId = created.body.id as string;
      const quote = async (headers: Record<string, string>) => {
        const res = await request(http()).post('/v1/public/quotes').set({ Authorization: `Bearer ${created.body.key}`, 'X-Forwarded-For': IP.quotes, ...headers })
          .send({ origin: PLATEAU, destination: CENTRE, requestedAt: new Date(Date.now() + 3 * 3_600_000).toISOString() });
        if (res.status === 201) quoteIds.push(...(res.body.quotes as Array<{ id: string }>).map((q) => q.id));
        return res;
      };
      // 29 devis déjà comptés pour cette adresse (seuil par défaut : 30 par heure) ; le 30e passe encore.
      const antiBot = guarded.get(AntiBotService);
      for (let i = 0; i < 29; i += 1) await antiBot.record('public_quotes', IP.quotes);
      expect((await quote({ 'x-neomoov-client': 'web' })).status).toBe(201);
      const required = await quote({ 'x-neomoov-client': 'web' });
      expect(required.status).toBe(403);
      expect(required.body.code).toBe('TURNSTILE_REQUIRED');
      expect((await quote({ 'x-neomoov-client': 'web', 'x-turnstile-token': 'jeton-valide' })).status).toBe(201);
      // Serveur d'un site partenaire (sans en-tête de navigateur) : seule la limite par adresse s'applique.
      expect((await quote({})).status).toBe(201);
    });
  });
});
