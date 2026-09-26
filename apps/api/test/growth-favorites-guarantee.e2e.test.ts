import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockPaymentProvider } from '../src/adapters/mock/index.js';
import { PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `fav-${Math.random().toString(36).slice(2, 14)}`;
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000f4f4';
type Tokens = { accessToken: string; user: { id: string } };
interface QuoteBody { id: string; maxConsentedCents: number; totalCents: number; fareCents: number; lines: Array<{ code: string; amountCents: number }>; ignoredOptions: string[] }

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('favoris et garantie modèle (intégration)', () => {
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
    provider.captureFailures = 0;
    provider.nextCard = { brand: 'visa', last4: '4242' };
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  // Chauffeurs de ce fichier : attribués de force, jamais candidats aux réservations des autres fichiers (sans courses
  // planifiées), sauf le temps d'une vérification de disponibilité.
  const ridePayment = async (rideId: string) => (await db(app!).select().from(schema.payments).where(eq(schema.payments.rideId, rideId))).find((p) => p.kind === 'ride');
  const setAcceptsScheduled = (driver: TestDriver, value: boolean) => db(app!).update(schema.drivers).set({ acceptsScheduled: value }).where(eq(schema.drivers.id, driver.driverId));

  function quote(client: Tokens, options: Record<string, unknown> = {}, requestedAt = inThreeHours()) {
    return request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt, options });
  }

  async function quoted(client: Tokens): Promise<QuoteBody> {
    return (await quote(client).expect(201)).body.quotes[0] as QuoteBody;
  }

  function book(client: Tokens, q: QuoteBody, cash = false) {
    return request(server())
      .post('/v1/rides')
      .set(bearer(client))
      .set('Idempotency-Key', key())
      .send({ quoteId: q.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: cash ? 'pay_driver_after' : 'prepaid', paymentMethod: cash ? 'cash' : 'card_app', maxConsentedCents: q.maxConsentedCents });
  }

  /** Course réservée, attribuée par l'opérateur, faite par le chauffeur ; carte capturée ou paiement direct confirmé ; notée si demandé. */
  async function completedRide(client: Tokens, driver: TestDriver, operator: Tokens, options: { score?: number; cash?: boolean } = {}) {
    const q = await quoted(client);
    const ride = (await book(client, q, options.cash).expect(201)).body as { id: string };
    await request(server()).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(operator)).send({ driverId: driver.driverId }).expect(200);
    if (!options.cash) await until(() => ridePayment(ride.id), (p) => p?.status === 'authorized', 'autorisation à l\'attribution');
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(driver.tokens)).expect(200);
    const completion = { measuredDistanceMeters: 8200, measuredDurationSeconds: 1100, ...(options.cash ? { paidDirect: { method: 'cash', amountCents: q.totalCents } } : {}) };
    const done = (await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(driver.tokens)).send(completion).expect(200)).body as { finalPriceCents: number };
    const payment = options.cash ? await ridePayment(ride.id) : await until(() => ridePayment(ride.id), (p) => p?.status === 'captured', 'capture à la fin de course');
    if (options.score) await request(server()).post(`/v1/rides/${ride.id}/rate`).set(bearer(client)).send({ score: options.score, tags: [] }).expect(200);
    return { rideId: ride.id, quote: q, finalPriceCents: done.finalPriceCents, payment: payment! };
  }

  async function reportMismatch(client: Tokens, rideId: string): Promise<string> {
    const res = await request(server()).post(`/v1/rides/${rideId}/report-vehicle-mismatch`).set(bearer(client)).send({ description: 'Le véhicule présenté n\'était pas celui réservé', plateSeen: 'XYZ123', modelSeen: 'Corolla' }).expect(201);
    return res.body.incidentId as string;
  }

  const guarantee = (staff: Tokens, incidentId: string, body: Record<string, unknown>) => request(server()).post(`/v1/admin/incidents/${incidentId}/guarantee`).set(bearer(staff)).send(body);
  const rideRow = async (rideId: string) => (await db(app!).select().from(schema.rides).where(eq(schema.rides.id, rideId)))[0]!;
  const incidentRow = async (incidentId: string) => (await db(app!).select().from(schema.incidents).where(eq(schema.incidents.id, incidentId)))[0]!;
  const notices = (userId: string) => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, 'guarantee.decided')));

  it('favori : refusé sans course notée 4 ou plus, accepté après une course notée 5, listé, retiré, ajout et retrait idempotents', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false, firstName: 'Favorita' });
    const operator = await createStaffAndLogin(app, ['operator']);
    const add = () => request(server()).post(`/v1/me/favorites/${driver.driverId}`).set(bearer(client));

    const none = await add();
    expect(none.status).toBe(409);
    expect(none.body.code).toBe('FAVOURITE_NOT_ELIGIBLE');
    const unknown = await request(server()).post(`/v1/me/favorites/${UNKNOWN_ID}`).set(bearer(client));
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('DRIVER_NOT_FOUND');

    // Une course notée 3 ne suffit pas.
    await completedRide(client, driver, operator.tokens, { score: 3 });
    const low = await add();
    expect(low.status).toBe(409);
    expect(low.body.code).toBe('FAVOURITE_NOT_ELIGIBLE');

    await completedRide(client, driver, operator.tokens, { score: 5 });
    const added = (await add().expect(201)).body;
    expect(added).toMatchObject({
      driverId: driver.driverId, firstName: 'Favorita', ridesTogether: 2, available: false,
      vehicle: { make: 'Tesla', model: 'Model 3', colour: 'blanche', category: 'neo_premium' },
    });
    expect(added.rating).toBeGreaterThan(0);
    const again = (await add().expect(201)).body;
    expect(again.since).toBe(added.since);

    // Les deux tables lues par la répartition sont cohérentes.
    const [client_] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, client.user.id));
    const favourites = await db(app).select().from(schema.favoriteDrivers).where(eq(schema.favoriteDrivers.clientId, client_!.id));
    expect(favourites.map((f) => f.driverId)).toEqual([driver.driverId]);
    const link = () => db(app!).select().from(schema.clientDriverLinks).where(and(eq(schema.clientDriverLinks.clientId, client_!.id), eq(schema.clientDriverLinks.driverId, driver.driverId)));
    expect((await link())[0]!.favoriteSince).not.toBeNull();

    const list = (await request(server()).get('/v1/me/favorites').set(bearer(client)).expect(200)).body;
    expect(list).toEqual([added]);
    // Disponible : actif et acceptant les réservations.
    await setAcceptsScheduled(driver, true);
    try {
      const available = (await request(server()).get('/v1/me/favorites').set(bearer(client)).expect(200)).body;
      expect(available[0].available).toBe(true);
    } finally {
      await setAcceptsScheduled(driver, false);
    }
    // Sans profil client (personnel) : refus explicite.
    const staff = await request(server()).get('/v1/me/favorites').set(bearer(operator.tokens));
    expect(staff.status).toBe(403);
    expect(staff.body.code).toBe('CLIENT_PROFILE_REQUIRED');

    await request(server()).delete(`/v1/me/favorites/${driver.driverId}`).set(bearer(client)).expect(204);
    await request(server()).delete(`/v1/me/favorites/${driver.driverId}`).set(bearer(client)).expect(204);
    expect((await request(server()).get('/v1/me/favorites').set(bearer(client)).expect(200)).body).toEqual([]);
    expect(await db(app).select().from(schema.favoriteDrivers).where(eq(schema.favoriteDrivers.clientId, client_!.id))).toHaveLength(0);
    const [unlinked] = await link();
    expect(unlinked!.favoriteSince).toBeNull();
    expect(unlinked!.ridesCount).toBe(2);
  });

  it('devis : chauffeur qui n\'est pas un favori refusé ; supplément quand le favori est disponible, retiré avec un marqueur sinon', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const favourite = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const stranger = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const [client_] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, client.user.id));
    // Favori posé directement (la règle d'ajout est couverte par le scénario précédent).
    await db(app).insert(schema.favoriteDrivers).values({ clientId: client_!.id, driverId: favourite.driverId });
    await db(app).insert(schema.clientDriverLinks).values({ clientId: client_!.id, driverId: favourite.driverId, favoriteSince: new Date(), ridesCount: 1 });
    const at = inThreeHours();

    const refused = await quote(client, { favouriteDriverId: stranger.driverId }, at);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('FAVOURITE_NOT_ALLOWED');

    const plain = (await quote(client, {}, at).expect(201)).body.quotes[0] as QuoteBody;
    // Favori indisponible (n'accepte pas les réservations) : aucun supplément, option signalée ignorée.
    const unavailable = (await quote(client, { favouriteDriverId: favourite.driverId }, at).expect(201)).body.quotes[0] as QuoteBody;
    expect(unavailable.lines.map((l) => l.code)).not.toContain('favourite_driver');
    expect(unavailable.ignoredOptions).toContain('favouriteDriver');
    expect(unavailable.totalCents).toBe(plain.totalCents);
    const [stored] = await db(app).select({ options: schema.quotes.options, ignored: schema.quotes.ignoredOptions }).from(schema.quotes).where(eq(schema.quotes.id, unavailable.id));
    expect(stored!.ignored).toContain('favouriteDriver');

    await setAcceptsScheduled(favourite, true);
    let available: QuoteBody;
    try {
      available = (await quote(client, { favouriteDriverId: favourite.driverId }, at).expect(201)).body.quotes[0] as QuoteBody;
    } finally {
      await setAcceptsScheduled(favourite, false);
    }
    const surcharge = await app.get(SettingsService).number('pricing.favourite_driver_cents', 300);
    expect(available.lines.find((l) => l.code === 'favourite_driver')?.amountCents).toBe(surcharge);
    expect(available.ignoredOptions).not.toContain('favouriteDriver');
    expect(available.fareCents).toBe(plain.fareCents + surcharge);
    expect(available.totalCents).toBeGreaterThan(plain.totalCents);
  });

  it('garantie validée, chauffeur hors de cause : remboursement intégral sur la carte, tarif du chauffeur maintenu, client prévenu, décision unique', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const operator = await createStaffAndLogin(app, ['operator']);
    const ride = await completedRide(client, driver, operator.tokens);
    expect(ride.payment.capturedCents).toBeGreaterThan(0);
    const incidentId = await reportMismatch(client, ride.rideId);

    const result = (await guarantee(operator.tokens, incidentId, { outcome: 'validated', decision: 'Plaque différente confirmée par la photo du client', driverAtFault: false, refundMode: 'refund' }).expect(200)).body;
    expect(result).toEqual({ incidentId, outcome: 'validated', refundedCents: ride.payment.capturedCents, refundMode: 'refund', driverFareProtected: true, sanctionProposed: false });

    const payment = await ridePayment(ride.rideId);
    expect(payment!.status).toBe('refunded');
    const refunds = await db(app).select().from(schema.refunds).where(eq(schema.refunds.paymentId, payment!.id));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ mode: 'refund', amountCents: ride.payment.capturedCents, decidedByUserId: operator.userId });
    expect(provider.intents.get(payment!.stripePaymentIntentId!)?.refundedCents).toBe(ride.payment.capturedCents);
    expect(await rideRow(ride.rideId)).toMatchObject({ guaranteeOutcome: 'validated', driverFareProtected: true, modelGuaranteeApplied: true });
    expect(await incidentRow(incidentId)).toMatchObject({ status: 'decided', decision: 'Plaque différente confirmée par la photo du client', decidedByUserId: operator.userId });
    // Push et courriel (matrice 5.14) : une seule décision, deux canaux.
    const sent = (await notices(client.user.id)).filter((n) => n.channel === 'push');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ rideId: ride.rideId, incidentId, outcome: 'validated', refundedCents: ride.payment.capturedCents, refundMode: 'refund' });
    const events = await db(app).select({ type: schema.rideEvents.type }).from(schema.rideEvents).where(eq(schema.rideEvents.rideId, ride.rideId));
    expect(events.map((e) => e.type)).toContain('guarantee_decided');

    // Une seconde décision est refusée, sans second remboursement.
    const replay = await guarantee(operator.tokens, incidentId, { outcome: 'validated', decision: 'Deuxième clic', refundMode: 'refund' });
    expect(replay.status).toBe(409);
    expect(replay.body.code).toBe('INCIDENT_ALREADY_DECIDED');
    expect(await db(app).select().from(schema.refunds).where(eq(schema.refunds.paymentId, payment!.id))).toHaveLength(1);
  });

  it('garantie validée, chauffeur en faute, course payée au chauffeur : crédit au client, sanction proposée par une note, jamais appliquée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const operator = await createStaffAndLogin(app, ['operator']);
    const ride = await completedRide(client, driver, operator.tokens, { cash: true });
    expect(ride.payment.status).toBe('paid_direct');
    const incidentId = await reportMismatch(client, ride.rideId);

    // Remboursement demandé sur la carte, mais la course a été payée au chauffeur : crédit.
    const result = (await guarantee(operator.tokens, incidentId, { outcome: 'validated', decision: 'Véhicule d\'une catégorie inférieure, faute du chauffeur', driverAtFault: true, refundMode: 'refund' }).expect(200)).body;
    const expected = Math.min(ride.quote.totalCents, ride.finalPriceCents);
    expect(result).toEqual({ incidentId, outcome: 'validated', refundedCents: expected, refundMode: 'credit', driverFareProtected: false, sanctionProposed: true });

    const credits = await db(app).select().from(schema.credits).where(eq(schema.credits.userId, client.user.id));
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ origin: 'guarantee', amountCents: expected, remainingCents: expected });
    expect(await rideRow(ride.rideId)).toMatchObject({ guaranteeOutcome: 'validated', driverFareProtected: false });
    const notes = await db(app).select().from(schema.staffNotes).where(and(eq(schema.staffNotes.entityType, 'driver'), eq(schema.staffNotes.entityId, driver.driverId)));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toMatch(/^Sanction proposée : /);
    expect(notes[0]!.authorUserId).toBe(operator.userId);
    expect(await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.driverId, driver.driverId))).toHaveLength(0);
    const [driverRow] = await db(app).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
    expect(driverRow!.status).toBe('active');
    // Push et courriel (matrice 5.14), une seule décision.
    expect((await notices(client.user.id)).map((n) => n.channel).sort()).toEqual(['email', 'push']);
  });

  it('garantie refusée : clôture motivée sans remboursement ; incident d\'un autre type refusé ; réservée à l\'exploitation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const operator = await createStaffAndLogin(app, ['operator']);
    const ride = await completedRide(client, driver, operator.tokens);
    const incidentId = await reportMismatch(client, ride.rideId);

    const forbidden = await guarantee(client, incidentId, { outcome: 'rejected', decision: 'Le client ne peut pas trancher' });
    expect(forbidden.status).toBe(403);
    // Une garantie refusée ne met pas le chauffeur en faute.
    const invalid = await guarantee(operator.tokens, incidentId, { outcome: 'rejected', decision: 'Refus incohérent', driverAtFault: true });
    expect(invalid.status).toBe(400);
    expect((await guarantee(operator.tokens, UNKNOWN_ID, { outcome: 'rejected', decision: 'Incident inconnu' })).status).toBe(404);

    const result = (await guarantee(operator.tokens, incidentId, { outcome: 'rejected', decision: 'Véhicule conforme à la catégorie réservée (photo de la plaque)' }).expect(200)).body;
    expect(result).toEqual({ incidentId, outcome: 'rejected', refundedCents: 0, refundMode: null, driverFareProtected: false, sanctionProposed: false });
    const payment = await ridePayment(ride.rideId);
    expect(payment!.status).toBe('captured');
    expect(await db(app).select().from(schema.refunds).where(eq(schema.refunds.paymentId, payment!.id))).toHaveLength(0);
    expect(await rideRow(ride.rideId)).toMatchObject({ guaranteeOutcome: 'rejected', driverFareProtected: false });
    expect(await incidentRow(incidentId)).toMatchObject({ status: 'decided', decision: 'Véhicule conforme à la catégorie réservée (photo de la plaque)' });
    // Push et courriel (matrice 5.14) : une seule décision, deux canaux.
    const sent = (await notices(client.user.id)).filter((n) => n.channel === 'push');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.data).toMatchObject({ outcome: 'rejected', refundedCents: 0 });

    // Un incident d'un autre type ne passe pas par la garantie modèle.
    const [complaint] = await db(app).insert(schema.incidents).values({ rideId: ride.rideId, type: 'complaint', reportedByKind: 'client', reportedByUserId: client.user.id, description: 'Conduite brusque' }).returning({ id: schema.incidents.id });
    const other = await guarantee(operator.tokens, complaint!.id, { outcome: 'validated', decision: 'Hors garantie modèle' });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('NOT_MODEL_GUARANTEE');
    expect(await incidentRow(complaint!.id)).toMatchObject({ status: 'open' });
  });
});
