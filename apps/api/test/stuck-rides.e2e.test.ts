import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StuckRidesService } from '../src/modules/rides/stuck-rides.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };

describe('surveillance des courses figées (intégration)', () => {
  let app: NestExpressApplication | null = null;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('arrivé depuis 45 minutes et réservation dont l\'heure est passée : signalées une fois à l\'exploitation, pas une course normale', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const operator = await createStaffAndLogin(app, ['operator']);
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const book = async (hours: number) => {
      const requestedAt = new Date(Date.now() + hours * 3_600_000).toISOString();
      const quote = (await request(server).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
      return (await request(server).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `stuck-${Math.random().toString(36).slice(2)}`)
        .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body.id as string;
    };
    const now = Date.now();
    const arrived = await book(3);
    const late = await book(4);
    const fine = await book(5);
    await db(app).update(schema.rides).set({ state: 'arrived', driverId: driver.driverId, stateTimestamps: { arrived: new Date(now - 45 * 60_000).toISOString() } }).where(eq(schema.rides.id, arrived));
    await db(app).update(schema.rides).set({ state: 'assigned', driverId: driver.driverId, requestedAt: new Date(now - 20 * 60_000), stateTimestamps: { assigned: new Date(now - 3_600_000).toISOString() } }).where(eq(schema.rides.id, late));
    await db(app).update(schema.rides).set({ state: 'arrived', driverId: driver.driverId, stateTimestamps: { arrived: new Date(now - 5 * 60_000).toISOString() } }).where(eq(schema.rides.id, fine));

    const stuck = app.get(StuckRidesService);
    const found = (await stuck.find()).filter((r) => [arrived, late, fine].includes(r.rideId));
    expect(found.map((r) => r.rideId).sort()).toEqual([arrived, late].sort());
    expect(found.find((r) => r.rideId === arrived)).toMatchObject({ state: 'arrived' });
    expect(found.find((r) => r.rideId === arrived)!.minutes).toBeGreaterThanOrEqual(44);

    await stuck.alert();
    await stuck.alert();
    const alerts = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, operator.userId), eq(schema.notifications.template, 'alert.stuck_ride')));
    const mine = alerts.filter((a) => [arrived, late].includes((a.data as { rideId: string }).rideId));
    expect(mine).toHaveLength(2);

    const listed = await request(server).get('/v1/admin/rides/stuck').set(bearer(operator.tokens)).expect(200);
    expect(listed.body.map((r: { rideId: string }) => r.rideId)).toEqual(expect.arrayContaining([arrived, late]));
    expect(listed.body.map((r: { rideId: string }) => r.rideId)).not.toContain(fine);
    expect((await request(server).get('/v1/admin/rides/stuck').set(bearer(client))).status).toBe(403);
  });
});
