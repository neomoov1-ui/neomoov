import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QualityAgent } from '../src/modules/agents/quality.agent.js';
import { driverEligible } from '../src/modules/rides/eligibility.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

/** Sanctions graduées (5.11, prompt 14 tâche 2) avec données synthétiques : notes, annulations tardives, incidents graves. */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const key = () => `qual-${Math.random().toString(36).slice(2, 14)}`;
const DAY = 86_400_000;

describe('agent qualité : sanctions graduées (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let operator: StaffSession;
  const server = () => app!.getHttpServer();
  const runIds = new Set<string>();
  let hour = 3;

  beforeAll(async () => {
    app = await startTestApp();
    if (app) operator = await createStaffAndLogin(app, ['operator']);
  });
  afterAll(async () => {
    if (app) {
      const ids = [...runIds];
      if (ids.length) {
        await db(app).delete(schema.approvals).where(inArray(schema.approvals.agentRunId, ids));
        await db(app).delete(schema.agentRuns).where(inArray(schema.agentRuns.id, ids));
      }
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const quality = () => app!.get(QualityAgent);
  const run = async (driverIds: string[], ref: string | null = null) => {
    const execution = await quality().run(new Date(), { ref, onlyDriverIds: driverIds });
    if (execution.run) runIds.add(execution.run.id);
    return execution;
  };
  const statusOf = async (driverId: string) => (await db(app!).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driverId)))[0]!.status;
  const pendingFor = (driverId: string) => db(app!).select().from(schema.approvals).where(and(eq(schema.approvals.proposedAction, 'proposeSanction'), eq(schema.approvals.decision, 'pending'), sql`${schema.approvals.data}->>'driverId' = ${driverId}`));

  /** Courses terminées par ce chauffeur, notées par le client (notes données dans l'ordre). */
  async function rated(client: { accessToken: string }, driver: TestDriver, scores: number[]): Promise<string[]> {
    const ids: string[] = [];
    for (const score of scores) {
      hour += 2;
      const requestedAt = new Date(Date.now() + hour * 3_600_000).toISOString();
      const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
      const ride = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
        .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201);
      const rideId = ride.body.id as string;
      await db(app!).update(schema.rides).set({ state: 'rated', driverId: driver.driverId }).where(eq(schema.rides.id, rideId));
      const [clientRow] = await db(app!).select({ userId: schema.clients.userId }).from(schema.clients).innerJoin(schema.rides, eq(schema.rides.clientId, schema.clients.id)).where(eq(schema.rides.id, rideId));
      await db(app!).insert(schema.rideRatings).values({ rideId, authorKind: 'client', authorUserId: clientRow!.userId, score });
      ids.push(rideId);
    }
    return ids;
  }

  it('propositions : restriction sur la note, restriction sur les annulations tardives, suspension sur les incidents, avertissement ; aucune en double', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const low = await createDriver(app);
    const canceller = await createDriver(app);
    const incidents = await createDriver(app);
    const average = await createDriver(app);
    const good = await createDriver(app);
    await rated(client, low, [5, 4, 4, 4, 4, 5, 4, 4, 4, 5, 4, 5]); // 4,33 sur 12
    await rated(client, average, [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4]); // 4,50 sur 12
    await rated(client, good, [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]);
    const [cancelRide] = await rated(client, canceller, [5]);
    const lateAt = new Date(Date.now() - DAY).toISOString();
    for (let i = 0; i < 3; i += 1) {
      await db(app).insert(schema.rideEvents).values({ rideId: cancelRide!, type: 'driver_cancels', fromState: 'en_route', toState: 'requested', actorUserId: canceller.userId, actorKind: 'driver', occurredAt: new Date(lateAt) });
    }
    const [incidentRide] = await rated(client, incidents, [5]);
    await db(app).insert(schema.incidents).values([1, 2, 3].map((n) => ({ rideId: incidentRide!, type: 'complaint' as const, severity: 'high' as const, reportedByKind: 'client', description: `Plainte ${n}` })));
    // Un incident signalé par le chauffeur lui-même ne compte pas.
    await db(app).insert(schema.incidents).values({ rideId: incidentRide!, type: 'complaint', severity: 'critical', reportedByKind: 'driver', description: 'Client agressif' });

    const drivers = [low, canceller, incidents, average, good].map((d) => d.driverId);
    const first = await run(drivers);
    expect(first.result).toMatchObject({ evaluated: 5, proposed: 4 });
    const expectPending = async (driver: TestDriver, type: string, reason: string) => {
      const rows = await pendingFor(driver.driverId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.data).toMatchObject({ type, reasons: expect.arrayContaining([reason]) });
      expect(rows[0]!.justification).toMatch(/^Qualité : /);
      return rows[0]!;
    };
    const restriction = await expectPending(low, 'restriction', 'rating_below_restriction');
    await expectPending(canceller, 'restriction', 'late_cancellations');
    const suspension = await expectPending(incidents, 'suspension', 'serious_incidents');
    const warning = await expectPending(average, 'warning', 'rating_below_warning');
    expect(await pendingFor(good.driverId)).toHaveLength(0);
    // Relancée : les propositions en attente couvrent déjà chaque chauffeur.
    expect((await run(drivers)).result).toMatchObject({ proposed: 0 });

    const review = await request(server()).get('/v1/admin/quality').set(bearer(operator.tokens)).expect(200);
    const lowView = (review.body as Array<{ driverId: string }>).find((r) => r.driverId === low.driverId);
    expect(lowView).toMatchObject({ metrics: { ratingAverage: 4.33, ratingCount: 12 }, proposal: { type: 'restriction' }, covered: 'restriction', pendingApproval: true });

    // Restriction approuvée : chauffeur restreint, en ligne possible, écarté des seules courses VIP, aéroport et entreprise.
    await request(server()).post(`/v1/admin/approvals/${restriction.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(await statusOf(low.driverId)).toBe('restricted');
    const [sanction] = await db(app).select().from(schema.sanctions).where(and(eq(schema.sanctions.driverId, low.driverId), eq(schema.sanctions.type, 'restriction')));
    expect(sanction!.endsAt!.getTime()).toBeGreaterThan(Date.now() + 13 * DAY);
    const notice = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, low.userId), eq(schema.notifications.template, 'quality.restriction')));
    expect(notice).not.toHaveLength(0);
    await request(server()).post('/v1/driver/status').set(bearer(low.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates }).expect(200);
    await request(server()).post('/v1/driver/status').set(bearer(low.tokens)).send({ status: 'offline' }).expect(200);
    const rules = { requiredDocuments: ['licence', 'insurance', 'registration'], requireActivePack: false };
    const eligible = async (premiumContext: boolean) => (await db(app!).execute<{ id: string }>(sql`SELECT d.id FROM drivers d WHERE d.id = ${low.driverId}::uuid AND ${driverEligible(rules, undefined, { premiumContext })}`)).length;
    expect(await eligible(false)).toBe(1);
    expect(await eligible(true)).toBe(0);

    // Suspension approuvée ; avertissement refusé avec motif.
    await request(server()).post(`/v1/admin/approvals/${suspension.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(await statusOf(incidents.driverId)).toBe('suspended');
    await request(server()).post(`/v1/admin/approvals/${warning.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'rejected', note: 'Note remontée depuis' }).expect(200);
    expect(await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.driverId, average.driverId))).toHaveLength(0);

    // Échéance : la suspension de qualité passée, le chauffeur redevient actif ; la restriction en cours reste.
    await db(app).update(schema.sanctions).set({ endsAt: new Date(Date.now() - 60_000) }).where(and(eq(schema.sanctions.driverId, incidents.driverId), eq(schema.sanctions.type, 'suspension')));
    expect(await quality().expire(new Date())).toBeGreaterThanOrEqual(1);
    expect(await statusOf(incidents.driverId)).toBe('active');
    expect(await statusOf(low.driverId)).toBe('restricted');
    const back = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, incidents.userId), eq(schema.notifications.template, 'quality.reinstated')));
    expect(back).not.toHaveLength(0);
  });

  it('mode automatique : sanction appliquée sans file ; passe quotidienne unique par référence', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    await rated(client, driver, [5, 4, 5, 4, 5, 4, 5, 4, 5, 4, 5, 4]);
    await db(app).update(schema.agents).set({ mode: 'auto' }).where(eq(schema.agents.code, 'quality'));
    try {
      const ref = key();
      const executed = await run([driver.driverId], ref);
      expect(executed.result).toMatchObject({ proposed: 1 });
      expect(await pendingFor(driver.driverId)).toHaveLength(0);
      const [sanction] = await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.driverId, driver.driverId));
      expect(sanction).toMatchObject({ type: 'warning', endsAt: null, decidedByUserId: null });
      expect(await statusOf(driver.driverId)).toBe('active');
      // Même référence (même jour) : rien n'est refait.
      expect((await run([driver.driverId], ref)).replayed).toBe(true);
      // Avertissement récent : pas de nouvel avertissement le lendemain.
      expect((await run([driver.driverId], key())).result).toMatchObject({ proposed: 0 });
    } finally {
      await db(app).update(schema.agents).set({ mode: 'approval' }).where(eq(schema.agents.code, 'quality'));
    }
  });
});
