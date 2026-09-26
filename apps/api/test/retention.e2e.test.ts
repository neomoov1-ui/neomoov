import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANONYMIZED_ADDRESS, RetentionService } from '../src/modules/retention/retention.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const DAY = 86_400_000;

describe('durées de conservation (Loi 25, intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const retention = () => app!.get(RetentionService);

  it('sans sauvegarde vérifiée depuis moins de 26 heures, aucune purge : le blocage est journalisé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await retention().confirmBackup(new Date(Date.now() - 3 * DAY), 'Essai : sauvegarde ancienne');
    const results = await retention().run();
    expect(results).toEqual([expect.objectContaining({ type: 'blocked_no_backup', rowsProcessed: 0 })]);
    const [last] = await db(app).select().from(schema.retentionJobs).orderBy(desc(schema.retentionJobs.executedAt)).limit(1);
    expect(last).toMatchObject({ type: 'blocked_no_backup', rowsProcessed: 0 });
  });

  it('après une sauvegarde vérifiée : positions, courses, documents et journal au-delà de leur durée, chaque tâche journalisée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['admin']);
    await request(server()).post('/v1/admin/retention/backup-verified').set(bearer(admin.tokens)).send({ note: 'Restauration testée sur la copie de secours' }).expect(200);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const now = new Date();

    // Positions : une partition journalière de 200 jours et une ligne de la partition par défaut de 100 jours.
    const oldDay = new Date(now.getTime() - 200 * DAY).toISOString().slice(0, 10);
    const [partition] = await db(app).execute<{ name: string }>(sql`SELECT ensure_driver_locations_partition(${oldDay}::date) AS name`);
    await db(app).execute(sql`INSERT INTO driver_locations (driver_id, position, recorded_at) VALUES (${driver.driverId}::uuid, ST_GeogFromText('POINT(-73.58 45.52)'), ${`${oldDay}T12:00:00Z`}::timestamptz)`);
    await db(app).execute(sql`INSERT INTO driver_locations (driver_id, position, recorded_at) VALUES (${driver.driverId}::uuid, ST_GeogFromText('POINT(-73.58 45.52)'), ${new Date(now.getTime() - 100 * DAY).toISOString()}::timestamptz)`);
    await db(app).execute(sql`INSERT INTO driver_locations (driver_id, position, recorded_at) VALUES (${driver.driverId}::uuid, ST_GeogFromText('POINT(-73.58 45.52)'), ${now.toISOString()}::timestamptz)`);

    // Course de plus de 12 mois (vieillie) et course récente du même client.
    const client = await loginByOtp(app);
    const book = async (hours: number) => {
      const requestedAt = new Date(now.getTime() + hours * 3_600_000).toISOString();
      const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
      return (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `ret-${Math.random().toString(36).slice(2)}`)
        .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents, specialRequests: 'Code de porte 1234' }).expect(201)).body.id as string;
    };
    const oldRide = await book(4);
    const recentRide = await book(6);
    await db(app).update(schema.rides).set({ createdAt: new Date(now.getTime() - 400 * DAY), passengerName: 'Tiers', passengerPhone: '+19995550177' }).where(eq(schema.rides.id, oldRide));
    await db(app).insert(schema.rideMessages).values({ rideId: oldRide, senderUserId: client.user.id, senderKind: 'client', body: 'Je suis au 3e étage' });

    // Chauffeur parti il y a 13 mois : ses documents disparaissent.
    await db(app).update(schema.drivers).set({ status: 'offboarded', offboardedAt: new Date(now.getTime() - 400 * DAY) }).where(eq(schema.drivers.id, driver.driverId));

    // Journal d'audit de plus de 7 ans.
    const [oldAudit] = await db(app).insert(schema.auditLog).values({ action: 'test.retention', entity: 'tests', occurredAt: new Date(now.getTime() - 8 * 366 * DAY) }).returning();

    const results = await retention().run(now);
    const byType = Object.fromEntries(results.map((r) => [r.type, r]));
    expect(Object.keys(byType).sort()).toEqual(['audit_log', 'driver_documents', 'driver_locations', 'invoices', 'ride_anonymization']);
    expect(byType['driver_locations']!.details).toMatchObject({ retentionDays: 90 });
    expect(byType['driver_locations']!.details['partitionsDropped']).toContain(partition!.name);
    expect(byType['driver_locations']!.details['defaultRowsDeleted']).toBeGreaterThanOrEqual(1);
    const locations = await db(app).execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM driver_locations WHERE driver_id = ${driver.driverId}::uuid`);
    expect(Number(locations[0]!.n)).toBe(1);

    const [anonymized] = await db(app).select().from(schema.rides).where(eq(schema.rides.id, oldRide));
    expect(anonymized).toMatchObject({ originAddress: ANONYMIZED_ADDRESS, destinationAddress: ANONYMIZED_ADDRESS, passengerName: null, passengerPhone: null, specialRequests: null });
    expect(anonymized!.quotedTotalCents).toBeGreaterThan(0);
    expect(await db(app).select().from(schema.rideMessages).where(eq(schema.rideMessages.rideId, oldRide))).toHaveLength(0);
    const [recent] = await db(app).select().from(schema.rides).where(eq(schema.rides.id, recentRide));
    expect(recent!.originAddress).toBe(PLATEAU.address);
    expect(recent!.specialRequests).toBe('Code de porte 1234');

    expect(await db(app).select().from(schema.driverDocuments).where(eq(schema.driverDocuments.driverId, driver.driverId))).toHaveLength(0);
    expect(await db(app).select().from(schema.auditLog).where(eq(schema.auditLog.id, oldAudit!.id))).toHaveLength(0);
    expect(byType['ride_anonymization']!.rowsProcessed).toBeGreaterThanOrEqual(1);

    const jobs = await request(server()).get('/v1/admin/retention/jobs').set(bearer(admin.tokens)).expect(200);
    expect(jobs.body.slice(0, 5).map((j: { type: string }) => j.type).sort()).toEqual(['audit_log', 'driver_documents', 'driver_locations', 'invoices', 'ride_anonymization']);
    // Rejouée : plus rien à traiter.
    const again = await retention().run(now);
    expect(again.find((r) => r.type === 'ride_anonymization')!.rowsProcessed).toBe(0);
    expect((await request(server()).post('/v1/admin/retention/run').set(bearer(client))).status).toBe(403);
    await db(app).update(schema.drivers).set({ status: 'active' }).where(and(eq(schema.drivers.id, driver.driverId)));
  });
});
