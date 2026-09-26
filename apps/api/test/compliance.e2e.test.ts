import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ComplianceService } from '../src/modules/compliance/compliance.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, startTestApp, type StaffSession } from './helpers.js';

const PLATEAU = { lat: 45.523, lng: -73.582 };

describe('conformité des chauffeurs et des véhicules (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let staff: StaffSession;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (app) staff = await createStaffAndLogin(app, ['operator']);
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const compliance = () => app!.get(ComplianceService);
  const templates = async (userId: string) => (await db(app!).select().from(schema.notifications).where(eq(schema.notifications.recipientUserId, userId))).map((n) => `${n.template}:${n.channel}`);
  /** Instant à Montréal (UTC-4 en octobre). */
  const montreal = (day: string, time: string) => new Date(`${day}T${time}:00-04:00`);

  it('permis échu : rappels J-30, J-7, J-1, suspension à minuit, réactivation à l\'approbation du nouveau permis', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.driverDocuments).set({ expiresOn: '2026-10-20' }).where(and(eq(schema.driverDocuments.driverId, driver.driverId), eq(schema.driverDocuments.type, 'licence')));

    expect((await compliance().run(montreal('2026-09-20', '09:00'), driver.driverId)).reminders).toBe(1);
    expect((await compliance().run(montreal('2026-09-21', '09:00'), driver.driverId)).reminders).toBe(0);
    expect((await compliance().run(montreal('2026-10-13', '09:00'), driver.driverId)).reminders).toBe(1);
    expect((await compliance().run(montreal('2026-10-19', '09:00'), driver.driverId)).reminders).toBe(1);
    const reminders = (await templates(driver.userId)).filter((t) => t.startsWith('document.expiring'));
    // Trois rappels, chacun par push, courriel et texto (matrice 5.14).
    expect(reminders).toHaveLength(9);

    // Valide toute la journée du 20 ; suspendu à minuit.
    expect((await compliance().run(montreal('2026-10-20', '23:30'), driver.driverId)).suspended).toBe(0);
    expect((await compliance().run(montreal('2026-10-21', '00:05'), driver.driverId)).suspended).toBe(1);
    const [suspended] = await db(app).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
    expect(suspended!.status).toBe('suspended');
    const [sanction] = await db(app).select().from(schema.sanctions).where(and(eq(schema.sanctions.driverId, driver.driverId), isNull(schema.sanctions.endsAt)));
    expect(sanction).toMatchObject({ type: 'suspension', reason: 'Conformité : permis de conduire échu le 2026-10-20', decidedByUserId: null });
    expect(await templates(driver.userId)).toContain('compliance.suspended:sms');
    const refused = await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU });
    expect(refused.body.details.reasons).toEqual(expect.arrayContaining(['driver_status:suspended', 'suspended']));
    const overdue = await request(server()).get('/v1/admin/compliance').query({ status: 'overdue' }).set(bearer(staff.tokens)).expect(200);
    expect(overdue.body.find((c: { entityId: string }) => c.entityId === driver.driverId)).toMatchObject({ type: 'document:licence', label: 'permis de conduire', dueOn: '2026-10-20', status: 'overdue' });
    // Rejouée, la passe ne suspend pas deux fois.
    expect((await compliance().run(montreal('2026-10-22', '00:05'), driver.driverId)).suspended).toBe(0);

    // Nouveau permis déposé puis approuvé : réactivation automatique, sans autre action.
    const [renewed] = await db(app).insert(schema.driverDocuments).values({ driverId: driver.driverId, type: 'licence', fileKey: `test/${driver.driverId}/licence-2`, status: 'pending', expiresOn: '2031-05-01' }).returning();
    await request(server()).post(`/v1/admin/documents/${renewed!.id}/review`).set(bearer(staff.tokens)).send({ decision: 'approved', expiresOn: '2031-05-01' }).expect(200);
    const [back] = await db(app).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driver.driverId));
    expect(back!.status).toBe('active');
    expect(await db(app).select().from(schema.sanctions).where(and(eq(schema.sanctions.driverId, driver.driverId), isNull(schema.sanctions.endsAt)))).toHaveLength(0);
    expect(await templates(driver.userId)).toContain('compliance.reactivated:push');
    const mine = await request(server()).get('/v1/driver/compliance').set(bearer(driver.tokens)).expect(200);
    expect(mine.body.find((c: { type: string }) => c.type === 'document:licence')).toMatchObject({ dueOn: '2031-05-01', status: 'pending' });
    await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU }).expect(200);
    await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'offline' }).expect(200);
  });

  it('véhicule : vérification mécanique exigée (plus de 4 ans), inspection trimestrielle de Neomoov réussie ou échouée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.vehicles).set({ year: 2019, odometerKm: 140_000 }).where(eq(schema.vehicles.id, driver.vehicleId));
    const now = new Date();
    expect((await compliance().run(now, driver.driverId)).suspended).toBeGreaterThanOrEqual(1);
    const vehicleStatus = async () => (await db(app!).select({ status: schema.vehicles.status }).from(schema.vehicles).where(eq(schema.vehicles.id, driver.vehicleId)))[0]!.status;
    expect(await vehicleStatus()).toBe('non_compliant');
    expect(await templates(driver.userId)).toContain('compliance.suspended:push');

    // Certificat de vérification mécanique approuvé : le véhicule redevient conforme.
    const [certificate] = await db(app).insert(schema.driverDocuments).values({ driverId: driver.driverId, type: 'mechanical_check', fileKey: `test/${driver.driverId}/mechanical`, status: 'pending', expiresOn: '2027-09-01' }).returning();
    await request(server()).post(`/v1/admin/documents/${certificate!.id}/review`).set(bearer(staff.tokens)).send({ decision: 'approved', expiresOn: '2027-09-01' }).expect(200);
    expect(await vehicleStatus()).toBe('active');

    // Inspection trimestrielle : dépassée trois mois plus tard, puis enregistrée réussie, puis échouée.
    const later = new Date(now.getTime() + 95 * 86_400_000);
    await compliance().run(later, driver.driverId);
    expect(await vehicleStatus()).toBe('non_compliant');
    const inspectedOn = later.toISOString().slice(0, 10);
    const passed = await request(server()).post(`/v1/admin/compliance/vehicles/${driver.vehicleId}/inspections`).set(bearer(staff.tokens)).send({ inspectedOn, passed: true, odometerKm: 142_500 }).expect(200);
    expect(passed.body).toMatchObject({ status: 'active' });
    expect(passed.body.nextInspectionDueOn > inspectedOn).toBe(true);
    const failed = await request(server()).post(`/v1/admin/compliance/vehicles/${driver.vehicleId}/inspections`).set(bearer(staff.tokens)).send({ inspectedOn, passed: false, notes: 'Pneus usés' }).expect(200);
    expect(failed.body).toMatchObject({ status: 'non_compliant', nextInspectionDueOn: null });
    expect((await request(server()).post(`/v1/admin/compliance/vehicles/${driver.vehicleId}/inspections`).set(bearer(driver.tokens)).send({ inspectedOn, passed: true })).status).toBe(403);
  });
});
