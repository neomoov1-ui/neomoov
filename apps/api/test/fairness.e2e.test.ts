import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FairnessService } from '../src/modules/fairness/fairness.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type StaffSession } from './helpers.js';

/** Charte d'équité (D7) : réponse et appel du chauffeur, décision par une autre personne, exclusion d'une note, alertes de délai. */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const HOUR = 3_600_000;
const key = () => `fair-${Math.random().toString(36).slice(2, 14)}`;

describe('Charte d\'équité chauffeurs (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let first: StaffSession;
  let second: StaffSession;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (app) [first, second] = await Promise.all([createStaffAndLogin(app, ['operator']), createStaffAndLogin(app, ['operator'])]);
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const statusOf = async (driverId: string) => (await db(app!).select({ status: schema.drivers.status }).from(schema.drivers).where(eq(schema.drivers.id, driverId)))[0]!.status;
  const markers = async (action: string, entityId: string) => (await db(app!).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, entityId)))).length;

  it('réponse et appel : une demande ouverte à la fois, appel tranché par une autre personne, sanction levée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const [sanction] = await db(app).insert(schema.sanctions).values({ driverId: driver.driverId, type: 'restriction', reason: 'Qualité : Restriction proposée : note de 4.30', startsAt: new Date(), endsAt: new Date(Date.now() + 14 * 24 * HOUR), decidedByUserId: first.userId }).returning();
    await db(app).update(schema.drivers).set({ status: 'restricted' }).where(eq(schema.drivers.id, driver.driverId));

    const mine = await request(server()).get('/v1/driver/sanctions').set(bearer(driver.tokens)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ id: sanction!.id, type: 'restriction', active: true, decidedByPerson: true, appeals: [] });

    const sent = await request(server()).post(`/v1/driver/sanctions/${sanction!.id}/appeals`).set(bearer(driver.tokens)).send({ kind: 'appeal', message: 'Les notes basses viennent de la circulation du pont Jacques-Cartier.' }).expect(201);
    expect(sent.body.appeals).toHaveLength(1);
    expect(sent.body.appeals[0]).toMatchObject({ kind: 'appeal', status: 'open' });
    const again = await request(server()).post(`/v1/driver/sanctions/${sanction!.id}/appeals`).set(bearer(driver.tokens)).send({ kind: 'response', message: 'Je complète ma demande avec un détail.' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('APPEAL_ALREADY_OPEN');
    // Une sanction d'un autre chauffeur est introuvable pour lui.
    const other = await createDriver(app);
    expect((await request(server()).post(`/v1/driver/sanctions/${sanction!.id}/appeals`).set(bearer(other.tokens)).send({ kind: 'appeal', message: 'Ce n\'est pas ma sanction.' })).status).toBe(404);

    const list = await request(server()).get('/v1/admin/fairness/appeals?status=open').set(bearer(first.tokens)).expect(200);
    const appeal = (list.body as Array<{ id: string; sanctionId: string; overdue: boolean }>).find((a) => a.sanctionId === sanction!.id)!;
    expect(appeal.overdue).toBe(false);

    const same = await request(server()).post(`/v1/admin/fairness/appeals/${appeal.id}/decide`).set(bearer(first.tokens)).send({ decision: 'upheld', note: 'Je maintiens ma décision.' });
    expect(same.status).toBe(403);
    expect(same.body.code).toBe('SAME_DECIDER');
    const decided = await request(server()).post(`/v1/admin/fairness/appeals/${appeal.id}/decide`).set(bearer(second.tokens)).send({ decision: 'overturned', note: 'Retards dus aux travaux du pont, établis.' }).expect(200);
    expect(decided.body).toMatchObject({ status: 'overturned', decisionNote: 'Retards dus aux travaux du pont, établis.' });
    expect(await statusOf(driver.driverId)).toBe('active');
    const [after] = await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.id, sanction!.id));
    expect(after!.endsAt!.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await request(server()).post(`/v1/admin/fairness/appeals/${appeal.id}/decide`).set(bearer(second.tokens)).send({ decision: 'upheld', note: 'Deuxième décision.' })).status).toBe(409);
    const notices = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, driver.userId), eq(schema.notifications.template, 'fairness.appeal_decided')));
    expect(notices).not.toHaveLength(0);
  });

  it('alertes : blocage de précaution sans décision après 24 heures, demande sans décision après 4 heures ouvrables ; une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const [hold] = await db(app).insert(schema.sanctions).values({ driverId: driver.driverId, type: 'suspension', reason: 'Sécurité : plainte sur la course NM-TEST, en attente de décision', startsAt: new Date(Date.now() - 25 * HOUR) }).returning();
    const [recent] = await db(app).insert(schema.sanctions).values({ driverId: driver.driverId, type: 'suspension', reason: 'Sécurité : SOS sur la course NM-TEST2, en attente de décision', startsAt: new Date(Date.now() - 2 * HOUR) }).returning();
    const [late] = await db(app).insert(schema.sanctionAppeals).values({ sanctionId: hold!.id, driverId: driver.driverId, kind: 'response', message: 'Le client était agressif, je suis parti.', createdAt: new Date(Date.now() - 10 * 24 * HOUR) }).returning();
    const fairness = app.get(FairnessService);
    await fairness.alertOverdue(new Date());
    await fairness.alertOverdue(new Date());
    expect(await markers('alert.precautionary_review_overdue', hold!.id)).toBe(1);
    expect(await markers('alert.precautionary_review_overdue', recent!.id)).toBe(0);
    expect(await markers('alert.appeal_overdue', late!.id)).toBe(1);
    const list = await request(server()).get('/v1/admin/fairness/appeals').set(bearer(first.tokens)).expect(200);
    expect((list.body as Array<{ id: string; overdue: boolean }>).find((a) => a.id === late!.id)?.overdue).toBe(true);
    // Réponse (et non appel) : la personne qui tranche peut être n'importe quel membre habilité.
    await request(server()).post(`/v1/admin/fairness/appeals/${late!.id}/decide`).set(bearer(first.tokens)).send({ decision: 'upheld', note: 'Blocage maintenu le temps de l\'enquête.' }).expect(200);
  });

  it('exclusion d\'une note par une personne : note du chauffeur recalculée, rejouable', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const ratingIds: string[] = [];
    for (const score of [5, 1]) {
      const requestedAt = new Date(Date.now() + (4 + ratingIds.length) * HOUR).toISOString();
      const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
      const ride = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
        .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201);
      await db(app).update(schema.rides).set({ state: 'rated', driverId: driver.driverId }).where(eq(schema.rides.id, ride.body.id));
      const [clientRow] = await db(app).select({ userId: schema.clients.userId }).from(schema.clients).innerJoin(schema.rides, eq(schema.rides.clientId, schema.clients.id)).where(eq(schema.rides.id, ride.body.id));
      const [rating] = await db(app).insert(schema.rideRatings).values({ rideId: ride.body.id, authorKind: 'client', authorUserId: clientRow!.userId, score }).returning({ id: schema.rideRatings.id });
      ratingIds.push(rating!.id);
    }
    // Notes du chauffeur dans My Hub : sans l'identité du client ; refusées au chauffeur ; chauffeur inconnu : 404.
    const before = await request(server()).get(`/v1/admin/drivers/${driver.driverId}/ratings`).set(bearer(first.tokens)).expect(200);
    expect(before.body).toHaveLength(2);
    expect(before.body.map((r: { id: string }) => r.id).sort()).toEqual([...ratingIds].sort());
    expect(before.body[0]).toMatchObject({ excludedAt: null, excludedReason: null, tags: [], ridePublicNumber: expect.any(String) });
    expect(before.body[0]).not.toHaveProperty('authorUserId');
    expect((await request(server()).get(`/v1/admin/drivers/${driver.driverId}/ratings`).set(bearer(driver.tokens))).status).toBe(403);
    expect((await request(server()).get('/v1/admin/drivers/00000000-0000-4000-8000-000000000000/ratings').set(bearer(first.tokens))).status).toBe(404);

    const excluded = await request(server()).post(`/v1/admin/ratings/${ratingIds[1]}/exclude`).set(bearer(first.tokens)).send({ reason: 'Client en retard de 20 minutes, établi' }).expect(200);
    expect(excluded.body.driverRating).toEqual({ average: 5, count: 1 });
    const after = await request(server()).get(`/v1/admin/drivers/${driver.driverId}/ratings`).set(bearer(first.tokens)).expect(200);
    expect((after.body as Array<{ id: string; excludedReason: string | null }>).find((r) => r.id === ratingIds[1])?.excludedReason).toBe('Client en retard de 20 minutes, établi');
    const replay = await request(server()).post(`/v1/admin/ratings/${ratingIds[1]}/exclude`).set(bearer(first.tokens)).send({ reason: 'Deuxième fois' }).expect(200);
    expect(replay.body.excludedAt).toBe(excluded.body.excludedAt);
    const [row] = await db(app).select().from(schema.rideRatings).where(eq(schema.rideRatings.id, ratingIds[1]!));
    expect(row).toMatchObject({ excludedReason: 'Client en retard de 20 minutes, établi', excludedByUserId: first.userId });
    expect((await request(server()).post(`/v1/admin/ratings/${ratingIds[1]}/exclude`).set(bearer(driver.tokens)).send({ reason: 'Je m\'exclus moi-même' })).status).toBe(403);
  });
});
