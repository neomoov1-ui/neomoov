import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { CircuitBreaker } from '../src/common/circuit-breaker.js';
import { DomainEventsService, type RideEventPayload } from '../src/common/domain-events.js';
import { errorReportingActive, initErrorReporting, releaseInfo, reportError, resetErrorReporting } from '../src/common/error-reporting.js';
import { HttpMetrics, httpMetricsMiddleware, LatencyHistogram, promLabel, routePattern } from '../src/common/http-metrics.js';
import { createLogger, currentCorrelationId, isValidCorrelationId, runWithCorrelation } from '../src/common/logger.js';
import { correlatedProcessor, JOB_CORRELATION_KEY, jobCorrelationId, QueueService, withJobCorrelation } from '../src/infra/queue.module.js';

/** Journal écrit dans un tableau : chaque ligne JSON est relue. */
function capturedLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const logger = createLogger('test', 'info', { write: (line: string) => lines.push(JSON.parse(line) as Record<string, unknown>) });
  return { logger, lines };
}

/** SDK Sentry simulé : aucune requête réseau, les appels sont gardés. */
function fakeSentry() {
  const calls = { init: [] as Array<Record<string, unknown>>, captured: [] as Array<{ error: unknown; context: { tags: Record<string, unknown>; extra?: unknown } }> };
  const integration = (name: string) => () => ({ name });
  const sdk = {
    initWithoutDefaultIntegrations: (options: Record<string, unknown>) => calls.init.push(options),
    eventFiltersIntegration: integration('EventFilters'), functionToStringIntegration: integration('FunctionToString'), linkedErrorsIntegration: integration('LinkedErrors'),
    dedupeIntegration: integration('Dedupe'), onUncaughtExceptionIntegration: integration('OnUncaughtException'), onUnhandledRejectionIntegration: integration('OnUnhandledRejection'),
    nodeContextIntegration: integration('Context'),
    captureException: (error: unknown, context: { tags: Record<string, unknown> }) => {
      calls.captured.push({ error, context });
      return 'evenement';
    },
    flush: async () => true,
  };
  return { calls, load: async () => sdk as never };
}

afterEach(() => resetErrorReporting());

describe('identifiant de corrélation dans le journal', () => {
  it('chaque ligne écrite dans le contexte porte l\'identifiant, une seule fois ; hors contexte, aucune', async () => {
    const { logger, lines } = capturedLogger();
    await runWithCorrelation('requete-abc12345', async () => {
      logger.info('avant une attente');
      await new Promise((resolve) => setTimeout(resolve, 5));
      logger.info({ correlationId: 'requete-abc12345', code: 'X' }, 'identifiant déjà présent');
    });
    logger.info('hors requête');
    expect(lines[0]).toMatchObject({ correlationId: 'requete-abc12345', msg: 'avant une attente' });
    expect(lines[1]).toMatchObject({ correlationId: 'requete-abc12345', code: 'X' });
    expect(lines[2]).not.toHaveProperty('correlationId');
  });

  it('un identifiant invalide ou absent est remplacé par un identifiant créé', () => {
    for (const bad of [undefined, '', 'court', 'avec espace 123456', 'x'.repeat(65), 42]) {
      runWithCorrelation(bad, () => {
        const id = currentCorrelationId();
        expect(isValidCorrelationId(id)).toBe(true);
        expect(id).not.toBe(bad);
      });
    }
    runWithCorrelation('Client_Mobile-0001', () => expect(currentCorrelationId()).toBe('Client_Mobile-0001'));
  });

  it('masque les secrets et les données personnelles au premier et au deuxième niveau, garde les codes d\'erreur', () => {
    const { logger, lines } = capturedLogger();
    logger.info({ phone: '+15145550123', email: 'a@b.ca', password: 'x', code: 'RIDE_NOT_FOUND', ride: { originAddress: '4500 rue Saint-Denis', lat: 45.5, id: 'r1' }, err: { code: '23505' } }, 'masquage');
    expect(lines[0]).toMatchObject({ phone: '[masqué]', email: '[masqué]', password: '[masqué]', code: 'RIDE_NOT_FOUND', ride: { originAddress: '[masqué]', lat: '[masqué]', id: 'r1' }, err: { code: '23505' } });
  });
});

describe('identifiant de corrélation dans les files de tâches', () => {
  it('une tâche ajoutée pendant une requête porte son identifiant et le traitement le retrouve (mode mémoire)', async () => {
    const queues = new QueueService(null, pino({ level: 'silent' }));
    const seen: Array<{ id: string | undefined; data: unknown }> = [];
    queues.process('exports', async (job) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push({ id: currentCorrelationId(), data: job.data });
    });
    await runWithCorrelation('requete-abc12345', () => queues.add('exports', 'csv', { a: 1 }));
    await queues.add('exports', 'csv', { b: 2 });
    expect(seen[0]).toEqual({ id: 'requete-abc12345', data: { a: 1, [JOB_CORRELATION_KEY]: 'requete-abc12345' } });
    // Hors requête (tâche planifiée) : un identifiant est créé, le même dans les données et dans le contexte du traitement.
    expect(isValidCorrelationId(seen[1]!.id)).toBe(true);
    expect((seen[1]!.data as Record<string, unknown>)[JOB_CORRELATION_KEY]).toBe(seen[1]!.id);
    await queues.onModuleDestroy();
  });

  it('données de tâche : objets complétés, identifiant existant gardé, autres valeurs inchangées', () => {
    runWithCorrelation('requete-abc12345', () => {
      expect(withJobCorrelation({ a: 1 })).toEqual({ a: 1, _correlationId: 'requete-abc12345' });
      expect(withJobCorrelation({ _correlationId: 'tache-0000000001' })).toEqual({ _correlationId: 'tache-0000000001' });
      expect(withJobCorrelation(null)).toBeNull();
      expect(withJobCorrelation('texte')).toBe('texte');
      expect(withJobCorrelation([1, 2])).toEqual([1, 2]);
    });
    expect(jobCorrelationId({ _correlationId: 'tache-0000000001' })).toBe('tache-0000000001');
    expect(jobCorrelationId({ _correlationId: 'mauvais id' })).toBeUndefined();
    expect(jobCorrelationId(undefined)).toBeUndefined();
  });

  it('traitement BullMQ : contexte de la tâche remis, échec signalé au suivi des erreurs à la dernière tentative seulement', async () => {
    const { calls, load } = fakeSentry();
    expect(await initErrorReporting({ dsn: 'https://cle-publique@exemple.invalid/1', service: 'worker', environment: 'test', release: '1.2.3', load })).toBe(true);
    const failing = correlatedProcessor('payments', async () => {
      expect(currentCorrelationId()).toBe('tache-abc12345');
      throw new Error('capture refusée');
    });
    const job = (attemptsMade: number) => ({ name: 'capture', data: { rideId: 'r1', _correlationId: 'tache-abc12345' }, opts: { attempts: 3 }, attemptsMade }) as never;
    await expect(failing(job(0))).rejects.toThrow('capture refusée');
    await expect(failing(job(1))).rejects.toThrow('capture refusée');
    expect(calls.captured).toHaveLength(0);
    await expect(failing(job(2))).rejects.toThrow('capture refusée');
    expect(calls.captured).toHaveLength(1);
    expect(calls.captured[0]!.context.tags).toEqual({ correlationId: 'tache-abc12345', queue: 'payments', job: 'capture' });
    const ok = correlatedProcessor('payments', async (j) => `fait ${String((j.data as { rideId: string }).rideId)}`);
    expect(await ok(job(0))).toBe('fait r1');
  });
});

describe('identifiant de corrélation dans les événements de domaine (Redis)', () => {
  class FakeRedis {
    published: string[] = [];
    private listeners: Array<(channel: string, message: string) => void> = [];
    duplicate() {
      return this;
    }
    async connect() {}
    async subscribe() {}
    async quit() {}
    on(_event: string, listener: (channel: string, message: string) => void) {
      this.listeners.push(listener);
      return this;
    }
    async publish(_channel: string, message: string) {
      this.published.push(message);
      return 1;
    }
    deliver(message: string) {
      for (const listener of this.listeners) listener('neomoov:events', message);
    }
  }

  it('l\'événement publié porte l\'identifiant de l\'émetteur ; l\'abonné d\'un autre processus s\'exécute dans ce contexte', async () => {
    const logger = pino({ level: 'silent' });
    const redisA = new FakeRedis();
    const redisB = new FakeRedis();
    const api = new DomainEventsService(logger, redisA as unknown as Redis);
    const worker = new DomainEventsService(logger, redisB as unknown as Redis);
    await api.onModuleInit();
    await worker.onModuleInit();
    const received: Array<string | undefined> = [];
    worker.on('ride.requested', () => {
      received.push(currentCorrelationId());
    });
    const payload = { rideId: 'r1', publicNumber: 'NM-1', clientId: null, clientUserId: null, driverId: null, driverUserId: null, fromState: null, toState: 'requested', event: 'requested', actor: { kind: 'system', userId: null }, occurredAt: new Date() } satisfies RideEventPayload;
    runWithCorrelation('requete-abc12345', () => api.emit('ride.requested', payload));
    expect(JSON.parse(redisA.published[0]!)).toMatchObject({ name: 'ride.requested', correlationId: 'requete-abc12345' });
    redisB.deliver(redisA.published[0]!);
    expect(received).toEqual(['requete-abc12345']);
    await api.onModuleDestroy();
    await worker.onModuleDestroy();
  });
});

describe('suivi des erreurs (Sentry)', () => {
  it('sans DSN : le SDK n\'est pas chargé, aucun envoi, aucune erreur', async () => {
    let loaded = false;
    const active = await initErrorReporting({ dsn: undefined, service: 'api', environment: 'test', release: '0.0.0', load: async () => { loaded = true; return {} as never; } });
    expect(active).toBe(false);
    expect(loaded).toBe(false);
    expect(errorReportingActive()).toBe(false);
    expect(() => reportError(new Error('rien'))).not.toThrow();
  });

  it('avec DSN : version, environnement, service ; aucune donnée personnelle collectée ; événements filtrés avant l\'envoi', async () => {
    const { calls, load } = fakeSentry();
    expect(await initErrorReporting({ dsn: 'https://cle-publique@exemple.invalid/1', service: 'api', environment: 'staging', release: '1.4.0', load })).toBe(true);
    expect(errorReportingActive()).toBe(true);
    const options = calls.init[0]!;
    expect(options).toMatchObject({ dsn: 'https://cle-publique@exemple.invalid/1', environment: 'staging', release: '1.4.0', initialScope: { tags: { service: 'api' } } });
    expect(options['dataCollection']).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false });
    const beforeSend = options['beforeSend'] as (event: Record<string, unknown>) => Record<string, unknown>;
    expect(beforeSend({ message: 'Échec pour awa@exemple.ca au +15145550123', user: { id: 'u1', email: 'awa@exemple.ca' } })).toEqual({ message: 'Échec pour [courriel] au [téléphone]', user: { id: 'u1' } });
    const beforeBreadcrumb = options['beforeBreadcrumb'] as (crumb: Record<string, unknown>) => Record<string, unknown>;
    expect(beforeBreadcrumb({ data: { url: 'https://maps.googleapis.com/x?key=AIza123' } })).toEqual({ data: { url: 'https://maps.googleapis.com/x?key=[masqué]' } });
    runWithCorrelation('requete-abc12345', () => reportError(new Error('panne'), { tags: { code: 'INTERNAL_ERROR', status: 500, vide: undefined }, extra: { rideId: 'r1' } }));
    expect(calls.captured[0]!.context).toEqual({ tags: { correlationId: 'requete-abc12345', code: 'INTERNAL_ERROR', status: 500 }, extra: { rideId: 'r1' } });
  });

  it('un SDK qui ne se charge pas n\'empêche pas le démarrage', async () => {
    const { logger, lines } = capturedLogger();
    const active = await initErrorReporting({ dsn: 'https://cle-publique@exemple.invalid/1', service: 'api', environment: 'test', release: '0.0.0', logger, load: async () => { throw new Error('module absent'); } });
    expect(active).toBe(false);
    expect(lines.some((l) => String(l['msg']).includes('non démarré'))).toBe(true);
  });

  it('version et environnement : variables du déploiement, sinon valeurs par défaut', () => {
    expect(releaseInfo({ NODE_ENV: 'production', APP_VERSION: '2026.09.26-abc123', SENTRY_ENVIRONMENT: 'staging' })).toEqual({ version: '2026.09.26-abc123', environment: 'staging' });
    const fallback = releaseInfo({ NODE_ENV: 'test', APP_VERSION: undefined, SENTRY_ENVIRONMENT: undefined });
    expect(fallback.environment).toBe('test');
    expect(typeof fallback.version).toBe('string');
  });
});

describe('latences de l\'API', () => {
  it('centiles estimés par seau, bornés par le maximum ; null sans mesure', () => {
    const h = new LatencyHistogram();
    expect(h.percentile(0.5)).toBeNull();
    for (let ms = 1; ms <= 100; ms += 1) h.record(ms, ms > 98);
    expect(h.percentile(0.5)).toBe(50);
    expect(h.percentile(0.95)).toBe(95);
    expect(h.errors).toBe(2);
    const slow = new LatencyHistogram();
    slow.record(12_000);
    slow.record(15_000);
    expect(slow.percentile(0.95)).toBeLessThanOrEqual(15_000);
    expect(slow.percentile(0.95)).toBeGreaterThan(10_000);
  });

  it('fenêtre glissante de 15 minutes par route ; cumul pour Prometheus ; routes triées par 95e centile', () => {
    const metrics = new HttpMetrics();
    let now = Date.UTC(2026, 8, 26, 12, 0, 0);
    metrics.now = () => now;
    metrics.record('GET', '/v1/health', 200, 4);
    metrics.record('GET', '/v1/health', 200, 6);
    metrics.record('POST', '/v1/quotes', 201, 450);
    metrics.record('POST', '/v1/quotes', 500, 900);
    let snapshot = metrics.snapshot();
    expect(snapshot).toMatchObject({ windowSeconds: 900, requests: 4, errors: 1 });
    expect(snapshot.routes.map((r) => `${r.method} ${r.route}`)).toEqual(['POST /v1/quotes', 'GET /v1/health']);
    expect(snapshot.routes[0]).toMatchObject({ count: 2, errors: 1, maxMs: 900 });
    now += 16 * 60_000;
    metrics.record('GET', '/v1/me', 200, 20);
    snapshot = metrics.snapshot();
    expect(snapshot.requests).toBe(1);
    expect(snapshot.routes.map((r) => r.route)).toEqual(['/v1/me']);
    const text = metrics.prometheus();
    expect(text).toContain('# TYPE neomoov_http_request_duration_seconds histogram');
    expect(text).toContain('neomoov_http_request_duration_seconds_bucket{method="GET",route="/v1/health",le="0.005"} 1');
    expect(text).toContain('neomoov_http_request_duration_seconds_bucket{method="POST",route="/v1/quotes",le="+Inf"} 2');
    expect(text).toContain('neomoov_http_request_duration_seconds_count{method="GET",route="/v1/me"} 1');
    expect(text).toContain('neomoov_http_server_errors_total{method="POST",route="/v1/quotes"} 1');
    expect(promLabel('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
  });

  it('mesure chaque requête terminée par le motif de sa route, ignore les requêtes OPTIONS', () => {
    const metrics = new HttpMetrics();
    const middleware = httpMetricsMiddleware(metrics);
    const run = (method: string, route?: string) => {
      const res = Object.assign(new EventEmitter(), { statusCode: 200 }) as unknown as Response;
      const req = { method, baseUrl: '', ...(route ? { route: { path: route } } : {}) } as unknown as Request;
      let nextCalled = false;
      middleware(req, res, () => {
        nextCalled = true;
      });
      (res as unknown as EventEmitter).emit('finish');
      return nextCalled;
    };
    expect(run('GET', '/v1/admin/rides/:id')).toBe(true);
    expect(run('GET')).toBe(true);
    expect(run('OPTIONS', '/v1/me')).toBe(true);
    expect(metrics.snapshot().routes.map((r) => `${r.method} ${r.route}`).sort()).toEqual(['GET /v1/admin/rides/:id', 'GET unmatched']);
    expect(routePattern({ route: { path: '/x' }, baseUrl: '/v1' } as unknown as Request)).toBe('/v1/x');
  });
});

describe('disjoncteurs : compteurs cumulés', () => {
  it('compte les échecs, les ouvertures et la date du dernier échec', async () => {
    let now = Date.UTC(2026, 8, 26, 12, 0, 0);
    const circuit = new CircuitBreaker('essai', { failureThreshold: 2, cooldownMs: 1_000 }, () => now);
    expect(circuit.stats()).toEqual({ name: 'essai', state: 'closed', failures: 0, totalFailures: 0, openings: 0, lastFailureAt: null });
    for (let i = 0; i < 2; i += 1) await expect(circuit.run(() => Promise.reject(new Error('panne')))).rejects.toThrow('panne');
    now += 1_000;
    await circuit.run(async () => 'ok');
    expect(circuit.stats()).toEqual({ name: 'essai', state: 'closed', failures: 0, totalFailures: 2, openings: 1, lastFailureAt: '2026-09-26T12:00:00.000Z' });
  });
});
