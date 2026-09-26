import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SafetyHoldService } from '../src/modules/rides/safety-hold.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `test-${Math.random().toString(36).slice(2, 14)}`;

describe('parcours 20 : SOS et blocage préventif du chauffeur (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  async function rideEnRoute(client: { accessToken: string }, driver: TestDriver, admin: { accessToken: string }): Promise<string> {
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201)).body.quotes[0];
    const ride = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key()).send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents }).expect(201);
    await request(server()).post(`/v1/admin/rides/${ride.body.id}/assign`).set(bearer(admin)).send({ driverId: driver.driverId }).expect(200);
    await request(server()).post(`/v1/driver/rides/${ride.body.id}/depart`).set(bearer(driver.tokens)).expect(200);
    return ride.body.id as string;
  }

  const driverStatus = async (driverId: string) => (await db(app!).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driverId)))[0]!.status;
  const notified = async (userId: string, template: string) => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template)));

  it('SOS du chauffeur : alerte sans blocage ; SOS du client : chauffeur bloqué aussitôt, course en cours menée à terme, décision humaine exigée puis levée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const rideId = await rideEnRoute(client, driver, admin.tokens);

    const own = await request(server()).post(`/v1/rides/${rideId}/sos`).set(bearer(driver.tokens)).send({ description: 'Client agressif' }).expect(201);
    expect(await driverStatus(driver.driverId)).toBe('active');
    const ownIncident = (await request(server()).get('/v1/admin/incidents').set(bearer(admin.tokens)).query({ q: '', pageSize: 100 }).expect(200)).body.items.find((i: { id: string }) => i.id === own.body.incidentId);
    expect(ownIncident.safetyHold).toBeNull();

    const sos = await request(server()).post(`/v1/rides/${rideId}/sos`).set(bearer(client)).send({ description: 'Conduite dangereuse', coordinates: PLATEAU.coordinates }).expect(201);
    const incidentId = sos.body.incidentId as string;
    expect(await driverStatus(driver.driverId)).toBe('suspended');
    const sanctions = await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.incidentId, incidentId));
    expect(sanctions).toHaveLength(1);
    expect(sanctions[0]).toMatchObject({ driverId: driver.driverId, type: 'suspension', endsAt: null, decidedByUserId: null });
    expect(sanctions[0]!.reason).toMatch(/^Sécurité : SOS sur la course /);
    expect(await notified(driver.userId, 'safety.hold')).not.toHaveLength(0);
    // Idempotent : rejouer le blocage du même incident ne crée rien.
    expect(await app.get(SafetyHoldService).holdForIncident(incidentId)).toBeNull();

    // La course en cours n'est pas interrompue ; aucune nouvelle course ensuite.
    await request(server()).post(`/v1/driver/rides/${rideId}/arrive`).set(bearer(driver.tokens)).expect(200);
    await request(server()).post(`/v1/driver/rides/${rideId}/start`).set(bearer(driver.tokens)).expect(200);
    await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200);
    const online = await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates });
    expect(online.status).toBe(409);
    expect(online.body.details.reasons).toContain('driver_status:suspended');

    const listed = (await request(server()).get('/v1/admin/incidents').set(bearer(admin.tokens)).query({ pageSize: 100 }).expect(200)).body.items.find((i: { id: string }) => i.id === incidentId);
    expect(listed.safetyHold).toBe('active');
    // Instruire sans trancher reste possible ; décider sans lever ni maintenir le blocage est refusé.
    await request(server()).post(`/v1/admin/incidents/${incidentId}/decide`).set(bearer(admin.tokens)).send({ status: 'investigating' }).expect(200);
    const refused = await request(server()).post(`/v1/admin/incidents/${incidentId}/decide`).set(bearer(admin.tokens)).send({ status: 'decided', decision: 'Vidéo examinée : aucun danger' });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('SAFETY_HOLD_DECISION_REQUIRED');
    const lifted = await request(server()).post(`/v1/admin/incidents/${incidentId}/decide`).set(bearer(admin.tokens)).send({ status: 'decided', decision: 'Vidéo examinée : aucun danger', safetyHold: 'lift' }).expect(200);
    expect(lifted.body.safetyHold).toBe('lifted');
    expect(await driverStatus(driver.driverId)).toBe('active');
    expect(await notified(driver.userId, 'safety.lifted')).not.toHaveLength(0);
    const [ended] = await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.incidentId, incidentId));
    expect(ended!.endsAt).not.toBeNull();
    expect(ended!.decidedByUserId).toBe(admin.userId);
  });

  it('plainte grave : blocage maintenu par décision humaine ; une autre suspension en cours empêche la reprise', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const rideId = await rideEnRoute(client, driver, admin.tokens);
    const safety = app.get(SafetyHoldService);
    const complaint = async (severity: 'medium' | 'high') => (await db(app!).insert(schema.incidents).values({ rideId, type: 'complaint', severity, reportedByKind: 'client', description: 'Propos menaçants du chauffeur' }).returning({ id: schema.incidents.id }))[0]!.id;

    // Gravité moyenne : pas de blocage.
    expect(await safety.holdForIncident(await complaint('medium'))).toBeNull();
    expect(await driverStatus(driver.driverId)).toBe('active');

    const first = await complaint('high');
    const second = await complaint('high');
    expect(await safety.holdForIncident(first)).toEqual({ driverId: driver.driverId });
    expect(await safety.holdForIncident(second)).toEqual({ driverId: driver.driverId });
    expect(await driverStatus(driver.driverId)).toBe('suspended');

    // Lever le premier ne suffit pas : le second blocage reste en cours.
    await request(server()).post(`/v1/admin/incidents/${first}/decide`).set(bearer(admin.tokens)).send({ status: 'closed', decision: 'Doublon du second signalement', safetyHold: 'lift' }).expect(200);
    expect(await driverStatus(driver.driverId)).toBe('suspended');
    const kept = await request(server()).post(`/v1/admin/incidents/${second}/decide`).set(bearer(admin.tokens)).send({ status: 'decided', decision: 'Témoignages concordants', safetyHold: 'keep' }).expect(200);
    expect(kept.body.safetyHold).toBe('kept');
    expect(await driverStatus(driver.driverId)).toBe('suspended');
    const [sanction] = await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.incidentId, second));
    expect(sanction).toMatchObject({ endsAt: null, decidedByUserId: admin.userId });
    expect(sanction!.reason).toContain('maintenue par décision humaine');
    // Plus de blocage en attente : clore l'incident n'exige plus de choix.
    await request(server()).post(`/v1/admin/incidents/${second}/decide`).set(bearer(admin.tokens)).send({ status: 'closed' }).expect(200);
  });
});
