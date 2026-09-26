import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, startTestApp } from './helpers.js';

/** Correction d'un relevé déjà émis pour un chauffeur sans activité la semaine suivante : brouillon vide sur demande. */
describe('relevés : brouillon de correction (intégration)', () => {
  let app: NestExpressApplication | null = null;
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('sans activité : aucun brouillon par défaut ; brouillon vide sur demande, ajustable, un seul par semaine', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const staff = await createStaffAndLogin(app, ['admin']);
    const driver = await createDriver(app);
    const week = '2026-06-08';
    const none = await request(server).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: week, driverId: driver.driverId }).expect(200);
    expect(none.body.statements).toHaveLength(0);
    const empty = await request(server).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: week, driverId: driver.driverId, allowEmpty: true }).expect(200);
    expect(empty.body.statements).toHaveLength(1);
    const draft = empty.body.statements[0];
    expect(draft).toMatchObject({ status: 'draft', netCents: 0 });
    const adjusted = await request(server).post(`/v1/admin/statements/${draft.id}/adjust`).set(bearer(staff.tokens)).send({ direction: 'debit', amountCents: 1_250, reason: 'Correction du relevé du 1er juin : frais oubliés' }).expect(200);
    expect(adjusted.body).toMatchObject({ status: 'draft', netCents: -1_250 });
    // Relancée : même brouillon, ajustement gardé.
    const again = await request(server).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: week, driverId: driver.driverId, allowEmpty: true }).expect(200);
    expect(again.body.statements[0]).toMatchObject({ id: draft.id, netCents: -1_250 });
  });
});
