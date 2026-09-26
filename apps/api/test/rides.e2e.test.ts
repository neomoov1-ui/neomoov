import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEventsService } from '../src/common/domain-events.js';
import { ApproachNotifierService } from '../src/modules/rides/approach-notifier.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `test-${Math.random().toString(36).slice(2, 14)}`;

describe('courses : cycle de vie, annulations, messages, SOS (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  async function quoteFor(client: { accessToken: string }, category = 'neo_premium', origin = PLATEAU, destination = CENTRE) {
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category, origin, destination, requestedAt: inThreeHours() }).expect(201);
    return res.body.quotes[0] as { id: string; maxConsentedCents: number; totalCents: number };
  }

  async function requestRide(client: { accessToken: string }, quote: { id: string; maxConsentedCents: number }, idempotencyKey = key()) {
    const res = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', idempotencyKey).send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents });
    return res;
  }

  async function assign(admin: { accessToken: string }, rideId: string, driver: TestDriver) {
    return request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(admin)).send({ driverId: driver.driverId }).expect(200);
  }

  it('scénario complet : devis, demande (idempotente), attribution forcée, en route, arrivé, en cours, terminé, évaluation, événements', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const quote = await quoteFor(client);
    const idem = key();
    const created = await requestRide(client, quote, idem);
    expect(created.status).toBe(201);
    expect(created.body.state).toBe('requested');
    expect(created.body.type).toBe('scheduled');
    expect(created.body.quote.maxConsentedCents).toBe(quote.maxConsentedCents);
    const replay = await requestRide(client, quote, idem);
    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(created.body.id);
    const again = await requestRide(client, quote, key());
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('QUOTE_ALREADY_USED');
    const noKey = await request(server()).post('/v1/rides').set(bearer(client)).send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents });
    expect(noKey.status).toBe(400);
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    const rideId = created.body.id as string;

    const events: string[] = [];
    const bus = app.get(DomainEventsService);
    const off = bus.on('ride.state_changed', (p) => {
      if (p.rideId === rideId) events.push(p.event);
    });

    // Le chauffeur ne peut rien faire avant l'attribution.
    const early = await request(server()).post(`/v1/driver/rides/${rideId}/depart`).set(bearer(driver.tokens));
    expect(early.status).toBe(403);
    const assigned = await assign(admin.tokens, rideId, driver);
    expect(assigned.body.state).toBe('assigned');
    expect(assigned.body.driver.id).toBe(driver.driverId);
    expect(assigned.body.driver.vehicle.plate).toBeTruthy();
    // Rejouer l'attribution ne crée pas de doublon.
    await assign(admin.tokens, rideId, driver);
    const wrongOrder = await request(server()).post(`/v1/driver/rides/${rideId}/start`).set(bearer(driver.tokens));
    expect(wrongOrder.status).toBe(409);
    expect(wrongOrder.body.code).toBe('RIDE_INVALID_TRANSITION');

    expect((await request(server()).post(`/v1/driver/rides/${rideId}/depart`).set(bearer(driver.tokens)).expect(200)).body.state).toBe('en_route');
    expect((await request(server()).post(`/v1/driver/rides/${rideId}/depart`).set(bearer(driver.tokens)).expect(200)).body.state).toBe('en_route');
    expect((await request(server()).post(`/v1/driver/rides/${rideId}/arrive`).set(bearer(driver.tokens)).expect(200)).body.state).toBe('arrived');
    const started = await request(server()).post(`/v1/driver/rides/${rideId}/start`).set(bearer(driver.tokens)).expect(200);
    expect(started.body.state).toBe('in_progress');
    const completed = await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200);
    expect(completed.body.state).toBe('completed');
    expect(completed.body.finalPriceCents).toBe(quote.totalCents);
    const rated = await request(server()).post(`/v1/rides/${rideId}/rate`).set(bearer(client)).send({ score: 5, tags: ['punctual', 'clean_car'], tipCents: 300 }).expect(200);
    expect(rated.body.state).toBe('rated');
    expect(rated.body.tipCents).toBe(300);
    off();
    expect(events).toEqual(['offers_sent', 'driver_accepts', 'driver_departs', 'driver_arrives', 'ride_starts', 'ride_ends', 'client_rates']);

    const journal = await request(server()).get(`/v1/rides/${rideId}/events`).set(bearer(client)).expect(200);
    const types = journal.body.map((e: { type: string }) => e.type) as string[];
    // Signaux de paiement (étape 7) écrits en asynchrone entre les transitions : vérifiés à part, sans ordre imposé.
    const payment = ['payment_authorized', 'ride_captured', 'tip_captured'];
    expect(types.filter((t) => !payment.includes(t))).toEqual(['client_confirms', 'offers_sent', 'driver_accepts', 'driver_departs', 'driver_arrives', 'ride_starts', 'ride_ends', 'client_rates']);
    expect(types).toEqual(expect.arrayContaining(['payment_authorized', 'tip_captured']));
    expect(journal.body.find((e: { type: string }) => e.type === 'driver_accepts').actorKind).toBe('operator');
    expect(journal.body.find((e: { type: string }) => e.type === 'ride_ends').data.finalPriceCents).toBe(quote.totalCents);
    // Rejouer une transition n'ajoute pas d'événement (idempotence).
    expect(journal.body.filter((e: { type: string }) => e.type === 'driver_departs')).toHaveLength(1);

    const [driverRow] = await db(app).select().from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
    expect(driverRow!.rideCount).toBe(1);
    expect(Number(driverRow!.ratingAverage)).toBe(5);
    const [link] = await db(app).select().from(schema.clientDriverLinks).where(eq(schema.clientDriverLinks.driverId, driver.driverId));
    expect(link!.ridesCount).toBe(1);
    const history = await request(server()).get('/v1/rides').set(bearer(client)).expect(200);
    expect(history.body.items[0].id).toBe(rideId);
    const driverRides = await request(server()).get('/v1/driver/rides').set(bearer(driver.tokens)).expect(200);
    expect(driverRides.body.items[0].id).toBe(rideId);
    expect(driverRides.body.active).toBeNull();
    const other = await loginByOtp(app);
    expect((await request(server()).get(`/v1/rides/${rideId}`).set(bearer(other))).status).toBe(403);
    expect((await request(server()).get(`/v1/rides/${rideId}`).set(bearer(driver.tokens))).status).toBe(200);
  });

  it('annulation client : gratuite avant attribution et dans les 2 minutes, 5,00 $ ensuite ; frais lus en base', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const free = (await requestRide(client, await quoteFor(client))).body;
    const cancelled = await request(server()).post(`/v1/rides/${free.id}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200);
    expect(cancelled.body).toEqual({ state: 'cancelled_by_client', feeCents: 0 });
    const afterAssign = (await requestRide(client, await quoteFor(client))).body;
    await assign(admin.tokens, afterAssign.id, driver);
    const withinWindow = await request(server()).post(`/v1/rides/${afterAssign.id}/cancel`).set(bearer(client)).send({ reason: 'too_long' }).expect(200);
    expect(withinWindow.body.feeCents).toBe(0);
    const late = (await requestRide(client, await quoteFor(client))).body;
    await assign(admin.tokens, late.id, driver);
    // Attribution antidatée de trois minutes : hors fenêtre gratuite.
    await db(app).update(schema.rides).set({ stateTimestamps: sql`${schema.rides.stateTimestamps} || ${JSON.stringify({ assigned: new Date(Date.now() - 180_000).toISOString() })}::jsonb` }).where(eq(schema.rides.id, late.id));
    const lateCancel = await request(server()).post(`/v1/rides/${late.id}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200);
    expect(lateCancel.body.feeCents).toBe(500);
    const [row] = await db(app).select({ fee: schema.rides.cancellationFeeCents, reason: schema.rides.cancellationReason }).from(schema.rides).where(eq(schema.rides.id, late.id));
    expect(row).toEqual({ fee: 500, reason: 'changed_plans' });
    const twice = await request(server()).post(`/v1/rides/${late.id}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200);
    expect(twice.body.feeCents).toBe(500);
    // Trois annulations en 7 jours : alerte à l'exploitation (courriel), une seule fois par fenêtre.
    const [clientRow] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, client.user.id));
    const cancellationAlerts = () => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.client_cancellations'), sql`${schema.notifications.data}->>'clientId' = ${clientRow!.id}`));
    const deadline = Date.now() + 10_000;
    while (!(await cancellationAlerts()).length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 150));
    const alerts = await cancellationAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.every((a) => a.channel === 'email')).toBe(true);
    expect(alerts[0]!.data).toMatchObject({ cancelled: 3, noShows: 0, days: 7 });
    expect(new Set(alerts.map((a) => a.recipientUserId)).size).toBe(alerts.length);
    const enRoute = (await requestRide(client, await quoteFor(client))).body;
    await assign(admin.tokens, enRoute.id, driver);
    await request(server()).post(`/v1/driver/rides/${enRoute.id}/depart`).set(bearer(driver.tokens)).expect(200);
    const enRouteCancel = await request(server()).post(`/v1/rides/${enRoute.id}/cancel`).set(bearer(client)).send({ reason: 'driver_not_moving' }).expect(200);
    expect(enRouteCancel.body.feeCents).toBe(500);
    // Quatrième annulation : pas de seconde alerte dans la même fenêtre.
    await new Promise((r) => setTimeout(r, 500));
    expect(await cancellationAlerts()).toHaveLength(alerts.length);
    await db(app).delete(schema.notifications).where(inArray(schema.notifications.id, alerts.map((a) => a.id)));
  });

  it('non-présentation : refusée avant cinq minutes ou sans deux contacts, puis 7,00 $', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const ride = (await requestRide(client, await quoteFor(client))).body;
    await assign(admin.tokens, ride.id, driver);
    await request(server()).post(`/v1/driver/rides/${ride.id}/depart`).set(bearer(driver.tokens)).expect(200);
    await request(server()).post(`/v1/driver/rides/${ride.id}/arrive`).set(bearer(driver.tokens)).expect(200);
    const tooEarly = await request(server()).post(`/v1/driver/rides/${ride.id}/no-show`).set(bearer(driver.tokens));
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.details.reason).toBe('not_waited_enough');
    await db(app).update(schema.rides).set({ stateTimestamps: sql`${schema.rides.stateTimestamps} || ${JSON.stringify({ arrived: new Date(Date.now() - 400_000).toISOString() })}::jsonb` }).where(eq(schema.rides.id, ride.id));
    const noContacts = await request(server()).post(`/v1/driver/rides/${ride.id}/no-show`).set(bearer(driver.tokens));
    expect(noContacts.body.details.reason).toBe('not_enough_contacts');
    await request(server()).post(`/v1/driver/rides/${ride.id}/contact`).set(bearer(driver.tokens)).expect(200);
    await request(server()).post(`/v1/rides/${ride.id}/messages`).set(bearer(driver.tokens)).send({ body: 'Je suis devant la porte' }).expect(201);
    const noShow = await request(server()).post(`/v1/driver/rides/${ride.id}/no-show`).set(bearer(driver.tokens)).expect(200);
    expect(noShow.body).toEqual({ state: 'no_show', feeCents: 700 });
    const closed = await request(server()).post(`/v1/rides/${ride.id}/messages`).set(bearer(client)).send({ body: 'trop tard' });
    expect(closed.status).toBe(409);
  });

  it('annulation chauffeur : retour à « demandée » pour réattribution, événement publié ; messages, partage, SOS', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const ride = (await requestRide(client, await quoteFor(client))).body;
    await assign(admin.tokens, ride.id, driver);
    await request(server()).post(`/v1/driver/rides/${ride.id}/depart`).set(bearer(driver.tokens)).expect(200);
    const bus = app.get(DomainEventsService);
    let reassign = 0;
    const off = bus.on('ride.reassign_requested', (p) => {
      if (p.rideId === ride.id) reassign += 1;
    });
    const sent = await request(server()).post(`/v1/rides/${ride.id}/messages`).set(bearer(client)).send({ body: 'Je porte un manteau rouge' }).expect(201);
    expect(sent.body.senderKind).toBe('client');
    const inbox = await request(server()).get(`/v1/rides/${ride.id}/messages`).set(bearer(driver.tokens)).expect(200);
    expect(inbox.body[0]).toMatchObject({ body: 'Je porte un manteau rouge', mine: false, senderKind: 'client' });
    const shared = await request(server()).post(`/v1/rides/${ride.id}/share`).set(bearer(client)).expect(200);
    expect(shared.body.trackingUrl).toContain(`/suivi/${shared.body.token}`);
    const tracking = await request(server()).get(`/v1/public/track/${shared.body.token}`).expect(200);
    expect(tracking.body).toMatchObject({ state: 'en_route', driver: { firstName: expect.any(String) } });
    expect(tracking.body).not.toHaveProperty('guestPhone');
    const sos = await request(server()).post(`/v1/rides/${ride.id}/sos`).set(bearer(client)).send({ description: 'Conduite dangereuse', coordinates: PLATEAU.coordinates }).expect(201);
    const [incident] = await db(app).select().from(schema.incidents).where(eq(schema.incidents.id, sos.body.incidentId));
    expect(incident).toMatchObject({ type: 'sos', severity: 'critical', rideId: ride.id, reportedByKind: 'client' });
    const staffAlerts = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.sos'), eq(schema.notifications.recipientUserId, admin.userId)));
    expect(staffAlerts.length).toBeGreaterThan(0);
    const cancelled = await request(server()).post(`/v1/driver/rides/${ride.id}/cancel`).set(bearer(driver.tokens)).send({ reason: 'Panne de véhicule' }).expect(200);
    expect(cancelled.body.state).toBe('requested');
    expect(cancelled.body.driver).toBeNull();
    expect(reassign).toBe(1);
    off();
    const journal = await request(server()).get(`/v1/admin/rides/${ride.id}/events`).set(bearer(admin.tokens)).expect(200);
    const types = journal.body.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['driver_cancels', 'reassign', 'sos', 'shared']));
    expect(journal.body.find((e: { type: string }) => e.type === 'driver_cancels').data.effects).toEqual(['driver_sanction', 'reassign_with_priority']);
    // Un nouveau chauffeur peut être attribué.
    const second = await createDriver(app);
    const reassigned = await assign(admin.tokens, ride.id, second);
    expect(reassigned.body.driver.id).toBe(second.driverId);
  });

  it('réservation pour un tiers (parcours 4) : le passager reçoit par texto le lien de suivi public à l\'attribution', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const quote = await quoteFor(client);
    const passengerPhone = `+1999${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`;
    const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key()).send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents, passenger: { name: 'Marie Tremblay', phone: passengerPhone } }).expect(201);
    await assign(admin.tokens, created.body.id, driver);
    const [sms] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, passengerPhone), eq(schema.notifications.template, 'ride.passenger_tracking')));
    expect(sms).toMatchObject({ channel: 'sms', recipientUserId: null });
    const url = (sms!.data as { trackingUrl: string }).trackingUrl;
    const token = url.split('/suivi/')[1]!;
    const tracking = await request(server()).get(`/v1/public/track/${token}`).expect(200);
    expect(tracking.body).toMatchObject({ state: 'assigned' });
    // Le client garde le même lien s'il partage lui-même le trajet.
    expect((await request(server()).post(`/v1/rides/${created.body.id}/share`).set(bearer(client)).expect(200)).body.token).toBe(token);
    // Le chauffeur se retire, un autre est attribué : le passager n'est pas prévenu une seconde fois.
    await request(server()).post(`/v1/driver/rides/${created.body.id}/cancel`).set(bearer(driver.tokens)).send({ reason: 'Panne de véhicule' }).expect(200);
    const second = await createDriver(app);
    await assign(admin.tokens, created.body.id, second);
    expect(await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, passengerPhone), eq(schema.notifications.template, 'ride.passenger_tracking')))).toHaveLength(1);
    // Approche et arrivée : texto au passager, avec le véhicule à reconnaître.
    await request(server()).post(`/v1/driver/rides/${created.body.id}/depart`).set(bearer(second.tokens)).expect(200);
    expect(await app.get(ApproachNotifierService).onPosition(created.body.id, { lat: PLATEAU.coordinates.lat + 0.001, lng: PLATEAU.coordinates.lng })).toBe(true);
    await request(server()).post(`/v1/driver/rides/${created.body.id}/arrive`).set(bearer(second.tokens)).expect(200);
    const passengerSms = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, passengerPhone), inArray(schema.notifications.template, ['ride.passenger_approaching', 'ride.passenger_arrived'])));
    expect(passengerSms.map((n) => n.template).sort()).toEqual(['ride.passenger_approaching', 'ride.passenger_arrived']);
    expect(passengerSms.every((n) => n.channel === 'sms' && (n.data as { plate: string | null }).plate)).toBe(true);
    // Un passager qui est le client lui-même ne reçoit rien.
    const ownQuote = await quoteFor(client);
    const self = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key()).send({ quoteId: ownQuote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'card_app', maxConsentedCents: ownQuote.maxConsentedCents, passenger: { name: 'Moi', phone: client.user.phone } }).expect(201);
    await assign(admin.tokens, self.body.id, await createDriver(app));
    expect(await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, client.user.phone), eq(schema.notifications.template, 'ride.passenger_tracking')))).toHaveLength(0);
  });

  it('création par l\'opérateur avec fiche minimale, garantie modèle et présence du chauffeur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['operator']);
    const quote = await quoteFor(admin.tokens, 'neo_prestige');
    const guestPhone = `+1999${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`;
    const created = await request(server()).post('/v1/admin/rides').set(bearer(admin.tokens)).send({ quoteId: quote.id, guest: { name: 'Marie Roy', phone: guestPhone }, paymentMethod: 'cash' }).expect(201);
    expect(created.body.state).toBe('requested');
    const premiumDriver = await createDriver(app, 'neo_premium');
    const tooLow = await request(server()).post(`/v1/admin/rides/${created.body.id}/assign`).set(bearer(admin.tokens)).send({ driverId: premiumDriver.driverId });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.code).toBe('VEHICLE_CATEGORY_TOO_LOW');
    const xlDriver = await createDriver(app, 'neo_xl');
    const ok = await request(server()).post(`/v1/admin/rides/${created.body.id}/assign`).set(bearer(admin.tokens)).send({ driverId: xlDriver.driverId }).expect(200);
    expect(ok.body.servedCategory).toBe('neo_xl');
    const guestNotification = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, guestPhone), eq(schema.notifications.template, 'ride.assigned')));
    expect(guestNotification).toHaveLength(1);

    // Présence : hors ligne par défaut, en ligne avec position, positions acceptées puis expiration.
    const status = await request(server()).get('/v1/driver/status').set(bearer(xlDriver.tokens)).expect(200);
    expect(status.body.status).toBe('offline');
    const noPosition = await request(server()).post('/v1/driver/status').set(bearer(xlDriver.tokens)).send({ status: 'online' });
    expect(noPosition.status).toBe(400);
    expect(noPosition.body.code).toBe('POSITION_REQUIRED');
    const online = await request(server()).post('/v1/driver/status').set(bearer(xlDriver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates }).expect(200);
    expect(online.body).toMatchObject({ status: 'online', category: 'neo_xl' });
    const moved = await request(server()).post('/v1/driver/location').set(bearer(xlDriver.tokens)).send({ coordinates: { lat: 45.53, lng: -73.59 }, speedMps: 10, headingDegrees: 45 }).expect(200);
    expect(moved.body.accepted).toBe(true);
    const tooClose = await request(server()).post('/v1/driver/location').set(bearer(xlDriver.tokens)).send({ coordinates: { lat: 45.53001, lng: -73.59001 } }).expect(200);
    expect(tooClose.body.accepted).toBe(false);
    const offline = await request(server()).post('/v1/driver/status').set(bearer(xlDriver.tokens)).send({ status: 'offline' }).expect(200);
    expect(offline.body.status).toBe('offline');
    // Course active (attribuée) : la position reste acceptée et la présence est recréée en pause, le suivi du client continue.
    const duringRide = await request(server()).post('/v1/driver/location').set(bearer(xlDriver.tokens)).send({ coordinates: { lat: 45.54, lng: -73.6 } }).expect(200);
    expect(duringRide.body).toMatchObject({ rideId: created.body.id, accepted: true });
    expect((await request(server()).get('/v1/driver/status').set(bearer(xlDriver.tokens)).expect(200)).body.status).toBe('paused');
    // Sans course active, un chauffeur hors ligne ne peut pas envoyer de position.
    const afterOffline = await request(server()).post('/v1/driver/location').set(bearer(premiumDriver.tokens)).send({ coordinates: { lat: 45.54, lng: -73.6 } });
    expect(afterOffline.status).toBe(409);
    expect(afterOffline.body.code).toBe('DRIVER_OFFLINE');
    // Prérequis : un document manquant refuse le passage en ligne avec le motif.
    await db(app).update(schema.driverDocuments).set({ status: 'expired' }).where(and(eq(schema.driverDocuments.driverId, xlDriver.driverId), eq(schema.driverDocuments.type, 'insurance')));
    const refused = await request(server()).post('/v1/driver/status').set(bearer(xlDriver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates });
    expect(refused.status).toBe(409);
    expect(refused.body.details.reasons).toContain('document_missing:insurance');
  });
});
