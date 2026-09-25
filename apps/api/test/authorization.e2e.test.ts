import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listRoutePolicies, type RoutePolicy } from '../src/modules/auth/route-policies.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp } from './helpers.js';

const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';
const concrete = (p: RoutePolicy) => p.path.replace(/:[A-Za-z]+/g, SAMPLE_ID);
const send = (app: NestExpressApplication, p: RoutePolicy, headers: Record<string, string> = {}) => {
  const method = p.method.toLowerCase() as 'get' | 'post' | 'patch' | 'put' | 'delete';
  return request(app.getHttpServer())[method](concrete(p)).set(headers).send({});
};

describe('autorisation sur chaque endpoint (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let policies: RoutePolicy[] = [];

  beforeAll(async () => {
    app = await startTestApp();
    if (app) policies = listRoutePolicies(app);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('inventorie les routes et leur politique ; toutes en ont une (refus par défaut)', ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    expect(policies.length).toBeGreaterThan(20);
    const byPath = new Map(policies.map((p) => [`${p.method} ${p.path}`, p]));
    expect(byPath.get('GET /v1/health')?.public).toBe(true);
    expect(byPath.get('POST /v1/auth/otp/request')?.public).toBe(true);
    expect(byPath.get('GET /v1/me')?.authenticated).toBe(true);
    expect(byPath.get('DELETE /v1/me/devices/:id')?.owns).toEqual({ entity: 'device', param: 'id' });
    expect(byPath.get('POST /v1/admin/api-keys')?.roles).toEqual(['admin']);
    expect(byPath.get('GET /v1/admin/audit')?.roles).toEqual(['admin', 'operator', 'finance', 'readonly']);
    expect(byPath.get('GET /v1/internal/service/whoami')?.scopes).toEqual(['*']);
    for (const p of policies) expect(p.public || p.authenticated || p.roles.length > 0 || p.scopes.length > 0, `${p.method} ${p.path}`).toBe(true);
  });

  it('sans jeton : 401 sur toute route non publique', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    for (const p of policies.filter((p) => !p.public)) {
      const res = await send(app, p);
      expect(res.status, `${p.method} ${p.path}`).toBe(401);
      expect(res.body.code, `${p.method} ${p.path}`).toBe('UNAUTHENTICATED');
    }
  });

  it('un client reçoit 403 sur toute route réservée à d\'autres rôles ou aux comptes de service', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const restricted = policies.filter((p) => !p.public && ((p.roles.length && !p.roles.includes('client')) || (!p.roles.length && !p.authenticated && p.scopes.length)));
    expect(restricted.length).toBeGreaterThan(5);
    for (const p of restricted) {
      const res = await send(app, p, bearer(client));
      expect(res.status, `${p.method} ${p.path}`).toBe(403);
      expect(['FORBIDDEN_ROLE', 'SERVICE_ACCOUNT_ONLY'], `${p.method} ${p.path}`).toContain(res.body.code);
    }
  });

  it('un compte de service reçoit 403 sur toute route d\'utilisateur, et passe sur une route à portée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['admin']);
    const created = await request(app.getHttpServer()).post('/v1/admin/api-keys').set(bearer(admin.tokens)).send({ name: 'agent de test', scopes: ['agents:read'], agentCode: 'analytics' }).expect(201);
    const key = { Authorization: `Bearer ${created.body.key}` };
    for (const p of policies.filter((p) => !p.public && !p.scopes.length)) {
      const res = await send(app, p, key);
      expect(res.status, `${p.method} ${p.path}`).toBe(403);
      expect(res.body.code, `${p.method} ${p.path}`).toBe('SERVICE_ACCOUNT_NOT_ALLOWED');
    }
    const whoami = await request(app.getHttpServer()).get('/v1/internal/service/whoami').set(key).expect(200);
    expect(whoami.body).toMatchObject({ kind: 'service', name: 'agent de test', scopes: ['agents:read'], agentCode: 'analytics' });
    // Le secret n'est pas dans le journal d'audit de sa création.
    const [entry] = await db(app).select().from(schema.auditLog).where(eq(schema.auditLog.action, 'admin.api_key_created')).orderBy(desc(schema.auditLog.occurredAt)).limit(1);
    expect((entry!.after as { key?: string }).key).toBe('[masqué]');
    expect(entry!.actorUserId).toBe(admin.userId);
    // Révocation.
    await request(app.getHttpServer()).delete(`/v1/admin/api-keys/${created.body.id}`).set(bearer(admin.tokens)).expect(204);
    const revoked = await request(app.getHttpServer()).get('/v1/internal/service/whoami').set(key);
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe('API_KEY_REVOKED');
    const bogus = await request(app.getHttpServer()).get('/v1/internal/service/whoami').set({ Authorization: 'Bearer nmk_000000000000_pasunsecretvalide' });
    expect(bogus.status).toBe(401);
    expect(bogus.body.code).toBe('INVALID_API_KEY');
  });

  it('le personnel accède aux routes d\'administration en lecture', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const operator = await createStaffAndLogin(app, ['operator']);
    const audit = await request(app.getHttpServer()).get('/v1/admin/audit?limit=5').set(bearer(operator.tokens)).expect(200);
    expect(Array.isArray(audit.body.items)).toBe(true);
    expect(audit.body.items.length).toBeGreaterThan(0);
    expect(audit.body.items[0]).toHaveProperty('occurredAt');
    const keys = await request(app.getHttpServer()).get('/v1/admin/api-keys').set(bearer(operator.tokens));
    expect(keys.status).toBe(403);
  });

  it('documente tous les endpoints dans l\'OpenAPI avec leurs schémas', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(app.getHttpServer()).get('/v1/docs/openapi.json').expect(200);
    for (const p of policies) {
      const path = p.path.replace(/:([A-Za-z]+)/g, '{$1}');
      expect(res.body.paths[path]?.[p.method.toLowerCase()], `${p.method} ${path}`).toBeDefined();
    }
    const verify = res.body.paths['/v1/auth/otp/verify'].post;
    expect(verify.requestBody.content['application/json'].schema.properties.phone).toBeDefined();
    expect(verify.responses['200'].content['application/json'].schema.properties.accessToken).toBeDefined();
    expect(verify.responses['400'].content['application/json'].schema.properties.correlationId).toBeDefined();
  });
});
