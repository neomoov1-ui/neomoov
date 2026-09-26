import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, createStaffAndLogin, db, startTestApp } from './helpers.js';

describe('journal d\'audit : filtres et export (intégration)', () => {
  let app: NestExpressApplication | null = null;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('export CSV filtré réservé à l\'administration ; filtre par agent et par période', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['admin']);
    const operator = await createStaffAndLogin(app, ['operator']);
    const action = `test.export_${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    await db(app).insert(schema.auditLog).values([
      { action, entity: 'rides', actorAgentCode: 'customer_relations', after: { note: 'remboursement ; proposé "20 $"' }, occurredAt: new Date(now - 60_000) },
      { action, entity: 'rides', actorUserId: admin.userId, occurredAt: new Date(now - 30_000) },
      { action, entity: 'rides', actorUserId: admin.userId, occurredAt: new Date(now - 10 * 86_400_000) },
    ]);
    const server = app.getHttpServer();
    const csv = await request(server).get('/v1/admin/audit/export').query({ action, from: new Date(now - 86_400_000).toISOString() }).set(bearer(admin.tokens)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\n');
    expect(lines[0]).toBe('occurred_at;action;entity;entity_id;actor_user_id;actor_agent_code;ip_address;correlation_id;before;after');
    expect(lines).toHaveLength(3);
    // Point-virgule et guillemets dans une valeur : cellule entre guillemets, guillemets doublés.
    expect(csv.text).toContain('"{""note"":""remboursement ; proposé \\""20 $\\""""}"');
    // L'export est lui-même journalisé, avec son auteur, ses filtres et son nombre de lignes.
    const exported = await request(server).get('/v1/admin/audit').query({ action: 'admin.audit_exported', actorUserId: admin.userId }).set(bearer(admin.tokens)).expect(200);
    expect(exported.body.items[0]).toMatchObject({ entity: 'audit_log', actorUserId: admin.userId, after: { rows: 2, filters: { action } } });
    const byAgent = await request(server).get('/v1/admin/audit').query({ action, actorAgentCode: 'customer_relations' }).set(bearer(operator.tokens)).expect(200);
    expect(byAgent.body.items).toHaveLength(1);
    expect((await request(server).get('/v1/admin/audit/export').query({ action }).set(bearer(operator.tokens))).status).toBe(403);
  });
});
