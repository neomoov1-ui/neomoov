import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { statusAfterSuspension } from '../src/modules/drivers/driver-status.js';
import { SafetyHoldService } from '../src/modules/rides/safety-hold.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

/** Revue finale : la fin d'une suspension ne doit jamais effacer une restriction encore en cours. */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

describe('statut après une suspension (intégration)', () => {
  let app: NestExpressApplication | null = null;
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('chauffeur restreint suspendu à titre préventif puis levé : il redevient restreint, puis actif une fois la restriction échue', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const client = await loginByOtp(app, undefined, {}, { card: false });
    const driver = await createDriver(app);
    const operator = await createStaffAndLogin(app, ['operator']);
    const endsAt = new Date(Date.now() + 7 * 86_400_000);
    await db(app).insert(schema.sanctions).values({ driverId: driver.driverId, type: 'restriction', reason: 'Qualité : restriction de test', endsAt });
    await db(app).update(schema.drivers).set({ status: 'restricted' }).where(eq(schema.drivers.id, driver.driverId));
    const quote = (await request(server).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201)).body.quotes[0];
    const ride = (await request(server).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `statut-${Date.now()}`)
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'pay_driver_after', paymentMethod: 'cash', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body as { id: string };
    await db(app).update(schema.rides).set({ driverId: driver.driverId }).where(eq(schema.rides.id, ride.id));
    const [incident] = await db(app).insert(schema.incidents).values({ rideId: ride.id, type: 'complaint', severity: 'high', reportedByKind: 'client', description: 'Plainte de test' }).returning({ id: schema.incidents.id });
    await app.get(SafetyHoldService).holdForIncident(incident!.id);
    const statusOf = async () => (await db(app!).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId)))[0]!.status;
    expect(await statusOf()).toBe('suspended');
    await request(server).post(`/v1/admin/incidents/${incident!.id}/decide`).set(bearer(operator.tokens)).send({ status: 'decided', decision: 'Plainte non fondée', safetyHold: 'lift' }).expect(200);
    expect(await statusOf()).toBe('restricted');
    expect(await statusAfterSuspension(db(app), driver.driverId, new Date(endsAt.getTime() + 60_000))).toBe('active');
  });
});
