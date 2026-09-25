import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockEmailProvider, MockSmsProvider, MockStorageProvider } from '../src/adapters/mock/index.js';
import { EMAIL_PROVIDER, SMS_PROVIDER, STORAGE_PROVIDER } from '../src/adapters/types.js';
import { bearer, cleanupTestData, createStaffAndLogin, currentPolicyVersion, db, loginByOtp, startTestApp, testEmail } from './helpers.js';

describe('/v1/me : profil, appareils, consentements, demandes de droits, suppression (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('modifie le profil, journalise avant et après, refuse un courriel déjà pris', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await loginByOtp(app);
    const b = await loginByOtp(app);
    const email = testEmail('a');
    const patched = await request(server()).patch('/v1/me').set(bearer(a)).send({ firstName: 'Sophie', lastName: 'Martin', email, language: 'en' }).expect(200);
    expect(patched.body).toMatchObject({ firstName: 'Sophie', lastName: 'Martin', email, language: 'en' });
    const conflict = await request(server()).patch('/v1/me').set(bearer(b)).send({ email });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('EMAIL_TAKEN');
    const outdated = await request(server()).patch('/v1/me').set(bearer(a)).send({ privacyPolicyVersion: '0.0' });
    expect(outdated.status).toBe(400);
    const empty = await request(server()).patch('/v1/me').set(bearer(a)).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('VALIDATION_ERROR');
    const [entry] = await db(app)
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'me.updated'), eq(schema.auditLog.entityId, a.user.id)))
      .orderBy(desc(schema.auditLog.occurredAt))
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry!.actorUserId).toBe(a.user.id);
    expect(entry!.before).toMatchObject({ firstName: null, email: null });
    expect(entry!.after).toMatchObject({ firstName: 'Sophie', email });
    expect(entry!.correlationId).toBeTruthy();
  });

  it('gère les appareils, avec propriété par ressource', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await loginByOtp(app);
    const b = await loginByOtp(app);
    const device = await request(server()).post('/v1/me/devices').set(bearer(a)).send({ platform: 'android', pushToken: `ExponentPushToken[${a.user.id.slice(0, 8)}]`, appVersion: '1.2.0' }).expect(201);
    const list = await request(server()).get('/v1/me/devices').set(bearer(a)).expect(200);
    expect(list.body.map((d: { id: string }) => d.id)).toContain(device.body.id);
    const other = await request(server()).delete(`/v1/me/devices/${device.body.id}`).set(bearer(b));
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('NOT_OWNER');
    await request(server()).delete(`/v1/me/devices/${device.body.id}`).set(bearer(a)).expect(204);
    const missing = await request(server()).delete(`/v1/me/devices/${device.body.id}`).set(bearer(a));
    expect(missing.status).toBe(404);
    const invalid = await request(server()).post('/v1/me/devices').set(bearer(a)).send({ platform: 'windows' });
    expect(invalid.status).toBe(400);
  });

  it('consentements versionnés : accord, retrait, nouvelle version, historique conservé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await loginByOtp(app);
    const initial = await request(server()).get('/v1/me/consents').set(bearer(a)).expect(200);
    expect(initial.body).toHaveLength(5);
    expect(initial.body.every((c: { granted: boolean }) => c.granted === false)).toBe(true);
    const granted = await request(server()).post('/v1/me/consents').set(bearer(a)).send({ purpose: 'geolocation', version: '2026-09', granted: true, source: 'app' }).expect(200);
    expect(granted.body).toMatchObject({ purpose: 'geolocation', granted: true, version: '2026-09', withdrawnAt: null });
    const same = await request(server()).post('/v1/me/consents').set(bearer(a)).send({ purpose: 'geolocation', version: '2026-09', granted: true }).expect(200);
    expect(same.body.grantedAt).toBe(granted.body.grantedAt);
    const withdrawn = await request(server()).post('/v1/me/consents').set(bearer(a)).send({ purpose: 'geolocation', version: '2026-09', granted: false }).expect(200);
    expect(withdrawn.body.granted).toBe(false);
    expect(withdrawn.body.withdrawnAt).toBeTruthy();
    const v2 = await request(server()).post('/v1/me/consents').set(bearer(a)).send({ purpose: 'geolocation', version: '2026-10', granted: true }).expect(200);
    expect(v2.body).toMatchObject({ granted: true, version: '2026-10' });
    const state = await request(server()).get('/v1/me/consents').set(bearer(a)).expect(200);
    expect(state.body.find((c: { purpose: string }) => c.purpose === 'geolocation')).toMatchObject({ granted: true, version: '2026-10' });
    const rows = await db(app).select().from(schema.consents).where(eq(schema.consents.userId, a.user.id));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.withdrawnAt).length).toBe(1);
  });

  it('demande d\'accès : export JSON et PDF produit, lien signé, avis envoyé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await loginByOtp(app);
    await request(server()).post('/v1/me/consents').set(bearer(a)).send({ purpose: 'marketing', version: '1', granted: true });
    const created = await request(server()).post('/v1/me/data-requests').set(bearer(a)).send({ type: 'access' }).expect(202);
    expect(created.body.type).toBe('access');
    expect(created.body.dueOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Mode mémoire : la tâche est traitée dans le processus, l'export est déjà prêt.
    const view = await request(server()).get(`/v1/me/data-requests/${created.body.id}`).set(bearer(a)).expect(200);
    expect(view.body.processedAt).toBeTruthy();
    expect(view.body.downloads.json).toContain('.json');
    expect(view.body.downloads.pdf).toContain('.pdf');
    const storage = app.get<MockStorageProvider>(STORAGE_PROVIDER);
    const json = storage.objects.get(`exports/${a.user.id}/${created.body.id}.json`);
    const pdf = storage.objects.get(`exports/${a.user.id}/${created.body.id}.pdf`);
    expect(json?.contentType).toBe('application/json');
    const exported = JSON.parse(json!.body.toString('utf8'));
    expect(exported.profile.phone).toBe(a.user.phone);
    expect(exported.consents).toHaveLength(1);
    expect(exported.profile.appleId).toBeUndefined();
    expect(pdf?.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf!.body.length).toBeGreaterThan(1000);
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    expect(sms.sent.some((m) => m.to === a.user.phone && /export/i.test(m.body))).toBe(true);
    const list = await request(server()).get('/v1/me/data-requests').set(bearer(a)).expect(200);
    expect(list.body).toHaveLength(1);
    const b = await loginByOtp(app);
    const forbidden = await request(server()).get(`/v1/me/data-requests/${created.body.id}`).set(bearer(b));
    expect(forbidden.status).toBe(403);
    const withdrawal = await request(server()).post('/v1/me/data-requests').set(bearer(a)).send({ type: 'consent_withdrawal' }).expect(202);
    expect(withdrawal.body.processedAt).toBeTruthy();
    const consents = await request(server()).get('/v1/me/consents').set(bearer(a)).expect(200);
    expect(consents.body.every((c: { granted: boolean }) => !c.granted)).toBe(true);
    const deletionViaRequest = await request(server()).post('/v1/me/data-requests').set(bearer(a)).send({ type: 'deletion' });
    expect(deletionViaRequest.status).toBe(400);
  });

  it('supprime le compte : accès coupé, données anonymisées, courses conservées, audit', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await loginByOtp(app, undefined, { device: { platform: 'ios', pushToken: 'ExponentPushToken[delete-me-0001]' } });
    const email = testEmail('delete');
    await request(server()).patch('/v1/me').set(bearer(a)).send({ email, firstName: 'À', lastName: 'Supprimer' }).expect(200);
    const scheduled = await request(server()).delete('/v1/me').set(bearer(a)).send({ reason: 'test' }).expect(202);
    expect(scheduled.body.status).toBe('scheduled');
    const after = await request(server()).get('/v1/me').set(bearer(a));
    expect(after.status).toBe(401);
    const [user] = await db(app).select().from(schema.users).where(eq(schema.users.id, a.user.id));
    expect(user!.status).toBe('deleted');
    expect(user!.phone).toMatch(/^\+999\d{11}$/);
    expect(user!.email).toBeNull();
    expect(user!.firstName).toBeNull();
    const devices = await db(app).select().from(schema.devices).where(eq(schema.devices.userId, a.user.id));
    expect(devices).toHaveLength(0);
    const [req] = await db(app).select().from(schema.dataRequests).where(eq(schema.dataRequests.id, scheduled.body.requestId));
    expect(req!.type).toBe('deletion');
    expect(req!.processedAt).toBeTruthy();
    const mail = app.get<MockEmailProvider>(EMAIL_PROVIDER);
    expect(mail.sent.some((m) => m.to === email && /supprim/i.test(m.subject))).toBe(true);
    const audit = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'privacy.account_deleted'), eq(schema.auditLog.entityId, a.user.id)));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorAgentCode).toBe('privacy_jobs');
    // Le numéro est libre : un nouveau compte peut être créé avec.
    const again = await loginByOtp(app, a.user.phone);
    expect(again.created).toBe(true);
    expect(again.user.id).not.toBe(a.user.id);
    // Suppression demandée mais pas encore traitée par le worker (production) : le numéro est libéré à la reconnexion.
    const pending = await loginByOtp(app);
    await db(app).update(schema.users).set({ status: 'deleted', deletedAt: new Date() }).where(eq(schema.users.id, pending.user.id));
    const replaced = await loginByOtp(app, pending.user.phone);
    expect(replaced.created).toBe(true);
    expect(replaced.user.id).not.toBe(pending.user.id);
    const [old] = await db(app).select().from(schema.users).where(eq(schema.users.id, pending.user.id));
    expect(old!.phone).toMatch(/^\+999\d{11}$/);
    // Le personnel ne se supprime pas depuis l'application.
    const staff = await createStaffAndLogin(app, ['operator']);
    const refused = await request(server()).delete('/v1/me').set(bearer(staff.tokens)).send({});
    expect(refused.status).toBe(403);
    expect(await currentPolicyVersion(app)).toBeTruthy();
  });
});
