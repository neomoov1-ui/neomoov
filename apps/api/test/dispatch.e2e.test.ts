import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DomainEventsService } from '../src/common/domain-events.js';
import { DispatchService } from '../src/modules/rides/dispatch.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, trackUser, type CreateDriverOptions, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Répartition automatique et négociation (prompt 06). Isolation : les autres fichiers tournent en même temps sur la même
 * base, avec des chauffeurs qui n'acceptent pas le terminal ; ici, toutes les courses sont payées au chauffeur par
 * terminal et seuls les chauffeurs de ce fichier l'acceptent. À la fin de chaque scénario, les répartitions sont
 * arrêtées et les chauffeurs retirés (hors ligne, terminal refusé), pour que le battement d'un scénario ne touche pas
 * les courses du précédent.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
/** Environ 300 m de l'origine. */
const NEAR = { lat: 45.5257, lng: -73.582 };
/** Environ 280 m de l'origine, de l'autre côté. */
const NEAR_2 = { lat: 45.5205, lng: -73.5835 };
/** Environ 3 km : hors du premier rayon (2 km), dans le deuxième (5 km). */
const FAR = { lat: 45.55, lng: -73.582 };

const key = () => `dispatch-${Math.random().toString(36).slice(2, 14)}`;
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface OfferSent {
  offerId: string;
  rideId: string;
  driverId: string;
  wave: number;
  type: string;
  expiresAt: Date;
  proposedTotalCents: number | null;
  /** Instant d'envoi (horloge du test). */
  at: number;
}

interface RideBody {
  id: string;
  state: string;
  type: string;
  quote: { totalCents: number; maxConsentedCents: number };
  driver: { id: string } | null;
  finalPriceCents: number | null;
  dispatch: { status: string; mode: string; wave: number; offersSent: number; priority: boolean; heldReason: string | null } | null;
  negotiation: { displayedTotalCents: number; proposedTotalCents: number | null; agreedTotalCents: number | null; endsAt: string | null; openOffers: number } | null;
}

interface DispatchView {
  dispatch: { status: string; mode: string; wave: number; radiusMeters: number | null; offersSent: number; priority: boolean; heldReason: string | null } | null;
  offers: Array<{ id: string; driverId: string; wave: number; type: string; state: string; proposedTotalCents: number | null }>;
}

type Tokens = Awaited<ReturnType<typeof loginByOtp>>;

describe('répartition automatique et négociation (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let offBus: (() => void) | null = null;
  const server = () => app!.getHttpServer();
  const dispatch = () => app!.get(DispatchService);
  /** Toutes les offres envoyées par ce processus, dans l'ordre (bus `offer.sent`). */
  const sent: OfferSent[] = [];
  const scenarioRides: string[] = [];
  const scenarioDrivers: string[] = [];
  /** Instant de création de chaque course (bus `ride.requested`) : le délai de la première offre se mesure depuis là. */
  const requestedAt = new Map<string, number>();

  beforeAll(async () => {
    app = await startTestApp({ DISPATCH_MODE: 'auto', DISPATCH_TICK_MS: '0', FEATURE_IMMEDIATE_RIDES: 'on', FEATURE_NEGOTIATION: 'on', DATABASE_POOL_MAX: '5' });
    if (!app) return;
    const bus = app.get(DomainEventsService);
    const offs = [
      bus.on('offer.sent', (p) => {
        sent.push({ ...p, at: Date.now() });
      }),
      bus.on('ride.requested', (p) => {
        requestedAt.set(p.rideId, Date.now());
      }),
    ];
    offBus = () => offs.forEach((off) => off());
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

  /** Fin de scénario : répartitions arrêtées, offres retirées, chauffeurs hors ligne et exclus des scénarios suivants. */
  async function quiesce(): Promise<void> {
    const database = db(app!);
    const rideIds = scenarioRides.splice(0);
    const driverIds = scenarioDrivers.splice(0);
    if (rideIds.length) {
      await database.update(schema.rideDispatches).set({ status: 'cancelled', nextActionAt: null }).where(inArray(schema.rideDispatches.rideId, rideIds));
      await database.update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(inArray(schema.rideOffers.rideId, rideIds), eq(schema.rideOffers.state, 'sent')));
    }
    if (driverIds.length) {
      await database.delete(schema.driverPresence).where(inArray(schema.driverPresence.driverId, driverIds));
      await database.update(schema.drivers).set({ acceptsTerminal: false }).where(inArray(schema.drivers.id, driverIds));
    }
  }

  /** Chauffeur actif qui accepte le terminal, sans présence (réservations planifiées). */
  async function driver(options: CreateDriverOptions = {}, category: 'neo_premium' | 'neo_prestige' | 'neo_xl' = 'neo_premium'): Promise<TestDriver> {
    const created = await createDriver(app!, category, { acceptsTerminal: true, ...options });
    scenarioDrivers.push(created.driverId);
    return created;
  }

  /** Chauffeur en ligne à cette position. */
  async function online(at: { lat: number; lng: number }, category: 'neo_premium' | 'neo_prestige' | 'neo_xl' = 'neo_premium'): Promise<TestDriver> {
    const created = await driver({}, category);
    await request(server()).post('/v1/driver/status').set(bearer(created.tokens)).send({ status: 'online', coordinates: at }).expect(200);
    return created;
  }

  async function client(group?: 'negotiation' | 'fixed', target = app!): Promise<Tokens> {
    const tokens = await loginByOtp(target);
    if (group) await db(target).update(schema.clients).set({ experimentGroup: group, experimentAssignedAt: new Date() }).where(eq(schema.clients.userId, tokens.user.id));
    return tokens;
  }

  /** Devis puis demande de course payée au chauffeur par terminal ; immédiate sans `requestedAt`. */
  async function requestRide(tokens: Tokens, options: { category?: string; requestedAt?: Date; favouriteDriverId?: string } = {}, target = app!): Promise<RideBody> {
    const quoteBody = {
      category: options.category ?? 'neo_premium', origin: PLATEAU, destination: CENTRE,
      ...(options.requestedAt ? { requestedAt: options.requestedAt.toISOString() } : {}),
      ...(options.favouriteDriverId ? { options: { favouriteDriverId: options.favouriteDriverId } } : {}),
    };
    const quote = (await request(target.getHttpServer()).post('/v1/quotes').set(bearer(tokens)).send(quoteBody).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const res = await request(target.getHttpServer())
      .post('/v1/rides')
      .set(bearer(tokens))
      .set('Idempotency-Key', key())
      .send({
        quoteId: quote.id, type: options.requestedAt ? 'scheduled' : 'immediate', ...(options.requestedAt ? { requestedAt: options.requestedAt.toISOString() } : {}),
        paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents,
      });
    if (res.status !== 201) throw new Error(`Demande de course refusée : ${res.status} ${JSON.stringify(res.body)}`);
    const ride = res.body as RideBody;
    scenarioRides.push(ride.id);
    return ride;
  }

  const offersOf = (rideId: string) => sent.filter((o) => o.rideId === rideId);

  /** Offre n° `index` (à partir de 0) envoyée pour cette course ; la répartition démarre de façon asynchrone après la demande. */
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

  async function dispatchView(rideId: string): Promise<DispatchView> {
    return (await request(server()).get(`/v1/admin/rides/${rideId}/dispatch`).set(bearer(admin.tokens)).expect(200)).body as DispatchView;
  }

  /** Vue My Hub une fois l'état enregistré après les offres déjà publiées (l'offre part avant l'écriture de la répartition). */
  async function settledView(rideId: string): Promise<DispatchView> {
    return until(() => dispatchView(rideId), (v) => v.dispatch !== null && v.dispatch.offersSent === offersOf(rideId).length && v.dispatch.status !== 'searching', 'répartition enregistrée');
  }

  async function journal(rideId: string): Promise<Array<{ type: string; data: Record<string, unknown> }>> {
    return (await request(server()).get(`/v1/admin/rides/${rideId}/events`).set(bearer(admin.tokens)).expect(200)).body;
  }

  async function rideOf(rideId: string, tokens: Tokens): Promise<RideBody> {
    return (await request(server()).get(`/v1/rides/${rideId}`).set(bearer(tokens)).expect(200)).body as RideBody;
  }

  const accept = (d: TestDriver, offerId: string) => request(server()).post(`/v1/driver/offers/${offerId}/accept`).set(bearer(d.tokens));

  async function notificationsTo(userId: string, template: string, rideId: string) {
    return db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template), sql`${schema.notifications.data}->>'rideId' = ${rideId}`));
  }

  it('course immédiate : première offre en moins de 3 s au plus proche, refus puis rayon suivant, expiration puis « aucun chauffeur »', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await client();
    const ride = await requestRide(c);
    expect(ride.state).toBe('requested');
    const first = await offerAt(ride.id, 0);
    expect(first.at - requestedAt.get(ride.id)!).toBeLessThan(3000);
    expect(first).toMatchObject({ driverId: a.driverId, wave: 1, type: 'fixed', proposedTotalCents: null });
    // Offres séquentielles : une seule à la fois.
    await pause(200);
    expect(offersOf(ride.id)).toHaveLength(1);

    const listA = await request(server()).get('/v1/driver/offers').set(bearer(a.tokens)).expect(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0]).toMatchObject({ id: first.offerId, rideId: ride.id, type: 'fixed', state: 'sent', proposedTotalCents: null, displayedTotalCents: null, ride: { id: ride.id, paymentMethod: 'terminal' } });
    expect(listA.body[0].pickupSeconds).toBeGreaterThan(0);
    expect((await request(server()).get('/v1/driver/offers').set(bearer(b.tokens)).expect(200)).body).toHaveLength(0);
    expect((await accept(b, first.offerId)).status).toBe(404);

    // Refus : B, dans le deuxième rayon, est sollicité tout de suite.
    await request(server()).post(`/v1/driver/offers/${first.offerId}/decline`).set(bearer(a.tokens)).expect(200);
    const second = await offerAt(ride.id, 1);
    expect(second).toMatchObject({ driverId: b.driverId, wave: 2 });
    const view = await settledView(ride.id);
    expect(view.dispatch).toMatchObject({ status: 'offering', mode: 'fixed', wave: 2, radiusMeters: 5000, offersSent: 2, priority: false });
    expect(view.offers.map((o) => o.state)).toEqual(['declined', 'sent']);
    const clientView = await rideOf(ride.id, c);
    expect(clientView.state).toBe('offering');
    expect(clientView.dispatch).toMatchObject({ status: 'offering', wave: 2 });

    // B ne répond pas : l'offre expire, la zone est épuisée, la course passe en « aucun chauffeur ».
    const report = await request(server()).post('/v1/admin/rides/dispatch/tick').set(bearer(admin.tokens)).send({ now: later(16).toISOString() }).expect(200);
    expect(report.body.expiredOffers).toBeGreaterThanOrEqual(1);
    const exhausted = await dispatchView(ride.id);
    expect(exhausted.dispatch?.status).toBe('exhausted');
    expect(exhausted.offers.map((o) => o.state)).toEqual(['declined', 'expired']);
    expect((await rideOf(ride.id, c)).state).toBe('no_driver');
    const late = await accept(b, second.offerId);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('OFFER_EXPIRED');
    expect(await notificationsTo(c.user.id, 'ride.no_driver', ride.id)).toHaveLength(1);
    expect(await notificationsTo(admin.userId, 'alert.no_driver', ride.id)).toHaveLength(1);
    const types = (await journal(ride.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['dispatch_started', 'dispatch_wave', 'offer_sent', 'offer_declined', 'offer_expired', 'no_driver_found']));
  });

  it('attribution forcée par l\'opérateur pendant une offre : l\'acceptation du chauffeur arrive trop tard (409), la répartition est close', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await client();
    const ride = await requestRide(c);
    const offer = await offerAt(ride.id, 0);
    expect(offer.driverId).toBe(a.driverId);
    const forced = await request(server()).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(admin.tokens)).send({ driverId: b.driverId }).expect(200);
    expect(forced.body.driver.id).toBe(b.driverId);
    const late = await accept(a, offer.offerId);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('OFFER_EXPIRED');
    const view = await until(() => dispatchView(ride.id), (v) => v.dispatch?.status === 'assigned', 'répartition close');
    expect(view.offers).toEqual([expect.objectContaining({ driverId: a.driverId, state: 'expired' })]);
    expect((await rideOf(ride.id, c)).driver?.id).toBe(b.driverId);
    // Aucun journal d'acceptation pour l'offre perdue.
    expect((await journal(ride.id)).filter((e) => e.type === 'offer_accepted')).toHaveLength(0);
  });

  it('annulation par le chauffeur : nouvelle recherche prioritaire, le chauffeur qui annule est exclu', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await client();
    const ride = await requestRide(c);
    const offer = await offerAt(ride.id, 0);
    expect(offer.driverId).toBe(a.driverId);
    const accepted = await accept(a, offer.offerId).expect(200);
    expect(accepted.body).toMatchObject({ state: 'assigned', driver: { id: a.driverId } });
    expect((await dispatchView(ride.id)).dispatch?.status).toBe('assigned');
    // Deux acceptations de la même offre : la seconde est refusée.
    expect((await accept(a, offer.offerId)).status).toBe(409);

    await request(server()).post(`/v1/driver/rides/${ride.id}/cancel`).set(bearer(a.tokens)).send({ reason: 'Crevaison sur l\'autoroute' }).expect(200);
    const again = await offerAt(ride.id, 1);
    expect(again.driverId).toBe(b.driverId);
    const view = await settledView(ride.id);
    expect(view.dispatch).toMatchObject({ status: 'offering', priority: true });
    expect(view.offers.filter((o) => o.driverId === a.driverId)).toHaveLength(1);
    const [row] = await db(app).select().from(schema.rideDispatches).where(eq(schema.rideDispatches.rideId, ride.id));
    expect(row!.excludedDriverIds).toContain(a.driverId);
    const started = (await journal(ride.id)).filter((e) => e.type === 'dispatch_started');
    expect(started.at(-1)!.data).toMatchObject({ reason: 'reassign', priority: true });
  });

  it('surveillance du départ : chauffeur immobile 3 minutes après l\'attribution retiré sans sanction et remplacé ; un chauffeur qui roule est gardé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await client();
    const ride = await requestRide(c);
    const offer = await offerAt(ride.id, 0);
    await accept(a, offer.offerId).expect(200);
    // Avant 3 minutes : rien.
    await dispatch().tick(later(60));
    expect((await rideOf(ride.id, c)).driver?.id).toBe(a.driverId);
    const report = await dispatch().tick(later(181));
    expect(report.noMovement).toBeGreaterThanOrEqual(1);
    const next = await offerAt(ride.id, 1);
    expect(next.driverId).toBe(b.driverId);
    expect((await rideOf(ride.id, c)).driver).toBeNull();
    expect((await journal(ride.id)).map((e) => e.type)).toContain('no_movement_reassign');
    expect(await notificationsTo(a.userId, 'ride.removed_no_movement', ride.id)).toHaveLength(1);
    expect(await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.driverId, a.driverId))).toHaveLength(0);

    // B accepte et roule 300 m : il est gardé.
    await accept(b, next.offerId).expect(200);
    await request(server()).post('/v1/driver/location').set(bearer(b.tokens)).send({ coordinates: { lat: FAR.lat - 0.0027, lng: FAR.lng } }).expect(200);
    await dispatch().tick(later(181));
    expect((await rideOf(ride.id, c)).driver?.id).toBe(b.driverId);
    const [row] = await db(app).select().from(schema.rideDispatches).where(eq(schema.rideDispatches.rideId, ride.id));
    expect(row!.movementCheckedAt).not.toBeNull();
  });

  it('panneau opérateur : mise en attente (offres retirées, aucune relance), reprise, réattribution avec exclusion', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const b = await online(FAR);
    const c = await client();
    const ride = await requestRide(c);
    const offer = await offerAt(ride.id, 0);
    const held = await request(server()).post(`/v1/admin/rides/${ride.id}/hold`).set(bearer(admin.tokens)).send({ reason: 'Vérification du client' }).expect(200);
    expect(held.body.state).toBe('requested');
    expect(held.body.dispatch).toMatchObject({ status: 'held', heldReason: 'Vérification du client' });
    expect((await accept(a, offer.offerId)).status).toBe(409);
    await dispatch().tick(later(60));
    expect(offersOf(ride.id)).toHaveLength(1);
    expect((await request(server()).post(`/v1/admin/rides/${ride.id}/hold`).set(bearer(admin.tokens)).send({ reason: 'Encore' })).status).toBe(200);

    const released = await request(server()).post(`/v1/admin/rides/${ride.id}/release`).set(bearer(admin.tokens)).expect(200);
    expect(released.body.dispatch.status).toBe('offering');
    const resumed = await offerAt(ride.id, 1);
    expect(resumed.driverId).toBe(a.driverId);
    const notHeld = await request(server()).post(`/v1/admin/rides/${ride.id}/release`).set(bearer(admin.tokens));
    expect(notHeld.status).toBe(409);
    expect(notHeld.body.code).toBe('RIDE_NOT_HELD');

    await accept(a, resumed.offerId).expect(200);
    const reassigned = await request(server()).post(`/v1/admin/rides/${ride.id}/reassign`).set(bearer(admin.tokens)).send({ reason: 'Client injoignable par le chauffeur', excludeDriver: true }).expect(200);
    expect(reassigned.body.driver).toBeNull();
    expect(reassigned.body.dispatch).toMatchObject({ status: 'offering', priority: true });
    const toB = await offerAt(ride.id, 2);
    expect(toB.driverId).toBe(b.driverId);
    const types = (await journal(ride.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['dispatch_held', 'dispatch_released', 'reassign']));
    // Retrait par l'opérateur : pas de sanction.
    expect(await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.driverId, a.driverId))).toHaveLength(0);
    // Le chauffeur n'accède pas au panneau.
    expect((await request(server()).post(`/v1/admin/rides/${ride.id}/hold`).set(bearer(a.tokens)).send({ reason: 'Essai' })).status).toBe(403);
  });

  it('chauffeur restreint (5.11) : écarté d\'une course VIP même au plus près, sollicité pour une course ordinaire', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const restricted = await online(NEAR_2, 'neo_prestige');
    await db(app).update(schema.drivers).set({ status: 'restricted' }).where(eq(schema.drivers.id, restricted.driverId));
    const control = await online(NEAR, 'neo_prestige');
    const c = await client();
    // Course Neo Prestige (VIP) : le chauffeur restreint, le plus proche, n'est pas sollicité ; l'autre l'est.
    const vip = await requestRide(c, { category: 'neo_prestige' });
    expect(await offerAt(vip.id, 0)).toMatchObject({ driverId: control.driverId, wave: 1 });
    await pause(300);
    expect(offersOf(vip.id).map((o) => o.driverId)).not.toContain(restricted.driverId);
    // Course Neo Premium ordinaire (ni aéroport, ni entreprise) : le chauffeur restreint reste candidat.
    const ordinary = await requestRide(await client(), { category: 'neo_premium' });
    const offer = await offerAt(ordinary.id, 0);
    expect(offer).toMatchObject({ driverId: restricted.driverId, wave: 1 });
    // Il peut l'accepter ; l'opérateur, lui, ne peut pas lui attribuer la course VIP.
    expect((await accept(restricted, offer.offerId).expect(200)).body.driver.id).toBe(restricted.driverId);
    const forced = await request(server()).post(`/v1/admin/rides/${vip.id}/assign`).set(bearer(admin.tokens)).send({ driverId: restricted.driverId });
    expect(forced.status).toBe(409);
    expect(forced.body.code).toBe('DRIVER_RESTRICTED');
  });

  it('enchaînement (5.4) : un chauffeur en course est sollicité seulement si sa course se termine à moins de 5 minutes de l\'origine', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await online(NEAR);
    const first = await requestRide(await client());
    await accept(a, (await offerAt(first.id, 0)).offerId).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${first.id}/${step}`).set(bearer(a.tokens)).expect(200);
    // Destination de la course en cours (centre-ville) à environ 2,8 km de l'origine suivante : au-delà de 300 s à 8 m/s.
    const next = await requestRide(await client());
    await until(() => dispatchView(next.id), (v) => (v.dispatch?.wave ?? 0) >= 1, 'première vague');
    await pause(300);
    expect(offersOf(next.id)).toHaveLength(0);
    // La course en cours finit tout près de l'origine suivante : offre d'enchaînement au chauffeur encore en course.
    await db(app).execute(sql`UPDATE rides SET destination_position = ST_SetSRID(ST_MakePoint(${NEAR_2.lng}::float, ${NEAR_2.lat}::float), 4326)::geography WHERE id = ${first.id}::uuid`);
    await dispatch().tick(later(21));
    expect(await offerAt(next.id, 0)).toMatchObject({ driverId: a.driverId });
    expect((await rideOf(first.id, a.tokens)).state).toBe('in_progress');
  });

  it('aucun candidat : trois balayages complets de la zone, puis « aucun chauffeur »', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Catégorie inférieure : jamais candidat pour une course Neo XL.
    await online(NEAR, 'neo_premium');
    const c = await client();
    const ride = await requestRide(c, { category: 'neo_xl' });
    const first = await until(() => dispatchView(ride.id), (v) => v.dispatch?.wave === 4, 'premier balayage');
    expect(first.dispatch).toMatchObject({ status: 'searching', offersSent: 0 });
    await dispatch().tick(later(21));
    expect((await dispatchView(ride.id)).dispatch).toMatchObject({ status: 'searching', wave: 8 });
    await dispatch().tick(later(42));
    const view = await dispatchView(ride.id);
    expect(view.dispatch?.status).toBe('exhausted');
    expect(view.offers).toHaveLength(0);
    expect((await journal(ride.id)).filter((e) => e.type === 'dispatch_wave')).toHaveLength(12);
    expect((await rideOf(ride.id, c)).state).toBe('no_driver');
    expect(offersOf(ride.id)).toHaveLength(0);
  });

  it('réservation planifiée : favori seul pendant 120 s, puis les disponibles du créneau (conflit de ±90 min exclu) ; fenêtre close puis relance', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const pickup = later(3 * 3600);
    // H a déjà une réservation 30 minutes plus tard : il n'est pas candidat.
    const h = await driver();
    const other = await client();
    const busy = await requestRide(other, { requestedAt: new Date(pickup.getTime() + 30 * 60_000) });
    expect(busy.type).toBe('scheduled');
    const busyOffer = await offerAt(busy.id, 0);
    expect(busyOffer.driverId).toBe(h.driverId);
    await accept(h, busyOffer.offerId).expect(200);
    // Réservation planifiée attribuée : pas de surveillance du départ.
    const [busyDispatch] = await db(app).select().from(schema.rideDispatches).where(eq(schema.rideDispatches.rideId, busy.id));
    expect(busyDispatch).toMatchObject({ status: 'assigned', nextActionAt: null });
    expect(busyDispatch!.movementCheckedAt).not.toBeNull();

    const f = await driver({ firstName: 'Favori' });
    const g = await driver();
    const c = await client();
    const [clientRow] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, c.user.id));
    await db(app).insert(schema.favoriteDrivers).values({ clientId: clientRow!.id, driverId: f.driverId });
    const ride = await requestRide(c, { requestedAt: pickup, favouriteDriverId: f.driverId });
    const favOffer = await offerAt(ride.id, 0);
    expect(favOffer).toMatchObject({ driverId: f.driverId, type: 'fixed', wave: 1 });
    const exclusiveMs = new Date(favOffer.expiresAt).getTime() - Date.now();
    expect(exclusiveMs).toBeGreaterThan(100_000);
    expect(exclusiveMs).toBeLessThanOrEqual(120_000);
    await pause(200);
    expect(offersOf(ride.id)).toHaveLength(1);
    const listF = await request(server()).get('/v1/driver/offers').set(bearer(f.tokens)).expect(200);
    expect(listF.body[0]).toMatchObject({ rideId: ride.id, isFavourite: true, ride: { type: 'scheduled' } });

    // 121 s : le favori n'a pas répondu, les autres disponibles reçoivent l'offre jusqu'à la fin de la fenêtre.
    await dispatch().tick(later(121));
    const others = offersOf(ride.id).slice(1);
    expect(others.map((o) => o.driverId)).toEqual([g.driverId]);
    expect(new Date(others[0]!.expiresAt).getTime()).toBeGreaterThan(Date.now() + 400_000);
    const confirmed = await accept(g, others[0]!.offerId).expect(200);
    expect(confirmed.body).toMatchObject({ state: 'assigned', driver: { id: g.driverId } });
    expect((await dispatchView(ride.id)).dispatch?.status).toBe('assigned');
    // D37 : le client est prévenu que son favori n'a pas la course, et le supplément « chauffeur favori » n'est pas facturé.
    expect(await notificationsTo(c.user.id, 'ride.favourite_unavailable', ride.id)).toHaveLength(1);
    expect((await journal(ride.id)).filter((e) => e.type === 'favourite_unavailable')).toHaveLength(1);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(g.tokens)).expect(200);
    const done = await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(g.tokens)).send({ measuredDistanceMeters: 4200, measuredDurationSeconds: 700 }).expect(200);
    const [quoteRow] = await db(app).select({ lines: schema.quotes.lines }).from(schema.quotes).innerJoin(schema.rides, eq(schema.rides.quoteId, schema.quotes.id)).where(eq(schema.rides.id, ride.id));
    const fee = (quoteRow!.lines as Array<{ code: string; amountCents: number }>).find((l) => l.code === 'favourite_driver')?.amountCents ?? 0;
    expect(fee).toBeGreaterThan(0);
    const saved = ride.quote.totalCents - (done.body.finalPriceCents as number);
    expect(saved).toBeGreaterThanOrEqual(fee);
    expect(saved).toBeLessThanOrEqual(Math.ceil(fee * 1.15) + 1);

    // Sans réponse pendant 10 minutes, la fenêtre se ferme ; le signal de 60 minutes avant rouvre une fenêtre.
    const c2 = await client();
    const lone = await requestRide(c2, { requestedAt: later(6 * 3600) });
    const broadcast = await until(async () => offersOf(lone.id), (o) => o.length === 3, 'diffusion aux trois chauffeurs');
    expect(broadcast.map((o) => o.driverId).sort()).toEqual([f.driverId, g.driverId, h.driverId].sort());
    await dispatch().tick(later(601));
    const closed = await dispatchView(lone.id);
    expect(closed.dispatch?.status).toBe('window_closed');
    expect(closed.offers.every((o) => o.state === 'expired')).toBe(true);
    expect((await rideOf(lone.id, c2)).state).toBe('requested');
    expect((await journal(lone.id)).map((e) => e.type)).toContain('offer_window_closed');
    const reopened = await dispatch().start(lone.id, { reason: 'scheduled_due' });
    expect(reopened?.status).toBe('offering');
    expect(offersOf(lone.id)).toHaveLength(6);
  });

  it('sélection précise du véhicule (D37) : liste des véhicules libres sur le créneau, chauffeur choisi sollicité seul d\'abord, puis la catégorie', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const premium = await driver({ firstName: 'Premium' }, 'neo_premium');
    const prestige = await driver({ firstName: 'Prestige' }, 'neo_prestige');
    // La liste est limitée (`dispatch.scheduled_candidates_max`) et triée par note puis nombre de courses : les autres
    // fichiers de tests créent des chauffeurs en même temps sur la même base ; ceux-ci passent devant à note égale.
    await db(app).update(schema.drivers).set({ rideCount: 1_000_000 }).where(inArray(schema.drivers.id, [premium.driverId, prestige.driverId]));
    const c = await client();
    const pickup = later(4 * 3600);
    const quote = (await request(server()).post('/v1/quotes').set(bearer(c)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: pickup.toISOString() }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const listed = await request(server()).get(`/v1/quotes/${quote.id}/vehicles`).set(bearer(c)).expect(200);
    const mine = (listed.body as Array<{ vehicleId: string; category: string; driver: { id: string; firstName: string }; paymentMethods: string[]; photoUrl: string | null }>).filter((v) => [premium.vehicleId, prestige.vehicleId].includes(v.vehicleId));
    expect(mine.map((v) => v.vehicleId).sort()).toEqual([premium.vehicleId, prestige.vehicleId].sort());
    expect(mine.find((v) => v.vehicleId === prestige.vehicleId)).toMatchObject({ category: 'neo_prestige', driver: { id: prestige.driverId, firstName: 'Prestige' }, photoUrl: null });
    expect(mine[0]!.paymentMethods).toEqual(expect.arrayContaining(['cash', 'terminal']));
    // Un autre client ne lit pas ce devis.
    const stranger = await client();
    expect((await request(server()).get(`/v1/quotes/${quote.id}/vehicles`).set(bearer(stranger))).status).toBe(403);
    // Garantie modèle : un véhicule de catégorie inférieure est refusé pour un devis Neo Prestige.
    const prestigeQuote = (await request(server()).post('/v1/quotes').set(bearer(c)).send({ category: 'neo_prestige', origin: PLATEAU, destination: CENTRE, requestedAt: pickup.toISOString() }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const tooLow = await request(server()).post('/v1/rides').set(bearer(c)).set('Idempotency-Key', key()).send({ quoteId: prestigeQuote.id, type: 'scheduled', requestedAt: pickup.toISOString(), paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: prestigeQuote.maxConsentedCents, vehicleId: premium.vehicleId });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.code).toBe('VEHICLE_CATEGORY_TOO_LOW');
    const unknown = await request(server()).post('/v1/rides').set(bearer(c)).set('Idempotency-Key', key()).send({ quoteId: prestigeQuote.id, type: 'scheduled', requestedAt: pickup.toISOString(), paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: prestigeQuote.maxConsentedCents, vehicleId: '00000000-0000-4000-8000-000000000001' });
    expect(unknown.body.code).toBe('VEHICLE_NOT_AVAILABLE');

    // Le client choisit le véhicule Neo Prestige pour sa réservation Neo Premium : son chauffeur reçoit l'offre seul.
    const created = await request(server()).post('/v1/rides').set(bearer(c)).set('Idempotency-Key', key()).send({ quoteId: quote.id, type: 'scheduled', requestedAt: pickup.toISOString(), paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents, vehicleId: prestige.vehicleId }).expect(201);
    const ride = created.body as RideBody;
    scenarioRides.push(ride.id);
    const chosen = await offerAt(ride.id, 0);
    expect(chosen.driverId).toBe(prestige.driverId);
    await pause(200);
    expect(offersOf(ride.id)).toHaveLength(1);
    const [row] = await db(app).select({ options: schema.rides.options }).from(schema.rides).where(eq(schema.rides.id, ride.id));
    expect(row!.options).toMatchObject({ requestedVehicleId: prestige.vehicleId, requestedDriverId: prestige.driverId });
    // Refus : la catégorie prend le relais ; le client n'est prévenu qu'à l'attribution à un autre chauffeur.
    await request(server()).post(`/v1/driver/offers/${chosen.offerId}/decline`).set(bearer(prestige.tokens)).expect(200);
    await dispatch().tick(later(121));
    const fallback = offersOf(ride.id).slice(1).find((o) => o.driverId === premium.driverId);
    expect(fallback).toBeDefined();
    expect(await notificationsTo(c.user.id, 'ride.vehicle_unavailable', ride.id)).toHaveLength(0);
    await accept(premium, fallback!.offerId).expect(200);
    expect(await notificationsTo(c.user.id, 'ride.vehicle_unavailable', ride.id)).toHaveLength(1);
    expect(await notificationsTo(c.user.id, 'ride.favourite_unavailable', ride.id)).toHaveLength(0);
    // Course immédiate : pas de choix de véhicule.
    const immediate = (await request(server()).post('/v1/quotes').set(bearer(c)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE }).expect(201)).body.quotes[0] as { id: string };
    expect((await request(server()).get(`/v1/quotes/${immediate.id}/vehicles`).set(bearer(c)).expect(200)).body).toEqual([]);
    const immediateQuote = (await request(server()).post('/v1/quotes').set(bearer(c)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const refused = await request(server()).post('/v1/rides').set(bearer(c)).set('Idempotency-Key', key()).send({ quoteId: immediateQuote.id, type: 'immediate', paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: immediateQuote.maxConsentedCents, vehicleId: premium.vehicleId });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('VEHICLE_CHOICE_SCHEDULED_ONLY');
  });

  it('négociation : proposition bornée au plancher de 70 %, contre-offres encadrées, acceptation du client, prix final = prix convenu ; signalement du véhicule', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const n1 = await online(NEAR);
    const n2 = await online(NEAR_2);
    const c = await client('negotiation');
    const ride = await requestRide(c);
    const fixedOffer = await offerAt(ride.id, 0);
    expect(fixedOffer.type).toBe('fixed');
    const displayed = ride.negotiation!.displayedTotalCents;
    expect(displayed).toBe(ride.quote.totalCents);
    const floor = Math.min(displayed, Math.ceil((displayed * 0.7) / 100) * 100);

    const proposed = await request(server()).post(`/v1/rides/${ride.id}/proposals`).set(bearer(c)).send({ proposedTotalCents: 100 }).expect(200);
    expect(proposed.body.negotiation).toMatchObject({ displayedTotalCents: displayed, proposedTotalCents: floor, agreedTotalCents: null, openOffers: 0 });
    expect(proposed.body.negotiation.endsAt).not.toBeNull();
    expect(proposed.body.dispatch).toMatchObject({ mode: 'negotiation', status: 'offering' });
    const pPrime = floor;
    // La proposition part aux deux chauffeurs en même temps ; l'offre au prix affiché est retirée.
    const proposals = offersOf(ride.id).filter((o) => o.type === 'client_proposal');
    expect(proposals.map((o) => o.driverId).sort()).toEqual([n1.driverId, n2.driverId].sort());
    expect(proposals.every((o) => o.proposedTotalCents === pPrime)).toBe(true);
    expect((await dispatchView(ride.id)).offers.find((o) => o.id === fixedOffer.offerId)?.state).toBe('withdrawn');
    const offer1 = proposals.find((o) => o.driverId === n1.driverId)!;
    const offer2 = proposals.find((o) => o.driverId === n2.driverId)!;
    const seen = await request(server()).get('/v1/driver/offers').set(bearer(n1.tokens)).expect(200);
    expect(seen.body).toEqual([expect.objectContaining({ id: offer1.offerId, type: 'client_proposal', proposedTotalCents: pPrime, displayedTotalCents: displayed })]);

    // Contre-offres encadrées.
    const counterUrl = `/v1/driver/offers/${offer1.offerId}/counter`;
    const below = await request(server()).post(counterUrl).set(bearer(n1.tokens)).send({ proposedTotalCents: pPrime - 100 });
    expect(below.status).toBe(400);
    expect(below.body.code).toBe('COUNTER_BELOW_PROPOSAL');
    const above = await request(server()).post(counterUrl).set(bearer(n1.tokens)).send({ proposedTotalCents: displayed + 500, reason: 'event' });
    expect(above.status).toBe(409);
    expect(above.body.code).toBe('ABOVE_MAX_DISABLED');
    const counterCents = Math.min(displayed, pPrime + 300);
    const countered = await request(server()).post(counterUrl).set(bearer(n1.tokens)).send({ proposedTotalCents: counterCents }).expect(201);
    expect(countered.body).toMatchObject({ type: 'driver_counter', state: 'sent', proposedTotalCents: counterCents });
    const twice = await request(server()).post(counterUrl).set(bearer(n1.tokens)).send({ proposedTotalCents: counterCents });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('COUNTER_ALREADY_MADE');
    // Le chauffeur n'accepte pas lui-même sa contre-offre.
    expect((await accept(n1, countered.body.id)).body.code).toBe('OFFER_NOT_ACCEPTABLE');

    // Le client voit la contre-offre et l'accepte.
    const offers = await request(server()).get(`/v1/rides/${ride.id}/offers`).set(bearer(c)).expect(200);
    expect(offers.body).toEqual([expect.objectContaining({ id: countered.body.id, totalCents: counterCents, aboveDisplayed: false, driver: expect.objectContaining({ id: n1.driverId }) })]);
    expect((await rideOf(ride.id, c)).negotiation?.openOffers).toBe(1);
    const chosen = await request(server()).post(`/v1/rides/${ride.id}/offers/${countered.body.id}/accept`).set(bearer(c)).send({}).expect(200);
    expect(chosen.body).toMatchObject({ state: 'assigned', driver: { id: n1.driverId }, negotiation: { agreedTotalCents: counterCents } });
    const lost = await accept(n2, offer2.offerId);
    expect(lost.status).toBe(409);
    expect(lost.body.code).toBe('OFFER_EXPIRED');

    // Le prix final est le prix convenu.
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(n1.tokens)).expect(200);
    const completed = await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(n1.tokens)).send({ measuredDistanceMeters: 4200, measuredDurationSeconds: 700 }).expect(200);
    expect(completed.body.finalPriceCents).toBe(counterCents);
    const types = (await journal(ride.id)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['proposal_set', 'negotiation_opened', 'offer_countered', 'negotiation_agreed']));

    // Garantie modèle : un signalement par course, par le client seulement.
    const reportUrl = `/v1/rides/${ride.id}/report-vehicle-mismatch`;
    const report = await request(server()).post(reportUrl).set(bearer(c)).send({ description: 'Ce n\'était pas une Tesla', modelSeen: 'Toyota Corolla' }).expect(201);
    expect(report.body.status).toBe('open');
    const again = await request(server()).post(reportUrl).set(bearer(c)).send({ description: 'Deuxième signalement' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('ALREADY_REPORTED');
    expect((await request(server()).post(reportUrl).set(bearer(n1.tokens)).send({ description: 'Essai du chauffeur' })).status).toBe(403);
    const [incident] = await db(app).select().from(schema.incidents).where(eq(schema.incidents.id, report.body.incidentId));
    expect(incident).toMatchObject({ type: 'model_guarantee', rideId: ride.id, reportedByKind: 'client' });
  });

  it('négociation : deux acceptations simultanées de la proposition, une seule gagne au prix proposé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const d1 = await online(NEAR);
    const d2 = await online(NEAR_2);
    const c = await client('negotiation');
    const ride = await requestRide(c);
    await offerAt(ride.id, 0);
    const displayed = ride.negotiation!.displayedTotalCents;
    const proposed = await request(server()).post(`/v1/rides/${ride.id}/proposals`).set(bearer(c)).send({ proposedTotalCents: Math.round((displayed * 0.85) / 100) * 100 }).expect(200);
    const pPrime = proposed.body.negotiation.proposedTotalCents as number;
    expect(pPrime).toBeLessThanOrEqual(displayed);
    const proposals = offersOf(ride.id).filter((o) => o.type === 'client_proposal');
    expect(proposals).toHaveLength(2);
    const byDriver = new Map([[d1.driverId, d1], [d2.driverId, d2]]);
    const results = await Promise.all(proposals.map((o) => accept(byDriver.get(o.driverId)!, o.offerId)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = results.find((r) => r.status === 200)!;
    expect(winner.body.negotiation.agreedTotalCents).toBe(pPrime);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('OFFER_EXPIRED');
    const events = await journal(ride.id);
    expect(events.filter((e) => e.type === 'offer_accepted')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'negotiation_agreed')).toHaveLength(1);
    const [row] = await db(app).select({ agreed: schema.rides.agreedTotalCents }).from(schema.rides).where(eq(schema.rides.id, ride.id));
    expect(row!.agreed).toBe(pPrime);
  });

  it('négociation : sans réponse pendant la fenêtre de 60 s, repli automatique au prix affiché', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const d = await online(NEAR);
    const c = await client('negotiation');
    const ride = await requestRide(c);
    await offerAt(ride.id, 0);
    const displayed = ride.negotiation!.displayedTotalCents;
    await request(server()).post(`/v1/rides/${ride.id}/proposals`).set(bearer(c)).send({ proposedTotalCents: displayed - 200 }).expect(200);
    const proposal = offersOf(ride.id).find((o) => o.type === 'client_proposal');
    expect(proposal?.driverId).toBe(d.driverId);
    const report = await dispatch().tick(later(61));
    expect(report.fallbacks).toBeGreaterThanOrEqual(1);
    const fixedAgain = offersOf(ride.id).at(-1)!;
    expect(fixedAgain).toMatchObject({ type: 'fixed', driverId: d.driverId, proposedTotalCents: null });
    const view = await rideOf(ride.id, c);
    expect(view.dispatch).toMatchObject({ mode: 'fixed', status: 'offering' });
    expect(view.negotiation?.endsAt).toBeNull();
    const [row] = await db(app).select({ mode: schema.rides.negotiationMode }).from(schema.rides).where(eq(schema.rides.id, ride.id));
    expect(row!.mode).toBe('fixed');
    expect(await notificationsTo(c.user.id, 'ride.negotiation_fallback', ride.id)).toHaveLength(1);
    expect((await journal(ride.id)).map((e) => e.type)).toContain('negotiation_fallback');
    // Accepté au prix affiché : aucun prix convenu.
    const accepted = await accept(d, fixedAgain.offerId).expect(200);
    expect(accepted.body.negotiation.agreedTotalCents).toBeNull();
  });

  it('drapeau de négociation désactivé : 404 FEATURE_DISABLED, aucune donnée de négociation exposée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const plain = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on', FEATURE_NEGOTIATION: 'off' });
    try {
      const c = await client('negotiation', plain!);
      const ride = await requestRide(c, {}, plain!);
      expect(ride.negotiation).toBeNull();
      const proposal = await request(plain!.getHttpServer()).post(`/v1/rides/${ride.id}/proposals`).set(bearer(c)).send({ proposedTotalCents: 1000 });
      expect(proposal.status).toBe(404);
      expect(proposal.body.code).toBe('FEATURE_DISABLED');
      expect((await request(plain!.getHttpServer()).get(`/v1/rides/${ride.id}/offers`).set(bearer(c)).expect(200)).body).toEqual([]);
      const d = await createDriver(plain!, 'neo_premium');
      scenarioDrivers.push(d.driverId);
      const counter = await request(plain!.getHttpServer()).post(`/v1/driver/offers/${ride.id}/counter`).set(bearer(d.tokens)).send({ proposedTotalCents: 1000 });
      expect(counter.status).toBe(404);
      expect(counter.body.code).toBe('FEATURE_DISABLED');
      const accepted = await request(plain!.getHttpServer()).post(`/v1/rides/${ride.id}/offers/${ride.id}/accept`).set(bearer(c)).send({});
      expect(accepted.body.code).toBe('FEATURE_DISABLED');
    } finally {
      await plain?.close();
    }
  });

  it('charge : 200 chauffeurs en ligne, première offre en moins de 3 s à l\'un des plus proches', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const database = db(app);
    const base = 1_000_000 + Math.floor(Math.random() * 8_000_000);
    // Une requête : comptes, rôles, fiches, véhicules, documents et présences, dans un carré d'environ 5 km autour de l'origine.
    const rows = await database.execute<{ user_id: string; driver_id: string; distance_m: number }>(sql`
      WITH input AS (
        SELECT i, '+1999' || lpad((${base}::int + i)::text, 7, '0') AS phone,
               ${PLATEAU.coordinates.lat}::float + (random() - 0.5) * 0.045 AS lat, ${PLATEAU.coordinates.lng}::float + (random() - 0.5) * 0.064 AS lng
        FROM generate_series(1, 200) AS i
      ), u AS (
        INSERT INTO users (phone, first_name, primary_role) SELECT phone, 'Charge', 'driver' FROM input RETURNING id, phone
      ), r AS (
        INSERT INTO user_roles (user_id, role) SELECT id, 'driver' FROM u
      ), d AS (
        INSERT INTO drivers (user_id, public_number, status, qualification, accepts_terminal, rating_average, activated_at)
        SELECT id, next_driver_public_number(), 'active', 'saaq_authorized', true, 4.9, now() FROM u RETURNING id, user_id
      ), v AS (
        INSERT INTO vehicles (driver_id, category, make, model, year, colour, plate, seats, status)
        SELECT id, 'neo_premium', 'Tesla', 'Model Y', 2024, 'noire', 'C' || upper(substr(md5(id::text), 1, 7)), 4, 'active' FROM d RETURNING id, driver_id
      ), docs AS (
        INSERT INTO driver_documents (driver_id, type, file_key, status, verified_at, expires_on)
        SELECT d.id, t.type::document_type, 'test/' || d.id || '/' || t.type, 'approved', now(), '2030-01-01'
        FROM d CROSS JOIN (VALUES ('licence'), ('insurance'), ('registration')) AS t(type)
      ), p AS (
        INSERT INTO driver_presence (driver_id, position, vehicle_id, category, is_available)
        SELECT v.driver_id, ST_SetSRID(ST_MakePoint(input.lng, input.lat), 4326)::geography, v.id, 'neo_premium', true
        FROM v JOIN d ON d.id = v.driver_id JOIN u ON u.id = d.user_id JOIN input ON input.phone = u.phone
        RETURNING driver_id, position
      )
      SELECT d.user_id, p.driver_id, ST_Distance(p.position, ST_SetSRID(ST_MakePoint(${PLATEAU.coordinates.lng}::float, ${PLATEAU.coordinates.lat}::float), 4326)::geography) AS distance_m
      FROM p JOIN d ON d.id = p.driver_id`);
    expect(rows).toHaveLength(200);
    for (const row of rows) {
      trackUser(row.user_id);
      scenarioDrivers.push(row.driver_id);
    }
    await database.execute(sql`UPDATE drivers SET current_vehicle_id = v.id FROM vehicles v WHERE v.driver_id = drivers.id AND drivers.id IN ${rows.map((r) => r.driver_id)}`);
    const nearest = [...rows].sort((x, y) => Number(x.distance_m) - Number(y.distance_m)).slice(0, 10).map((r) => r.driver_id);

    const c = await client();
    const ride = await requestRide(c);
    const first = await offerAt(ride.id, 0);
    expect(first.at - requestedAt.get(ride.id)!).toBeLessThan(3000);
    expect(nearest).toContain(first.driverId);
    const view = await settledView(ride.id);
    expect(view.dispatch).toMatchObject({ status: 'offering', wave: 1, offersSent: 1 });
  });
});
