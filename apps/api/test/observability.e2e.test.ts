import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { adminMetricsSchema } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { CircuitBreakers } from '../src/common/circuit-breaker.js';
import { createLogger, currentCorrelationId, isValidCorrelationId } from '../src/common/logger.js';
import { JOB_CORRELATION_KEY, QUEUE_NAMES, QueueService } from '../src/infra/queue.module.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, testEnv } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };

describe('observabilité (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const lines: Array<Record<string, unknown>> = [];
  const jobs: unknown[] = [];
  let notificationId: string | null = null;

  beforeAll(async () => {
    const env = testEnv();
    if (!env) return;
    // Journal réel de l'API, écrit dans un tableau pour relire les lignes d'une requête.
    const logger = createLogger('api', 'info', { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
    const created = await createApp(env, logger);
    const queues = created.get(QueueService);
    queues.process('heartbeat', async (job) => {
      logger.info({ sonde: 'tâche' }, 'ligne écrite par la tâche');
      jobs.push(job.data);
    });
    // Sonde de test, montée après le middleware de corrélation comme toute route : une ligne de journal et une tâche.
    created.use('/v1/__sonde', (_req: Request, res: Response, next: NextFunction) => {
      logger.info({ sonde: 'requête' }, 'ligne écrite pendant la requête');
      queues.add('heartbeat', 'sonde', { n: 1 }).then(() => res.json({ correlationId: currentCorrelationId() }), next);
    });
    await created.init();
    app = created;
  });
  afterAll(async () => {
    if (app) {
      if (notificationId) await db(app).delete(schema.notifications).where(eq(schema.notifications.id, notificationId));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  it('identifiant de corrélation : repris du client, présent dans chaque ligne de la requête et de sa tâche, renvoyé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const res = await request(server).get('/v1/__sonde').set('x-correlation-id', 'mobile-abc123456').expect(200);
    expect(res.headers['x-correlation-id']).toBe('mobile-abc123456');
    expect(res.body.correlationId).toBe('mobile-abc123456');
    const probe = lines.filter((l) => l['sonde']);
    expect(probe.map((l) => l['sonde'])).toEqual(['requête', 'tâche']);
    for (const line of probe) expect(line['correlationId']).toBe('mobile-abc123456');
    expect(jobs).toEqual([{ n: 1, [JOB_CORRELATION_KEY]: 'mobile-abc123456' }]);

    // Sans en-tête, ou avec un en-tête invalide : l'API crée l'identifiant et le renvoie.
    const generated = await request(server).get('/v1/__sonde').expect(200);
    expect(isValidCorrelationId(generated.headers['x-correlation-id'])).toBe(true);
    expect(generated.body.correlationId).toBe(generated.headers['x-correlation-id']);
    const invalid = await request(server).get('/v1/__sonde').set('x-correlation-id', '<script>alert(1)</script>').expect(200);
    expect(invalid.headers['x-correlation-id']).not.toContain('<');
    // Les erreurs portent le même identifiant dans le corps et l'en-tête.
    const missing = await request(server).get('/v1/inexistant').set('x-correlation-id', 'web-hub-12345678').expect(404);
    expect(missing.body.correlationId).toBe('web-hub-12345678');
  });

  it('santé détaillée : version, environnement, base, Redis, files et disjoncteurs', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(typeof res.body.version).toBe('string');
    expect(res.body.environment).toBe('test');
    expect(res.body.checks.queues.stats).toHaveLength(QUEUE_NAMES.length);
    expect(Array.isArray(res.body.circuits)).toBe(true);
  });

  it('GET /v1/admin/metrics : courses, attribution, latences, files, paiements, fournisseurs ; personnel seulement', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const readonly = await createStaffAndLogin(app, ['readonly']);
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });

    // Deux courses planifiées attribuées 4 et 6 secondes après le début de leur répartition, première offre après 1,5 s.
    const book = async (hours: number) => {
      const requestedAt = new Date(Date.now() + hours * 3_600_000).toISOString();
      const quote = (await request(server).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0];
      return (await request(server).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `obs-${Math.random().toString(36).slice(2)}`)
        .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body.id as string;
    };
    const offeringAt = Date.now() - 10 * 60_000;
    const iso = (ms: number) => new Date(ms).toISOString();
    const rides = [await book(5), await book(6)];
    for (const [i, rideId] of rides.entries()) {
      const assignedAfter = i === 0 ? 4_000 : 6_000;
      await db(app).update(schema.rides).set({ state: 'assigned', driverId: driver.driverId, stateTimestamps: { requested: iso(offeringAt - 3_600_000), offering: iso(offeringAt), assigned: iso(offeringAt + assignedAfter) } }).where(eq(schema.rides.id, rideId));
      await db(app).insert(schema.rideOffers).values({ rideId, driverId: driver.driverId, driverFareCents: 2_000, state: 'declined', sentAt: new Date(offeringAt + 1_500), respondedAt: new Date(offeringAt + 3_000), expiresAt: new Date(offeringAt + 30_000) });
    }
    await db(app).insert(schema.payments).values({ rideId: rides[0]!, method: 'card_app', status: 'failed', failureCode: 'test_observabilite' });
    const [notification] = await db(app).insert(schema.notifications).values({ recipientUserId: client.user.id, channel: 'sms', template: 'test.observabilite', error: 'sms_test_observabilite' }).returning({ id: schema.notifications.id });
    notificationId = notification!.id;
    // Un fournisseur en panne : le disjoncteur s'ouvre.
    const circuit = app.get(CircuitBreakers).get('test.observabilite', { failureThreshold: 2, cooldownMs: 60_000 });
    for (let i = 0; i < 2; i += 1) await circuit.run(() => Promise.reject(new Error('panne simulée'))).catch(() => undefined);
    await request(server).get('/v1/health').expect(200);

    const res = await request(server).get('/v1/admin/metrics').set(bearer(readonly.tokens)).expect(200);
    const m = adminMetricsSchema.parse(res.body);
    expect(m.windowHours).toBe(24);
    expect(m.rides.byState.find((s) => s.state === 'assigned')).toMatchObject({ current: true });
    expect(m.rides.byState.find((s) => s.state === 'assigned')!.count).toBeGreaterThanOrEqual(2);
    expect(m.rides.assignmentSeconds.count).toBeGreaterThanOrEqual(2);
    expect(m.rides.assignmentSeconds.p50).not.toBeNull();
    expect(m.rides.assignmentSeconds.p95!).toBeGreaterThanOrEqual(m.rides.assignmentSeconds.p50!);
    expect(m.rides.firstOfferSeconds.count).toBeGreaterThanOrEqual(2);
    expect(m.api.routes.some((r) => r.method === 'GET' && r.route === '/v1/health')).toBe(true);
    expect(m.api.requests).toBeGreaterThan(0);
    expect(m.queues.mode).toBe('memory');
    expect(m.queues.items.map((q) => q.name)).toEqual([...QUEUE_NAMES]);
    expect(m.payments.failed).toBeGreaterThanOrEqual(1);
    expect(m.payments.byCode.map((c) => c.code)).toContain('test_observabilite');
    expect(m.providers.notificationErrors).toBeGreaterThanOrEqual(1);
    expect(m.providers.notificationErrorsByChannel.map((c) => c.channel)).toContain('sms');
    expect(m.providers.circuits.find((c) => c.name === 'test.observabilite')).toMatchObject({ state: 'open', totalFailures: 2, openings: 1 });

    expect((await request(server).get('/v1/admin/metrics').set(bearer(client))).status).toBe(403);
    expect((await request(server).get('/v1/admin/metrics')).status).toBe(401);
  });

  it('GET /v1/internal/metrics : format Prometheus, clé de service à portée metrics:read seulement', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const admin = await createStaffAndLogin(app, ['admin']);
    const key = (await request(server).post('/v1/admin/api-keys').set(bearer(admin.tokens)).send({ name: 'Sonde de métriques', scopes: ['metrics:read'] }).expect(201)).body.key as string;
    const other = (await request(server).post('/v1/admin/api-keys').set(bearer(admin.tokens)).send({ name: 'Rapports', scopes: ['reports:read'] }).expect(201)).body.key as string;

    const res = await request(server).get('/v1/internal/metrics').set({ Authorization: `Bearer ${key}` }).expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('# TYPE neomoov_rides gauge');
    expect(res.text).toMatch(/neomoov_queue_jobs\{queue="payments",state="failed"\} \d+/);
    expect(res.text).toContain('neomoov_http_request_duration_seconds_bucket{method="POST",route="/v1/admin/api-keys",le="+Inf"}');

    const denied = await request(server).get('/v1/internal/metrics').set({ Authorization: `Bearer ${other}` });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('INSUFFICIENT_SCOPE');
    const staff = await request(server).get('/v1/internal/metrics').set(bearer(admin.tokens));
    expect(staff.status).toBe(403);
    expect(staff.body.code).toBe('SERVICE_ACCOUNT_ONLY');
  });
});
