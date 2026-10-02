import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MockPaymentProvider } from '../src/adapters/mock/index.js';
import { PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { QueueService } from '../src/infra/queue.module.js';
import { DISPATCH_QUEUE, DISPATCH_START_JOB, dispatchStartJobId } from '../src/modules/rides/dispatch-job.js';
import { DispatchService } from '../src/modules/rides/dispatch.service.js';
import { NotificationsOutbox } from '../src/modules/rides/notifications-outbox.js';
import { RidesModule } from '../src/modules/rides/rides.module.js';
import { StuckRidesService } from '../src/modules/rides/stuck-rides.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type CreateDriverOptions, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Revue du code du 2 octobre 2026, agent B (constats 4, 8, 9, 10, 15 et 21 du rapport « logique métier et données ») :
 * démarrage durable de la répartition (tâche `dispatch.start`, balayage du battement), course conservée avec son
 * autorisation quand les suites de la création échouent, réattribution depuis « arrivé », annulation du chauffeur en une
 * seule transaction et rattrapage, course figée visible du chien de garde, promotion rendue sur interruption, relecture
 * d'une transition par un autre acteur refusée. Isolation comme `dispatch.e2e` : courses payées au chauffeur par
 * terminal, seuls les chauffeurs de ce fichier l'acceptent, fin de scénario par `quiesce`.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
/** Environ 300 m de l'origine. */
const NEAR = { lat: 45.5257, lng: -73.582 };
/** Environ 3 km : hors du premier rayon (2 km), dans le deuxième (5 km). */
const FAR = { lat: 45.55, lng: -73.582 };

const key = () => `revue-b-${Math.random().toString(36).slice(2, 14)}`;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface OfferSent {
  offerId: string;
  rideId: string;
  driverId: string;
  wave: number;
}

interface RideBody {
  id: string;
  state: string;
  driver: { id: string } | null;
  dispatch: { status: string; priority: boolean } | null;
}

type Tokens = Awaited<ReturnType<typeof loginByOtp>>;

describe('revue du 2 octobre 2026, agent B : dispatch durable et cycle de vie des courses (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let offBus: (() => void) | null = null;
  const server = () => app!.getHttpServer();
  const dispatch = () => app!.get(DispatchService);
  const sent: OfferSent[] = [];
  const scenarioRides: string[] = [];
  const scenarioDrivers: string[] = [];

  beforeAll(async () => {
    app = await startTestApp({ DISPATCH_MODE: 'auto', DISPATCH_TICK_MS: '0', FEATURE_IMMEDIATE_RIDES: 'on', DATABASE_POOL_MAX: '5' });
    if (!app) return;
    offBus = app.get(DomainEventsService).on('offer.sent', (p) => {
      sent.push({ offerId: p.offerId, rideId: p.rideId, driverId: p.driverId, wave: p.wave });
    });
    admin = await createStaffAndLogin(app, ['admin']);
  });
  afterEach(async () => {
    if (app) await quiesce();
  });
  afterAll(async () => {
    offBus?.();
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  /**
   * Fin de scénario : répartitions arrêtées, offres retirées, courses encore ouvertes closes (le balayage du battement ne
   * doit pas les reprendre au scénario suivant), chauffeurs hors ligne et exclus des scénarios suivants.
   */
  async function quiesce(): Promise<void> {
    const database = db(app!);
    dispatch().enableRunner();
    const rideIds = scenarioRides.splice(0);
    const driverIds = scenarioDrivers.splice(0);
    if (rideIds.length) {
      await database.update(schema.rideDispatches).set({ status: 'cancelled', nextActionAt: null }).where(inArray(schema.rideDispatches.rideId, rideIds));
      await database.update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(inArray(schema.rideOffers.rideId, rideIds), eq(schema.rideOffers.state, 'sent')));
      await database.update(schema.rides).set({ state: 'cancelled_by_client' }).where(and(inArray(schema.rides.id, rideIds), inArray(schema.rides.state, ['requested', 'offering'])));
    }
    if (driverIds.length) {
      await database.delete(schema.driverPresence).where(inArray(schema.driverPresence.driverId, driverIds));
      await database.update(schema.drivers).set({ acceptsTerminal: false }).where(inArray(schema.drivers.id, driverIds));
    }
  }

  async function driver(options: CreateDriverOptions = {}): Promise<TestDriver> {
    const created = await createDriver(app!, 'neo_premium', { acceptsTerminal: true, ...options });
    scenarioDrivers.push(created.driverId);
    return created;
  }

  /** Chauffeur en ligne à cette position. */
  async function online(at: { lat: number; lng: number }): Promise<TestDriver> {
    const created = await driver();
    await request(server()).post('/v1/driver/status').set(bearer(created.tokens)).send({ status: 'online', coordinates: at }).expect(200);
    return created;
  }

  /** Devis puis demande de course immédiate payée au chauffeur par terminal (ou prépayée par carte). */
  async function requestRide(tokens: Tokens, options: { category?: string; prepaidCard?: boolean; requestedAt?: Date } = {}): Promise<RideBody> {
    const quote = (await request(server()).post('/v1/quotes').set(bearer(tokens)).send({ category: options.category ?? 'neo_premium', origin: PLATEAU, destination: CENTRE, ...(options.requestedAt ? { requestedAt: options.requestedAt.toISOString() } : {}) }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const payment = options.prepaidCard ? { paymentMethod: 'card_app', paymentChoice: 'prepaid' } : { paymentMethod: 'terminal', paymentChoice: 'pay_driver_after' };
    const res = await request(server()).post('/v1/rides').set(bearer(tokens)).set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: options.requestedAt ? 'scheduled' : 'immediate', ...(options.requestedAt ? { requestedAt: options.requestedAt.toISOString() } : {}), ...payment, maxConsentedCents: quote.maxConsentedCents });
    if (res.status !== 201) throw new Error(`Demande de course refusée : ${res.status} ${JSON.stringify(res.body)}`);
    const ride = res.body as RideBody;
    scenarioRides.push(ride.id);
    return ride;
  }

  const offersOf = (rideId: string) => sent.filter((o) => o.rideId === rideId);

  async function offerAt(rideId: string, index: number, timeoutMs = 10_000): Promise<OfferSent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const offers = offersOf(rideId);
      if (offers.length > index) return offers[index]!;
      if (Date.now() > deadline) throw new Error(`Offre n° ${index + 1} non envoyée pour ${rideId} en ${timeoutMs} ms (${offers.length} reçues)`);
      await pause(20);
    }
  }

  async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (ok(value)) return value;
      if (Date.now() > deadline) throw new Error(`Délai dépassé : ${what} (${JSON.stringify(value)})`);
      await pause(50);
    }
  }

  async function journal(rideId: string): Promise<Array<{ type: string; fromState: string | null; toState: string; actorKind: string; data: Record<string, unknown> }>> {
    return (await request(server()).get(`/v1/admin/rides/${rideId}/events`).set(bearer(admin.tokens)).expect(200)).body;
  }

  async function rideRow(rideId: string) {
    const [row] = await db(app!).select({ state: schema.rides.state, driverId: schema.rides.driverId, contactAttempts: schema.rides.contactAttempts, promotionId: schema.rides.promotionId }).from(schema.rides).where(eq(schema.rides.id, rideId));
    return row!;
  }

  async function dispatchRow(rideId: string) {
    const [row] = await db(app!).select().from(schema.rideDispatches).where(eq(schema.rideDispatches.rideId, rideId));
    return row ?? null;
  }

  const accept = (d: TestDriver, offerId: string) => request(server()).post(`/v1/driver/offers/${offerId}/accept`).set(bearer(d.tokens));
  const driverStep = (d: TestDriver, rideId: string, step: string) => request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(d.tokens));
  const reassign = (rideId: string, reason: string) => request(server()).post(`/v1/admin/rides/${rideId}/reassign`).set(bearer(admin.tokens)).send({ reason, excludeDriver: true });

  async function notificationsTo(userId: string, template: string, rideId: string) {
    return db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template), sql`${schema.notifications.data}->>'rideId' = ${rideId}`));
  }

  async function audits(action: string, entityId: string) {
    return db(app!).select({ id: schema.auditLog.id }).from(schema.auditLog).where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, entityId)));
  }

  it('constat 4 : réservation sans worker (tâche et événement perdus), puis balayage du battement après 30 s : course proposée, journalisée, pas relancée ensuite', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const queues = app.get(QueueService);
    const before = (await queues.stats()).find((s) => s.name === DISPATCH_QUEUE)!;
    // Aucun processus ne porte la répartition au moment de la réservation.
    dispatch().disableRunner();
    const c = await loginByOtp(app);
    const ride = await requestRide(c);
    expect(ride.state).toBe('requested');
    await pause(400);
    expect(await dispatchRow(ride.id)).toBeNull();
    expect(offersOf(ride.id)).toHaveLength(0);
    const queued = (await journal(ride.id)).filter((e) => e.type === 'dispatch_queued');
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toMatchObject({ jobId: dispatchStartJobId(ride.id) });
    // La tâche a bien été mise en file : en mode mémoire, le traitement refuse de la prendre tant que le processus ne porte pas la répartition.
    const after = (await queues.stats()).find((s) => s.name === DISPATCH_QUEUE)!;
    expect(after.failed - before.failed).toBe(1);

    // Le worker revient : trop tôt, rien ; après 30 s, la course est relancée et proposée au chauffeur en ligne.
    dispatch().enableRunner();
    expect((await dispatch().tick(later(5))).swept).toBe(0);
    expect(offersOf(ride.id)).toHaveLength(0);
    const report = await dispatch().tick(later(31));
    expect(report.swept).toBe(1);
    const first = await offerAt(ride.id, 0);
    expect(first).toMatchObject({ driverId: a.driverId, wave: 1 });
    const started = (await journal(ride.id)).filter((e) => e.type === 'dispatch_started');
    expect(started).toHaveLength(1);
    expect(started[0]!.data).toMatchObject({ reason: 'requested', source: 'sweep', priority: false });
    expect((await dispatchRow(ride.id))?.status).toBe('offering');
    // Un battement de plus ne relance pas une répartition ouverte.
    expect((await dispatch().tick(later(32))).swept).toBe(0);
    expect((await journal(ride.id)).filter((e) => e.type === 'dispatch_started')).toHaveLength(1);
    expect(offersOf(ride.id)).toHaveLength(1);
  });

  it('constat 4 : tâche rejouée (même identifiant) et démarrage rejoué : une seule répartition, aucune offre en double', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const c = await loginByOtp(app);
    const ride = await requestRide(c);
    const first = await offerAt(ride.id, 0);
    expect(first.driverId).toBe(a.driverId);
    await pause(300);
    // L'événement `ride.requested` et la tâche durable sont passés tous les deux : un seul démarrage.
    expect((await journal(ride.id)).filter((e) => e.type === 'dispatch_started')).toHaveLength(1);
    // Rejeu de la tâche (BullMQ la rejouerait après un échec partiel) et du démarrage lui-même.
    await app.get(QueueService).add(DISPATCH_QUEUE, DISPATCH_START_JOB, { rideId: ride.id }, { jobId: dispatchStartJobId(ride.id) });
    expect(await dispatch().ensureStarted(ride.id, 'job')).toBeNull();
    await pause(300);
    expect((await journal(ride.id)).filter((e) => e.type === 'dispatch_started')).toHaveLength(1);
    expect(offersOf(ride.id)).toHaveLength(1);
    const [offer] = await db(app).select({ state: schema.rideOffers.state }).from(schema.rideOffers).where(eq(schema.rideOffers.id, first.offerId));
    expect(offer!.state).toBe('sent');
    expect((await dispatchRow(ride.id))?.offersSent).toBe(1);
  });

  it('constat 8 : les suites de la création échouent (avis) : course conservée, autorisation bancaire conservée, tâche de répartition en file', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Plusieurs modules fournissent la boîte d'envoi : c'est l'instance du module des courses (celle de `RidesService`) qui est en panne.
    const outbox = app.select(RidesModule).get(NotificationsOutbox, { strict: true });
    const original = outbox.queue.bind(outbox);
    const spy = vi.spyOn(outbox, 'queue').mockImplementation(async (messages) => {
      const templates = (Array.isArray(messages) ? messages : [messages]).map((m) => m.template);
      if (templates.includes('ride.requested')) throw new Error('Panne simulée des avis');
      return original(messages);
    });
    try {
      const c = await loginByOtp(app);
      // Catégorie sans chauffeur en ligne : la répartition cherche sans solliciter personne.
      const ride = await requestRide(c, { prepaidCard: true, category: 'neo_xl' });
      expect(ride.state).toBe('requested');
      const [payment] = await db(app).select().from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.kind, 'ride')));
      expect(payment).toMatchObject({ status: 'authorized' });
      expect(payment!.stripePaymentIntentId).toBeTruthy();
      const provider = app.get<MockPaymentProvider>(PAYMENT_PROVIDER);
      expect(provider.intents.get(payment!.stripePaymentIntentId!)?.status).toBe('authorized');
      expect(provider.calls.filter((call) => call.method === 'cancel' && call.args[0] === payment!.stripePaymentIntentId)).toHaveLength(0);
      expect(await notificationsTo(c.user.id, 'ride.requested', ride.id)).toHaveLength(0);
      const types = (await until(() => journal(ride.id), (events) => events.some((e) => e.type === 'dispatch_started'), 'répartition démarrée malgré la panne')).map((e) => e.type);
      expect(types).toEqual(expect.arrayContaining(['client_confirms', 'dispatch_queued', 'dispatch_started']));
      expect((await rideRow(ride.id)).state).toBe('requested');
    } finally {
      spy.mockRestore();
    }
  });

  it('constat 9 : réattribution par l\'opérateur depuis « arrivé » (chauffeur prévenu, sans sanction, tentatives de contact remises à zéro) ; annulation du chauffeur arrivé sanctionnée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await loginByOtp(app);
    const ride = await requestRide(c);
    const offer = await offerAt(ride.id, 0);
    expect(offer.driverId).toBe(a.driverId);
    await accept(a, offer.offerId).expect(200);
    await driverStep(a, ride.id, 'depart').expect(200);
    await driverStep(a, ride.id, 'arrive').expect(200);
    await driverStep(a, ride.id, 'contact').expect(200);
    expect((await rideRow(ride.id)).contactAttempts).toBe(1);

    const reassigned = await reassign(ride.id, 'Client introuvable, le chauffeur repart').expect(200);
    expect(reassigned.body.driver).toBeNull();
    expect(reassigned.body.dispatch).toMatchObject({ status: 'offering', priority: true });
    const toB = await offerAt(ride.id, 1);
    expect(toB.driverId).toBe(b.driverId);
    const events = await journal(ride.id);
    const released = events.find((e) => e.type === 'driver_cancels');
    expect(released).toMatchObject({ fromState: 'arrived', toState: 'cancelled_by_driver', actorKind: 'operator' });
    expect(released!.data).toMatchObject({ source: 'operator', driverId: a.driverId });
    expect(events.map((e) => e.type)).toContain('reassign');
    expect(await rideRow(ride.id)).toMatchObject({ driverId: null, contactAttempts: 0 });
    expect((await dispatchRow(ride.id))?.excludedDriverIds).toContain(a.driverId);
    expect(await notificationsTo(a.userId, 'ride.removed_by_operator', ride.id)).toHaveLength(1);
    expect(await audits('ride.driver_cancellation_after_en_route', a.driverId)).toHaveLength(0);
    expect(await audits('admin.ride_driver_released', ride.id)).toHaveLength(1);
    expect((await request(server()).get('/v1/driver/rides').set(bearer(a.tokens)).expect(200)).body.active).toBeNull();

    // Le chauffeur suivant, arrivé sur place, annule lui-même : accepté, sanctionné comme après « en route », course remise en demande prioritaire.
    await accept(b, toB.offerId).expect(200);
    await driverStep(b, ride.id, 'depart').expect(200);
    await driverStep(b, ride.id, 'arrive').expect(200);
    const cancelled = await driverStep(b, ride.id, 'cancel').send({ reason: 'Client agressif, je repars' }).expect(200);
    expect(cancelled.body.driver).toBeNull();
    expect(['requested', 'offering']).toContain(cancelled.body.state);
    expect(await audits('ride.driver_cancellation_after_en_route', b.driverId)).toHaveLength(1);
    const cancels = (await journal(ride.id)).filter((e) => e.type === 'driver_cancels');
    expect(cancels).toHaveLength(2);
    expect(cancels[1]).toMatchObject({ fromState: 'arrived', actorKind: 'driver' });
    await until(() => dispatchRow(ride.id), (d) => d !== null && (d.excludedDriverIds as string[]).includes(b.driverId), 'chauffeur exclu');
  });

  it('constat 10 : annulation du chauffeur sans worker : une seule transaction (course déjà remise en demande), puis rattrapage par le balayage sans course orpheline', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await loginByOtp(app);
    const ride = await requestRide(c);
    const offer = await offerAt(ride.id, 0);
    await accept(a, offer.offerId).expect(200);
    expect((await dispatchRow(ride.id))?.status).toBe('assigned');
    dispatch().disableRunner();
    const cancelled = await driverStep(a, ride.id, 'cancel').send({ reason: 'Crevaison' }).expect(200);
    expect(cancelled.body).toMatchObject({ state: 'requested', driver: null });
    // Retrait et remise en demande validés ensemble : la course n'est jamais « annulée par le chauffeur » en base.
    expect(await rideRow(ride.id)).toMatchObject({ state: 'requested', driverId: null });
    const types = (await journal(ride.id)).map((e) => e.type);
    expect(types.slice(types.indexOf('driver_cancels'))).toEqual(expect.arrayContaining(['driver_cancels', 'reassign']));
    expect((await app.get(StuckRidesService).find()).find((r) => r.rideId === ride.id)).toBeUndefined();
    // Signal de réattribution perdu (worker absent) : la répartition reste close sur l'attribution passée.
    await pause(300);
    expect((await dispatchRow(ride.id))?.status).toBe('assigned');
    expect(offersOf(ride.id)).toHaveLength(1);

    dispatch().enableRunner();
    const report = await dispatch().tick(later(31));
    expect(report.swept).toBe(1);
    const again = await offerAt(ride.id, 1);
    expect(again.driverId).toBe(b.driverId);
    const row = await dispatchRow(ride.id);
    expect(row).toMatchObject({ status: 'offering', priority: true });
    expect(row!.excludedDriverIds).toContain(a.driverId);
    const started = (await journal(ride.id)).filter((e) => e.type === 'dispatch_started');
    expect(started.at(-1)!.data).toMatchObject({ reason: 'reassign', source: 'sweep', priority: true, excluded: [a.driverId] });
  });

  it('constat 10 : course restée « annulée par le chauffeur » (avant correctif) : vue et signalée par le chien de garde, remise en demande par la réattribution de l\'opérateur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await loginByOtp(app);
    const ride = await requestRide(c);
    await accept(a, (await offerAt(ride.id, 0)).offerId).expect(200);
    const stuckSince = new Date(Date.now() - 5 * 60_000).toISOString();
    await db(app).execute(sql`UPDATE rides SET state = 'cancelled_by_driver', state_timestamps = state_timestamps || ${JSON.stringify({ cancelled_by_driver: stuckSince })}::jsonb WHERE id = ${ride.id}::uuid`);
    const stuck = app.get(StuckRidesService);
    const found = (await stuck.find()).find((r) => r.rideId === ride.id);
    expect(found).toMatchObject({ state: 'cancelled_by_driver' });
    expect(found!.minutes).toBeGreaterThanOrEqual(4);
    await stuck.alert();
    const alerts = (await notificationsTo(admin.userId, 'alert.stuck_ride', ride.id)).filter((n) => (n.data as { state: string }).state === 'cancelled_by_driver');
    expect(alerts).toHaveLength(1);

    const cancelsBefore = (await journal(ride.id)).filter((e) => e.type === 'driver_cancels').length;
    const fixed = await reassign(ride.id, 'Course figée après l\'annulation du chauffeur').expect(200);
    expect(fixed.body.driver).toBeNull();
    expect(fixed.body.dispatch).toMatchObject({ status: 'offering', priority: true });
    expect((await offerAt(ride.id, 1)).driverId).toBe(b.driverId);
    const events = await journal(ride.id);
    expect(events.filter((e) => e.type === 'driver_cancels')).toHaveLength(cancelsBefore);
    expect(events.at(-1)!.type).not.toBe('stuck_alert');
    expect(events.find((e) => e.type === 'reassign')).toMatchObject({ fromState: 'cancelled_by_driver', toState: 'requested' });
    expect((await stuck.find()).find((r) => r.rideId === ride.id)).toBeUndefined();
  });

  it('constat 15 : course interrompue par l\'exploitation : l\'usage de la promotion est rendu (budget et course)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await driver();
    const c = await loginByOtp(app);
    const ride = await requestRide(c, { requestedAt: later(3 * 3600) });
    // La fenêtre d'offres de la planifiée est ouverte avant que le test ne pose lui-même l'état « en cours ».
    await until(() => dispatchRow(ride.id), (d) => d !== null && d.status !== 'searching', 'répartition de la planifiée ouverte');
    const code = `RB${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const [promotion] = await db(app).insert(schema.promotions).values({ code, name: 'Revue B', type: 'percent', value: 1000, conditions: {}, perClientLimit: 1, budgetCents: 100_000, spentCents: 500, validFrom: new Date(Date.now() - 86_400_000) }).returning({ id: schema.promotions.id });
    try {
      const [client] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, c.user.id));
      await db(app).insert(schema.promotionUses).values({ promotionId: promotion!.id, clientId: client!.id, rideId: ride.id, discountCents: 500, driverCompensationCents: 500 });
      await db(app).update(schema.rides).set({ state: 'in_progress', driverId: a.driverId, vehicleId: a.vehicleId, promotionId: promotion!.id, stateTimestamps: { in_progress: new Date().toISOString() } }).where(eq(schema.rides.id, ride.id));
      const done = await request(server()).post(`/v1/admin/rides/${ride.id}/interrupt`).set(bearer(admin.tokens)).send({ reason: 'Chauffeur injoignable', incidentType: 'other' }).expect(200);
      expect(done.body.state).toBe('interrupted');
      await until(() => db(app!).select().from(schema.promotionUses).where(eq(schema.promotionUses.rideId, ride.id)), (uses) => uses.length === 0, 'usage de promotion rendu');
      const [after] = await db(app).select({ spentCents: schema.promotions.spentCents }).from(schema.promotions).where(eq(schema.promotions.id, promotion!.id));
      expect(after!.spentCents).toBe(0);
      expect((await rideRow(ride.id)).promotionId).toBeNull();
    } finally {
      await db(app).delete(schema.promotionUses).where(eq(schema.promotionUses.promotionId, promotion!.id));
      await db(app).delete(schema.promotions).where(eq(schema.promotions.id, promotion!.id));
    }
  });

  it('constat 21 : rejouer une transition est idempotent pour le même acteur seulement ; un autre acteur reçoit 409', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const c = await loginByOtp(app);
    const ride = await requestRide(c, { requestedAt: later(4 * 3600) });
    const cancel = () => request(server()).post(`/v1/rides/${ride.id}/cancel`).set(bearer(c)).send({ reason: 'changed_plans' });
    expect((await cancel().expect(200)).body.state).toBe('cancelled_by_client');
    expect((await cancel().expect(200)).body.state).toBe('cancelled_by_client');
    const byOperator = await request(server()).post(`/v1/admin/rides/${ride.id}/cancel`).set(bearer(admin.tokens)).send({ reason: 'Déjà annulée par le client' });
    expect(byOperator.status).toBe(409);
    expect(byOperator.body.code).toBe('RIDE_INVALID_TRANSITION');
    expect((await journal(ride.id)).filter((e) => e.type === 'client_cancels')).toHaveLength(1);
  });
});
