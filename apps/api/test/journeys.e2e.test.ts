import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PackLifecycleService } from '../src/modules/rides/pack-lifecycle.service.js';
import { RidesService } from '../src/modules/rides/rides.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, testPhone, type TestDriver } from './helpers.js';

/**
 * Parcours critiques (cahier des charges 9.2) dont les autres fichiers ne couvraient qu'une partie : numéro de vol
 * transmis au chauffeur (3), pack non consommé sur non-présentation (7), annulation en route comptée au tableau de
 * conduite (8), aucun chauffeur : autorisation levée et alertes (9), course par téléphone pour un client sans compte
 * attribuée à la main et confirmée par texto (17). Inventaire complet : `docs/testing/README.md`.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const key = () => `jrn-${Math.random().toString(36).slice(2, 14)}`;
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

describe('parcours critiques complémentaires (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  let hour = 3;

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on' });
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  /** Heures distinctes : deux réservations du même chauffeur ne se chevauchent jamais. */
  const nextSlot = () => new Date(Date.now() + (hour += 3) * 3_600_000).toISOString();

  async function quote(client: Tokens, requestedAt: string | null) {
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, ...(requestedAt ? { requestedAt } : {}) }).expect(201);
    return res.body.quotes[0] as { id: string; maxConsentedCents: number; totalCents: number };
  }

  async function scheduled(client: Tokens, extra: Record<string, unknown> = {}) {
    const requestedAt = nextSlot();
    const q = await quote(client, requestedAt);
    const res = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: q.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: q.maxConsentedCents, ...extra }).expect(201);
    return res.body.id as string;
  }

  const assign = (admin: Tokens, rideId: string, driver: TestDriver) => request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(admin)).send({ driverId: driver.driverId }).expect(200);
  const step = (driver: TestDriver, rideId: string, name: string) => request(server()).post(`/v1/driver/rides/${rideId}/${name}`).set(bearer(driver.tokens));

  it('parcours 3 : le numéro de vol de la réservation est sur la fiche du chauffeur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const requestedAt = nextSlot();
    const q = await quote(client, requestedAt);
    const refused = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: q.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: q.maxConsentedCents, flightNumber: 'vol 870' });
    expect(refused.status).toBe(400);
    const rideId = await scheduled(client, { flightNumber: 'AC870' });
    await assign(admin.tokens, rideId, driver);
    const card = await request(server()).get(`/v1/driver/rides/${rideId}`).set(bearer(driver.tokens)).expect(200);
    expect(card.body.job.flightNumber).toBe('AC870');
    const plain = await scheduled(client);
    await assign(admin.tokens, plain, driver);
    expect((await request(server()).get(`/v1/driver/rides/${plain}`).set(bearer(driver.tokens)).expect(200)).body.job.flightNumber).toBeNull();
  });

  it('parcours 7 : non-présentation facturée 7,00 $, aucune course de pack consommée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'essential', autoRenew: false }).expect(200);
    const packOf = async () => (await db(app!).select().from(schema.packPurchases).where(and(eq(schema.packPurchases.driverId, driver.driverId), eq(schema.packPurchases.status, 'active'))))[0]!;
    const before = await packOf();
    const rideId = await scheduled(client);
    await assign(admin.tokens, rideId, driver);
    await step(driver, rideId, 'depart').expect(200);
    await step(driver, rideId, 'arrive').expect(200);
    await db(app).update(schema.rides).set({ stateTimestamps: sql`${schema.rides.stateTimestamps} || ${JSON.stringify({ arrived: new Date(Date.now() - 400_000).toISOString() })}::jsonb` }).where(eq(schema.rides.id, rideId));
    await step(driver, rideId, 'contact').expect(200);
    await request(server()).post(`/v1/rides/${rideId}/messages`).set(bearer(driver.tokens)).send({ body: 'Je suis devant la porte' }).expect(201);
    expect((await step(driver, rideId, 'no-show').expect(200)).body).toEqual({ state: 'no_show', feeCents: 700 });
    // La consommation suit la fin de course (événement) : une non-présentation n'en déclenche aucune, même rejouée.
    expect((await app.get(PackLifecycleService).consume(rideId)).consumedFromId).toBeNull();
    expect(await db(app).select().from(schema.packConsumptions).where(eq(schema.packConsumptions.rideId, rideId))).toHaveLength(0);
    const after = await packOf();
    expect({ remaining: after.ridesRemaining, carried: after.carriedOverRemaining }).toEqual({ remaining: before.ridesRemaining, carried: before.carriedOverRemaining });
  });

  it('parcours 8 : annulation du chauffeur en route, réattribution et annulation comptée au tableau de conduite', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const rideId = await scheduled(client);
    await assign(admin.tokens, rideId, driver);
    const score = async () => (await request(server()).get('/v1/driver/score').set(bearer(driver.tokens)).expect(200)).body.cancellationCount as number;
    expect(await score()).toBe(0);
    await step(driver, rideId, 'depart').expect(200);
    const cancelled = await step(driver, rideId, 'cancel').send({ reason: 'Panne de véhicule' }).expect(200);
    expect(cancelled.body).toMatchObject({ state: 'requested', driver: null });
    expect(await score()).toBe(1);
    const journal = await request(server()).get(`/v1/admin/rides/${rideId}/events`).set(bearer(admin.tokens)).expect(200);
    expect(journal.body.find((e: { type: string }) => e.type === 'driver_cancels').data.effects).toEqual(['driver_sanction', 'reassign_with_priority']);
    // Réattribuée à un autre chauffeur ; celui qui a annulé ne peut plus agir sur la course.
    const second = await createDriver(app);
    expect((await assign(admin.tokens, rideId, second)).body.driver.id).toBe(second.driverId);
    expect((await step(driver, rideId, 'arrive')).status).toBe(403);
  });

  it('parcours 9 : aucun chauffeur, autorisation de paiement levée, client et exploitation prévenus', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['operator']);
    const client = await loginByOtp(app);
    const q = await quote(client, null);
    const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: q.id, type: 'immediate', paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: q.maxConsentedCents }).expect(201);
    const rideId = created.body.id as string;
    const payment = () => db(app!).select().from(schema.payments).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'ride')));
    await until(payment, (rows) => rows[0]?.status === 'authorized', 'autorisation');
    // Répartition épuisée (trois balayages, voir dispatch.e2e) : même transition que le moteur.
    await app.get(RidesService).systemTransition(rideId, 'no_driver_found', { reason: 'exhausted' });
    const ride = await request(server()).get(`/v1/rides/${rideId}`).set(bearer(client)).expect(200);
    expect(ride.body.state).toBe('no_driver');
    await until(payment, (rows) => rows[0]?.status === 'cancelled', 'autorisation levée');
    const notices = (userId: string, template: string) => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template)));
    expect(await notices(client.user.id, 'ride.no_driver')).not.toHaveLength(0);
    expect(await notices(admin.userId, 'alert.no_driver')).not.toHaveLength(0);
  });

  it('parcours 17 : course par téléphone pour un client sans compte, attribution manuelle, texto de confirmation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const operator = await createStaffAndLogin(app, ['operator']);
    const quoter = await loginByOtp(app);
    const driver = await createDriver(app);
    const phone = testPhone();
    const requestedAt = nextSlot();
    const q = await quote(quoter, requestedAt);
    const created = await request(server()).post('/v1/admin/rides').set(bearer(operator.tokens)).send({ quoteId: q.id, guest: { name: 'Jean Tremblay', phone }, paymentMethod: 'cash' }).expect(201);
    const rideId = created.body.id as string;
    const [row] = await db(app).select({ clientId: schema.rides.clientId, guestPhone: schema.rides.guestPhone }).from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(row).toEqual({ clientId: null, guestPhone: phone });
    // Aucun compte n'est créé pour ce client (Loi 25).
    expect(await db(app).select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.phone, phone))).toHaveLength(0);
    await assign(operator.tokens, rideId, driver);
    const texts = await until(
      () => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientAddress, phone), eq(schema.notifications.template, 'ride.assigned'))),
      (rows) => rows.length > 0,
      'texto d\'attribution',
    );
    expect(texts[0]).toMatchObject({ channel: 'sms', recipientUserId: null });
    const journal = await request(server()).get(`/v1/admin/rides/${rideId}/events`).set(bearer(operator.tokens)).expect(200);
    expect(journal.body.find((e: { type: string }) => e.type === 'driver_accepts')).toMatchObject({ actorKind: 'operator' });
  });
});
