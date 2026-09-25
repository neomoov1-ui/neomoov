import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ScheduledService } from '../src/modules/rides/scheduled.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };

describe('réservation planifiée avec horloge simulée (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('rappel J-1, déclenchement à 60 minutes, alerte à 30 minutes, proposition et confirmation du chauffeur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const rival = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['admin']);
    const scheduled = app.get(ScheduledService);
    const now = new Date();
    const requestedAt = new Date(now.getTime() + 26 * 3_600_000);
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: requestedAt.toISOString() }).expect(201)).body.quotes[0];
    const ride = (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `sched-${Date.now()}`).send({ quoteId: quote.id, type: 'scheduled', requestedAt: requestedAt.toISOString(), paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body;
    expect(ride.type).toBe('scheduled');
    const at = (minutesBefore: number) => new Date(requestedAt.getTime() - minutesBefore * 60_000);

    // Trop tôt : rien.
    const early = await scheduled.tick(now);
    expect(early.reminders).not.toContain(ride.id);
    // J-1 : rappel, une seule fois.
    const reminder = await scheduled.tick(at(23 * 60 + 50));
    expect(reminder.reminders).toContain(ride.id);
    expect((await scheduled.tick(at(23 * 60 + 40))).reminders).not.toContain(ride.id);
    const reminderNotification = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, client.user.id), eq(schema.notifications.template, 'ride.scheduled_reminder')));
    expect(reminderNotification).toHaveLength(1);

    // Un chauffeur se propose ; un second est refusé.
    const listed = await request(server()).get('/v1/driver/scheduled').set(bearer(driver.tokens)).expect(200);
    expect(listed.body.map((r: { id: string }) => r.id)).toContain(ride.id);
    const claim = await request(server()).post(`/v1/driver/scheduled/${ride.id}/claim`).set(bearer(driver.tokens)).expect(200);
    expect(claim.body.status).toBe('proposed');
    const rivalClaim = await request(server()).post(`/v1/driver/scheduled/${ride.id}/claim`).set(bearer(rival.tokens));
    expect(rivalClaim.status).toBe(409);
    expect(rivalClaim.body.code).toBe('RIDE_ALREADY_CLAIMED');
    const withAssignment = await request(server()).get('/v1/driver/scheduled').set(bearer(driver.tokens)).expect(200);
    expect(withAssignment.body.find((r: { id: string }) => r.id === ride.id).assignment.confirmedAt).toBeNull();

    // 60 minutes avant : attribution à déclencher (aucun chauffeur confirmé).
    const dispatch = await scheduled.tick(at(55));
    expect(dispatch.dispatchDue).toContain(ride.id);
    expect(dispatch.operatorAlerts).not.toContain(ride.id);
    // 30 minutes avant, toujours pas confirmé : alerte opérateur, une seule fois.
    const alert = await scheduled.tick(at(25));
    expect(alert.operatorAlerts).toContain(ride.id);
    expect((await scheduled.tick(at(24))).operatorAlerts).not.toContain(ride.id);
    const staffAlert = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, admin.userId), eq(schema.notifications.template, 'alert.scheduled_unconfirmed')));
    expect(staffAlert.length).toBeGreaterThan(0);
    const [assignment] = await db(app).select().from(schema.scheduledAssignments).where(eq(schema.scheduledAssignments.rideId, ride.id));
    expect(assignment!.operatorAlertedAt).not.toBeNull();

    // Le chauffeur confirme : la course lui est attribuée par la machine à états.
    const confirmed = await request(server()).post(`/v1/driver/scheduled/${ride.id}/confirm`).set(bearer(driver.tokens)).expect(200);
    expect(confirmed.body.state).toBe('assigned');
    expect(confirmed.body.driver.id).toBe(driver.driverId);
    const [confirmedAssignment] = await db(app).select().from(schema.scheduledAssignments).where(eq(schema.scheduledAssignments.rideId, ride.id));
    expect(confirmedAssignment!.confirmedAt).not.toBeNull();
    const journal = await request(server()).get(`/v1/rides/${ride.id}/events`).set(bearer(client)).expect(200);
    const types = journal.body.map((e: { type: string }) => e.type);
    for (const t of ['scheduled_reminder', 'scheduled_dispatch_due', 'scheduled_operator_alert', 'scheduled_claimed', 'driver_accepts']) expect(types.filter((x: string) => x === t)).toHaveLength(1);

    // Passe manuelle depuis My Hub.
    const manual = await request(server()).post('/v1/admin/rides/scheduled/tick').set(bearer(admin.tokens)).send({ now: at(10).toISOString() }).expect(200);
    expect(manual.body.operatorAlerts).not.toContain(ride.id);
    const declined = await request(server()).post(`/v1/driver/scheduled/${ride.id}/decline`).set(bearer(rival.tokens)).expect(204);
    expect(declined.status).toBe(204);
  });
});
