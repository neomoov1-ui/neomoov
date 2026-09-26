import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { authorizationCents } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockPaymentProvider } from '../src/adapters/mock/index.js';
import { PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `pay-${Math.random().toString(36).slice(2, 14)}`;
type Tokens = { accessToken: string; user: { id: string } };

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('paiements : cartes, autorisation, capture, pourboire, direct, remboursements, webhooks, Connect (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let provider: MockPaymentProvider;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on' });
    if (app) provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  });
  beforeEach(async () => {
    if (!app) return;
    await resetHttpLimits(app);
    provider.captureFailures = 0;
    provider.nextCard = { brand: 'visa', last4: '4242' };
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  // Chauffeurs des paiements : attribués de force, jamais candidats aux réservations (liste limitée des véhicules libres
  // du test de répartition qui tourne en même temps sur la même base).
  const paymentsOf = (rideId: string) => db(app!).select().from(schema.payments).where(eq(schema.payments.rideId, rideId));
  const ridePayment = async (rideId: string) => (await paymentsOf(rideId)).find((p) => p.kind === 'ride' || p.kind === 'cancellation_fee' || p.kind === 'no_show_fee');
  const callsFor = (method: string, match: (args: unknown[]) => boolean) => provider.calls.filter((c) => c.method === method && match(c.args)).length;

  async function quote(client: Tokens, requestedAt: string | null = inThreeHours()) {
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, ...(requestedAt ? { requestedAt } : {}) }).expect(201);
    return { ...(res.body.quotes[0] as { id: string; maxConsentedCents: number; totalCents: number }), paymentMethods: res.body.paymentMethods as string[] };
  }

  function book(client: Tokens, q: { id: string; maxConsentedCents: number }, options: { choice?: 'prepaid' | 'pay_driver_after'; method?: string; immediate?: boolean; idem?: string; requestedAt?: string } = {}) {
    return request(server())
      .post('/v1/rides')
      .set(bearer(client))
      .set('Idempotency-Key', options.idem ?? key())
      .send({
        quoteId: q.id, type: options.immediate ? 'immediate' : 'scheduled', ...(options.immediate ? {} : { requestedAt: options.requestedAt ?? inThreeHours() }), paymentChoice: options.choice ?? 'prepaid',
        paymentMethod: options.method ?? 'card_app', maxConsentedCents: q.maxConsentedCents,
      });
  }

  async function assigned(admin: Tokens, rideId: string, driver: TestDriver) {
    await request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(admin)).send({ driverId: driver.driverId }).expect(200);
  }

  async function drive(driver: TestDriver, rideId: string, completion: Record<string, unknown> = {}) {
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(driver.tokens)).expect(200);
    return (await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100, ...completion }).expect(200)).body as { finalPriceCents: number };
  }

  it('cartes : SetupIntent, confirmation relue chez Stripe (rejouée sans doublon), carte par défaut, retrait, carte exigée pour prépayer', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app, undefined, {}, { card: false });
    expect((await request(server()).get('/v1/payment-methods').set(bearer(client)).expect(200)).body).toEqual([]);
    const q = await quote(client);
    const refused = await book(client, q);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('PAYMENT_METHOD_REQUIRED');

    const setup = (await request(server()).post('/v1/payment-methods/setup-intent').set(bearer(client)).expect(201)).body;
    expect(setup).toMatchObject({ merchantCountry: 'CA', simulated: true, publishableKey: null });
    expect(setup.clientSecret).toContain('_secret');
    const first = (await request(server()).post('/v1/payment-methods/confirm').set(bearer(client)).send({ setupIntentId: setup.setupIntentId }).expect(201)).body;
    const again = (await request(server()).post('/v1/payment-methods/confirm').set(bearer(client)).send({ setupIntentId: setup.setupIntentId }).expect(201)).body;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ brand: 'visa', last4: '4242', isDefault: true });

    provider.nextCard = { brand: 'mastercard', last4: '4444' };
    const setup2 = (await request(server()).post('/v1/payment-methods/setup-intent').set(bearer(client)).expect(201)).body;
    const second = (await request(server()).post('/v1/payment-methods/confirm').set(bearer(client)).send({ setupIntentId: setup2.setupIntentId, makeDefault: true }).expect(201)).body;
    let list = (await request(server()).get('/v1/payment-methods').set(bearer(client)).expect(200)).body as Array<{ id: string; last4: string; isDefault: boolean }>;
    expect(list.map((m) => [m.last4, m.isDefault])).toEqual([['4444', true], ['4242', false]]);

    // Le SetupIntent d'un autre client ne peut pas être rattaché à ce compte.
    const other = await loginByOtp(app, undefined, {}, { card: false });
    const stolen = await request(server()).post('/v1/payment-methods/confirm').set(bearer(other)).send({ setupIntentId: setup.setupIntentId });
    expect(stolen.status).toBe(403);
    expect(stolen.body.code).toBe('SETUP_INTENT_NOT_YOURS');

    await request(server()).delete(`/v1/payment-methods/${second.id}`).set(bearer(client)).expect(204);
    list = (await request(server()).get('/v1/payment-methods').set(bearer(client)).expect(200)).body;
    expect(list.map((m) => [m.last4, m.isDefault])).toEqual([['4242', true]]);
    expect(callsFor('detachPaymentMethod', () => true)).toBeGreaterThan(0);
    expect(q.paymentMethods).toContain('card_app');
  });

  it('carte, course planifiée : autorisation à l\'attribution (prix maximal + 15 %), capture du montant final (rejouée sans doublon), pourboire unique, reçu', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const q = await quote(client);
    const ride = (await book(client, q).expect(201)).body as { id: string };
    let payment = await ridePayment(ride.id);
    expect(payment).toMatchObject({ kind: 'ride', status: 'pending', method: 'card_app' });
    expect(payment!.stripePaymentMethodId).toMatch(/^pm_mock_/);

    await assigned(admin.tokens, ride.id, driver);
    payment = await until(() => ridePayment(ride.id), (p) => p?.status === 'authorized', 'autorisation à l\'attribution');
    expect(payment!.authorizedCents).toBe(authorizationCents(q.maxConsentedCents));

    const done = await drive(driver, ride.id);
    payment = await until(() => ridePayment(ride.id), (p) => p?.status === 'captured', 'capture à la fin de course');
    expect(payment!.capturedCents).toBe(done.finalPriceCents);
    expect(payment!.capturedCents).toBeLessThanOrEqual(payment!.authorizedCents);
    // L'événement rejoué ne capture pas une seconde fois.
    await app.get(PaymentsService).onRideCompleted(ride.id);
    expect(callsFor('capture', (args) => args[0] === payment!.stripePaymentIntentId)).toBe(1);

    const tip1 = await request(server()).post(`/v1/rides/${ride.id}/tip`).set(bearer(client)).send({ amountCents: 500 }).expect(201);
    const tip2 = await request(server()).post(`/v1/rides/${ride.id}/tip`).set(bearer(client)).send({ amountCents: 500 }).expect(201);
    expect(tip2.body.id).toBe(tip1.body.id);
    expect((await paymentsOf(ride.id)).filter((p) => p.kind === 'tip')).toHaveLength(1);
    expect(callsFor('chargeOffSession', (args) => (args[0] as { idempotencyKey: string }).idempotencyKey === `tip:${ride.id}`)).toBe(1);
    const [row] = await db(app).select({ tip: schema.rides.tipCents }).from(schema.rides).where(eq(schema.rides.id, ride.id));
    expect(row!.tip).toBe(500);

    const receipt = (await request(server()).get(`/v1/rides/${ride.id}/payments`).set(bearer(client)).expect(200)).body as Array<{ kind: string; status: string; card: { last4: string } | null; capturedCents: number }>;
    expect(receipt.map((p) => [p.kind, p.status])).toEqual([['ride', 'captured'], ['tip', 'captured']]);
    expect(receipt[0]!.card).toEqual({ brand: 'visa', last4: '4242' });
    const hub = (await request(server()).get(`/v1/admin/rides/${ride.id}/payments`).set(bearer(admin.tokens)).expect(200)).body;
    expect(hub).toHaveLength(2);
  });

  it('course immédiate : carte refusée = aucune course (message clair) ; autorisation levée quand le devis a déjà servi', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    provider.nextCard = { brand: 'visa', last4: '0002', declined: true };
    const declinedClient = await loginByOtp(app);
    provider.nextCard = { brand: 'visa', last4: '4242' };
    const q = await quote(declinedClient, null);
    const refused = await book(declinedClient, q, { immediate: true });
    expect(refused.status).toBe(402);
    expect(refused.body.code).toBe('PAYMENT_DECLINED');
    expect(await db(app).select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.quoteId, q.id))).toHaveLength(0);

    const client = await loginByOtp(app);
    const q2 = await quote(client, null);
    const idem = key();
    const created = await book(client, q2, { immediate: true, idem });
    expect(created.status).toBe(201);
    expect(await ridePayment(created.body.id)).toMatchObject({ status: 'authorized', authorizedCents: authorizationCents(q2.maxConsentedCents) });
    // Même clé : même course, même autorisation (aucune seconde autorisation chez Stripe).
    const replay = await book(client, q2, { immediate: true, idem });
    expect(replay.status).toBe(200);
    expect(callsFor('authorize', (args) => (args[0] as { idempotencyKey: string }).idempotencyKey === `ride-auth:${idem}`)).toBe(1);
    // Autre clé, même devis : l'autorisation créée pour rien est levée.
    const cancelsBefore = callsFor('cancel', () => true);
    const reused = await book(client, q2, { immediate: true });
    expect(reused.status).toBe(409);
    expect(callsFor('cancel', () => true)).toBe(cancelsBefore + 1);
  });

  it('carte refusée à l\'attribution d\'une planifiée : paiement en échec, incident, avis au client', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    provider.nextCard = { brand: 'visa', last4: '0002', declined: true };
    const client = await loginByOtp(app);
    provider.nextCard = { brand: 'visa', last4: '4242' };
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const ride = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, ride.id, driver);
    const failed = await until(() => ridePayment(ride.id), (p) => p?.status === 'failed', 'refus à l\'attribution');
    expect(failed!.failureCode).toBe('card_declined');
    // L'incident et le solde suivent de peu le passage à « failed » (même tâche) : on les attend.
    const incidents = await until(() => db(app!).select().from(schema.incidents).where(and(eq(schema.incidents.rideId, ride.id), eq(schema.incidents.type, 'payment_failed'))), (rows) => rows.length > 0, 'incident payment_failed');
    expect(incidents).toHaveLength(1);
    const notices = await until(() => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, client.user.id), eq(schema.notifications.template, 'payment.authorization_failed'))), (rows) => rows.length > 0, 'avis au client');
    // Matrice 5.14 : un avis par canal (push et courriel) ; un seul par canal.
    expect(notices.filter((n) => n.channel === 'push')).toHaveLength(1);
  });

  it('réservation à plus de 6 jours : autorisation différée à l\'attribution, faite par la reprise quand la prise en charge approche', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const pickup = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const ride = (await book(client, await quote(client, pickup), { requestedAt: pickup }).expect(201)).body as { id: string };
    await assigned(admin.tokens, ride.id, driver);
    const events = await until(
      () => db(app!).select({ type: schema.rideEvents.type }).from(schema.rideEvents).where(eq(schema.rideEvents.rideId, ride.id)),
      (rows) => rows.some((r) => r.type === 'payment_authorization_deferred'),
      'autorisation différée',
    );
    expect(events.map((e) => e.type)).not.toContain('payment_authorized');
    expect(await ridePayment(ride.id)).toMatchObject({ status: 'pending', authorizedCents: 0 });
    // Cinq jours plus tard, la reprise périodique trouve la réservation à moins de 6 jours et l'autorise.
    const authorized = await app.get(PaymentsService).authorizeDueScheduled(new Date(Date.now() + 5 * 86_400_000));
    expect(authorized).toBeGreaterThanOrEqual(1);
    expect(await ridePayment(ride.id)).toMatchObject({ status: 'authorized' });
  });

  it('échec de capture : nouvelle tentative réussie ; deux refus : incident, solde dû, réservations bloquées, règlement idempotent', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);

    const first = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, first.id, driver);
    await until(() => ridePayment(first.id), (p) => p?.status === 'authorized', 'autorisation');
    provider.captureFailures = 1;
    await drive(driver, first.id);
    const retried = await until(() => ridePayment(first.id), (p) => p?.status === 'captured', 'capture à la seconde tentative');
    expect(retried!.attempts).toBe(2);

    const second = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, second.id, driver);
    await until(() => ridePayment(second.id), (p) => p?.status === 'authorized', 'autorisation');
    provider.captureFailures = 2;
    const done = await drive(driver, second.id);
    const failed = await until(() => ridePayment(second.id), (p) => p?.status === 'failed', 'capture en échec');
    expect(failed!.failureCode).toBe('insufficient_funds');
    // L'incident et le solde suivent de peu le passage à « failed » (même tâche) : on les attend.
    const incidents = await until(() => db(app!).select().from(schema.incidents).where(and(eq(schema.incidents.rideId, second.id), eq(schema.incidents.type, 'payment_failed'))), (rows) => rows.length > 0, 'incident payment_failed');
    expect(incidents).toHaveLength(1);

    await until(() => db(app!).select({ balance: schema.clients.balanceDueCents }).from(schema.clients).where(eq(schema.clients.userId, client.user.id)), (rows) => (rows[0]?.balance ?? 0) > 0, 'solde dû');
    const blocked = await book(client, await quote(client));
    expect(blocked.status).toBe(402);
    expect(blocked.body.code).toBe('BALANCE_DUE');
    const balance = (await request(server()).get('/v1/me/balance').set(bearer(client)).expect(200)).body;
    expect(balance).toMatchObject({ balanceDueCents: done.finalPriceCents, rides: [{ rideId: second.id, amountDueCents: done.finalPriceCents }] });

    const settled = (await request(server()).post('/v1/me/settle').set(bearer(client)).send({}).expect(200)).body;
    expect(settled).toEqual({ paidCents: done.finalPriceCents, balanceDueCents: 0 });
    const replay = (await request(server()).post('/v1/me/settle').set(bearer(client)).send({}).expect(200)).body;
    expect(replay).toEqual({ paidCents: 0, balanceDueCents: 0 });
    expect((await paymentsOf(second.id)).filter((p) => p.kind === 'balance')).toHaveLength(1);
    expect((await book(client, await quote(client))).status).toBe(201);
  });

  it('annulation après le départ du chauffeur : frais capturés sur l\'autorisation ; annulation gratuite : autorisation levée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);

    const late = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, late.id, driver);
    await until(() => ridePayment(late.id), (p) => p?.status === 'authorized', 'autorisation');
    await request(server()).post(`/v1/driver/rides/${late.id}/depart`).set(bearer(driver.tokens)).expect(200);
    const cancelled = (await request(server()).post(`/v1/rides/${late.id}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200)).body;
    expect(cancelled.feeCents).toBeGreaterThan(0);
    const fee = await until(() => ridePayment(late.id), (p) => p?.status === 'captured', 'frais capturés');
    expect(fee).toMatchObject({ kind: 'cancellation_fee', capturedCents: cancelled.feeCents });

    const early = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, early.id, driver);
    await until(() => ridePayment(early.id), (p) => p?.status === 'authorized', 'autorisation');
    const free = (await request(server()).post(`/v1/rides/${early.id}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200)).body;
    expect(free.feeCents).toBe(0);
    const released = await until(() => ridePayment(early.id), (p) => p?.status === 'cancelled', 'autorisation levée');
    expect(provider.intents.get(released!.stripePaymentIntentId!)?.status).toBe('canceled');
  });

  it('annulation par le chauffeur : la course réattribuée garde son autorisation et est capturée à la fin', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Revue 17.B : l'annulation du chauffeur levait l'autorisation alors que la course repart en répartition ; le
    // second chauffeur la terminait sans aucune capture (course gratuite).
    const client = await loginByOtp(app);
    const first = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const second = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const ride = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, ride.id, first);
    const authorized = await until(() => ridePayment(ride.id), (p) => p?.status === 'authorized', 'autorisation');
    await request(server()).post(`/v1/driver/rides/${ride.id}/cancel`).set(bearer(first.tokens)).send({ reason: 'Véhicule en panne' }).expect(200);
    // Traitement de l'événement d'annulation (normalement par la file), rendu déterministe pour le test.
    await app.get(PaymentsService).onRideReleased(ride.id, 'cancelled_by_driver');
    expect((await ridePayment(ride.id))?.status).toBe('authorized');
    await assigned(admin.tokens, ride.id, second);
    const done = await drive(second, ride.id);
    const captured = await until(() => ridePayment(ride.id), (p) => p?.status === 'captured', 'capture après réattribution');
    expect(captured!.stripePaymentIntentId).toBe(authorized!.stripePaymentIntentId);
    expect(captured!.capturedCents).toBe(done.finalPriceCents);
  });

  it('paiement direct confirmé par le chauffeur à la fin de course ; un écart ouvre un incident ; refusé pour une course payée par carte', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);

    const cash = (await book(client, await quote(client), { choice: 'pay_driver_after', method: 'cash' }).expect(201)).body as { id: string };
    expect(await paymentsOf(cash.id)).toHaveLength(0);
    await assigned(admin.tokens, cash.id, driver);
    await drive(driver, cash.id, { paidDirect: { method: 'cash', amountCents: 100 } });
    const direct = await ridePayment(cash.id);
    expect(direct).toMatchObject({ status: 'paid_direct', collectedBy: 'driver', driverConfirmedCents: 100, method: 'cash' });
    const gaps = await db(app).select().from(schema.incidents).where(eq(schema.incidents.rideId, cash.id));
    expect(gaps).toHaveLength(1);

    const card = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, card.id, driver);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${card.id}/${step}`).set(bearer(driver.tokens)).expect(200);
    const refused = await request(server()).post(`/v1/driver/rides/${card.id}/complete`).set(bearer(driver.tokens)).send({ paidDirect: { method: 'cash', amountCents: 4_000 } });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('NOT_DIRECT_PAYMENT');

    // Remboursement impossible sur la carte pour un paiement direct : crédit sur le compte du client.
    const onCard = await request(server()).post(`/v1/admin/rides/${cash.id}/refund`).set(bearer(admin.tokens)).send({ amountCents: 50, reason: 'Geste commercial' });
    expect(onCard.status).toBe(409);
    expect(onCard.body.code).toBe('REFUND_CARD_IMPOSSIBLE');
    const credit = (await request(server()).post(`/v1/admin/rides/${cash.id}/refund`).set(bearer(admin.tokens)).send({ amountCents: 50, reason: 'Geste commercial', mode: 'credit' }).expect(201)).body;
    expect(credit).toMatchObject({ mode: 'credit', status: 'succeeded', amountCents: 50 });
    const credits = await db(app).select().from(schema.credits).where(eq(schema.credits.userId, client.user.id));
    expect(credits.map((c) => [c.origin, c.amountCents])).toContainEqual(['refund', 50]);
  });

  it('remboursement sur la carte : plafonné au capturé, idempotent (rejoué deux fois), journalisé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const ride = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(admin.tokens, ride.id, driver);
    await until(() => ridePayment(ride.id), (p) => p?.status === 'authorized', 'autorisation');
    await drive(driver, ride.id);
    const captured = await until(() => ridePayment(ride.id), (p) => p?.status === 'captured', 'capture');

    const idem = key();
    const first = (await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(admin.tokens)).set('Idempotency-Key', idem).send({ amountCents: 1_000, reason: 'Retard de 20 minutes' }).expect(201)).body;
    const again = (await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(admin.tokens)).set('Idempotency-Key', idem).send({ amountCents: 1_000, reason: 'Retard de 20 minutes' }).expect(201)).body;
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ mode: 'refund', status: 'succeeded', amountCents: 1_000 });
    expect(callsFor('refund', () => true)).toBeGreaterThan(0);
    expect(await db(app).select().from(schema.refunds).where(eq(schema.refunds.paymentId, captured!.id))).toHaveLength(1);

    const tooMuch = await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(admin.tokens)).send({ amountCents: captured!.capturedCents, reason: 'Remboursement total' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.code).toBe('REFUND_TOO_HIGH');
    const receipt = (await request(server()).get(`/v1/rides/${ride.id}/payments`).set(bearer(client)).expect(200)).body as Array<{ refundedCents: number }>;
    expect(receipt[0]!.refundedCents).toBe(1_000);
    const forbidden = await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(client)).send({ amountCents: 100, reason: 'Pour moi' });
    expect(forbidden.status).toBe(403);
  });

  it('webhook : signature vérifiée, même événement reçu trois fois = une écriture et un traitement, reprise des échecs', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const q = await quote(client, null);
    const ride = (await book(client, q, { immediate: true }).expect(201)).body as { id: string };
    const payment = await ridePayment(ride.id);
    const event = { id: `evt_test_${key()}`, type: 'payment_intent.succeeded', data: { object: { id: payment!.stripePaymentIntentId, status: 'succeeded', amount_received: 1_234 } } };
    const post = (body: unknown, signature = 'mock-signature') => request(server()).post('/v1/webhooks/stripe').set('stripe-signature', signature).set('content-type', 'application/json').send(JSON.stringify(body));

    const answers = [];
    for (let i = 0; i < 3; i += 1) answers.push((await post(event).expect(200)).body);
    expect(answers).toEqual([{ received: true, duplicate: false }, { received: true, duplicate: true }, { received: true, duplicate: true }]);
    const stored = await db(app).select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, event.id));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: 'processed', attempts: 1, type: 'payment_intent.succeeded' });
    expect(await ridePayment(ride.id)).toMatchObject({ status: 'captured', capturedCents: 1_234 });

    const forged = await post({ ...event, id: `evt_forged_${key()}` }, 't=1,v1=00');
    expect(forged.status).toBe(400);
    expect(forged.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const unknown = { id: `evt_test_${key()}`, type: 'customer.created', data: { object: { id: 'cus_x' } } };
    await post(unknown).expect(200);
    expect((await db(app).select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, unknown.id)))[0]!.status).toBe('ignored');

    // Événement resté en échec (panne pendant son traitement) : repris par la file ou à la demande de My Hub.
    const stuck = { id: `evt_test_${key()}`, type: 'payment_intent.canceled', data: { object: { id: payment!.stripePaymentIntentId } } };
    await db(app).insert(schema.webhookEvents).values({ id: stuck.id, provider: 'mock', type: stuck.type, payload: stuck, status: 'failed', attempts: 1, lastError: 'panne simulée' });
    const finance = await createStaffAndLogin(app, ['finance']);
    const retried = (await request(server()).post('/v1/admin/payments/webhooks/retry').set(bearer(finance.tokens)).expect(200)).body;
    expect(retried.retried).toBeGreaterThanOrEqual(1);
    expect((await db(app).select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, stuck.id)))[0]).toMatchObject({ status: 'processed', attempts: 2 });
  });

  it('chauffeur : compte Connect Express, lien d\'inscription, état, méthode de prélèvement ; webhook account.updated', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const link = (await request(server()).post('/v1/driver/connect/onboarding-link').set(bearer(driver.tokens)).expect(201)).body;
    expect(link.simulated).toBe(true);
    expect(link.url).toContain('simulated=1');
    let status = (await request(server()).get('/v1/driver/connect/status').set(bearer(driver.tokens)).expect(200)).body;
    expect(status).toMatchObject({ linked: true, onboarded: true, payoutsEnabled: true, debitMethod: null, provider: 'mock' });

    const setup = (await request(server()).post('/v1/driver/payment-method').set(bearer(driver.tokens)).expect(201)).body;
    status = (await request(server()).post('/v1/driver/payment-method/confirm').set(bearer(driver.tokens)).send({ setupIntentId: setup.setupIntentId }).expect(200)).body;
    expect(status.debitMethod).toEqual({ brand: 'visa', last4: '4242' });

    const [row] = await db(app).select({ account: schema.drivers.stripeConnectAccountId }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
    const event = { id: `evt_test_${key()}`, type: 'account.updated', data: { object: { id: row!.account, details_submitted: false } } };
    await request(server()).post('/v1/webhooks/stripe').set('stripe-signature', 'mock-signature').set('content-type', 'application/json').send(JSON.stringify(event)).expect(200);
    const [after] = await db(app).select({ onboarded: schema.drivers.stripeConnectOnboarded }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
    expect(after!.onboarded).toBe(false);
  });
});
