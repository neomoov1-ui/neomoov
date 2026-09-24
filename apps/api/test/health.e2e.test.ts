import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

describe('GET /v1/health (intégration)', () => {
  let app: NestExpressApplication | null = null;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('rapporte la base, Redis et les files', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente : test d\'intégration ignoré');
    const res = await request(app.getHttpServer()).get('/v1/health').set('x-correlation-id', 'test-corr-123456');
    expect(res.status).toBe(200);
    expect(res.headers['x-correlation-id']).toBe('test-corr-123456');
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.checks.redis.status).toBe('not_configured');
    expect(res.body.checks.queues.mode).toBe('memory');
    expect(Array.isArray(res.body.checks.queues.stats)).toBe(true);
  });

  it('renvoie les erreurs au format { code, message, correlationId }', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(app.getHttpServer()).get('/v1/inexistant');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(typeof res.body.message).toBe('string');
    expect(typeof res.body.correlationId).toBe('string');
  });

  it('expose la documentation OpenAPI', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(app.getHttpServer()).get('/v1/docs/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBe('Neomoov API');
    expect(res.body.paths['/v1/health']).toBeDefined();
  });
});
