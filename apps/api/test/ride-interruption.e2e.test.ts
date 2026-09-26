import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

/** Revue finale : une course en cours se clôt aussi autrement qu'en la terminant (accident, chauffeur injoignable). */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('interruption d\'une course en cours (intégration)', () => {
  let app: NestExpressApplication | null = null;
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('course prépayée en cours : interrompue, incident ouvert, autorisation levée, aucune facture, client prévenu ; annulation refusée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const operator = await createStaffAndLogin(app, ['operator']);
    const quote = (await request(server).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201)).body.quotes[0];
    const ride = (await request(server).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `interr-${Date.now()}`)
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body as { id: string };
    await request(server).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(operator.tokens)).send({ driverId: driver.driverId }).expect(200);
    const payment = () => db(app!).select().from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.kind, 'ride')));
    await until(payment, (rows) => rows[0]?.status === 'authorized', 'autorisation');
    for (const step of ['depart', 'arrive', 'start']) await request(server).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(driver.tokens)).expect(200);

    // Annuler une course en cours n'est pas possible : il faut l'interrompre.
    expect((await request(server).post(`/v1/admin/rides/${ride.id}/cancel`).set(bearer(operator.tokens)).send({ reason: 'Accident' })).status).toBe(409);
    const readonly = await createStaffAndLogin(app, ['readonly']);
    expect((await request(server).post(`/v1/admin/rides/${ride.id}/interrupt`).set(bearer(readonly.tokens)).send({ reason: 'Accident' })).status).toBe(403);
    const done = await request(server).post(`/v1/admin/rides/${ride.id}/interrupt`).set(bearer(operator.tokens)).send({ reason: 'Accrochage sans blessé, client raccompagné', incidentType: 'accident' }).expect(200);
    expect(done.body.state).toBe('interrupted');
    const [incident] = await db(app).select().from(schema.incidents).where(eq(schema.incidents.id, done.body.incidentId));
    expect(incident).toMatchObject({ rideId: ride.id, type: 'accident', severity: 'high', reportedByKind: 'operator', status: 'open' });
    await until(payment, (rows) => rows[0]?.status === 'cancelled', 'autorisation levée');
    expect(await db(app).select().from(schema.invoices).where(eq(schema.invoices.rideId, ride.id))).toHaveLength(0);
    const notices = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, client.user.id), eq(schema.notifications.template, 'ride.interrupted')));
    expect(notices).not.toHaveLength(0);
    // Plus aucune action du chauffeur sur la course.
    expect((await request(server).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 100, measuredDurationSeconds: 60 })).status).toBe(409);
    // Rejouée : même incident, pas de doublon.
    const again = await request(server).post(`/v1/admin/rides/${ride.id}/interrupt`).set(bearer(operator.tokens)).send({ reason: 'Accrochage sans blessé, client raccompagné', incidentType: 'accident' }).expect(200);
    expect(again.body.incidentId).toBe(done.body.incidentId);
  });
});
