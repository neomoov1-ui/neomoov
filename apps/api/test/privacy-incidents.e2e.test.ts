import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, createStaffAndLogin, db, startTestApp, type StaffSession } from './helpers.js';

const register = {
  discoveredAt: '2026-09-26T13:30:00.000Z',
  occurredFrom: '2026-09-25',
  reportedBy: 'Opérateur de garde',
  dataCategories: ['identity', 'tax_numbers'],
  dataDescription: 'Relevé hebdomadaire d\'un chauffeur (nom, numéros de TPS et TVQ) envoyé à un autre chauffeur',
  circumstances: 'Courriel de relevé envoyé à une mauvaise adresse après une erreur de saisie',
  personsAffected: 1,
  personsAffectedQuebec: 1,
};

describe('incidents ouverts à la main et registre des incidents de confidentialité (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let operator: StaffSession;

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    admin = await createStaffAndLogin(app, ['admin']);
    operator = await createStaffAndLogin(app, ['operator']);
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('inscrit un incident de confidentialité au registre dès sa création, puis met à jour sa fiche', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/v1/admin/incidents')
      .set(bearer(operator.tokens))
      .send({ type: 'privacy', severity: 'high', description: 'Relevé envoyé au mauvais chauffeur', privacyBreach: register })
      .expect(201);
    expect(created.body).toMatchObject({ type: 'privacy', severity: 'high', status: 'open', reportedByKind: 'operator', privacyBreach: true, rideId: null });
    expect(created.body.privacyReference).toMatch(/^IC-\d{4}-\d{3,}$/);
    const id = created.body.id as string;

    const entry = await request(server).get(`/v1/admin/incidents/${id}/privacy-breach`).set(bearer(operator.tokens)).expect(200);
    expect(entry.body).toMatchObject({
      incidentId: id, reference: created.body.privacyReference, seriousHarm: 'pending', personsAffected: 1, dataCategories: ['identity', 'tax_numbers'],
      followUps: ['record_containment', 'assess_harm', 'record_measures'],
    });

    // Registre (filtre « privacy ») : l'incident y figure avec son numéro.
    const list = await request(server).get('/v1/admin/incidents').query({ status: 'privacy', pageSize: 100 }).set(bearer(operator.tokens)).expect(200);
    expect(list.body.items.find((i: { id: string }) => i.id === id)?.privacyReference).toBe(created.body.privacyReference);

    // Évaluation : risque sérieux, avis à la CAI transmis, avis aux personnes encore à faire.
    const updated = await request(server)
      .put(`/v1/admin/incidents/${id}/privacy-breach`)
      .set(bearer(admin.tokens))
      .send({ ...register, containment: 'Destinataire joint, suppression confirmée par écrit', sensitivity: 'Numéros de taxes', consequences: 'Fraude', misuseLikelihood: 'Faible', seriousHarm: 'serious', caiNotifiedOn: '2026-09-27', caiReference: 'CAI-TEST-1', measures: 'Double vérification des destinataires' })
      .expect(200);
    expect(updated.body).toMatchObject({ reference: created.body.privacyReference, seriousHarm: 'serious', caiNotifiedOn: '2026-09-27', followUps: ['notify_persons'] });
    expect(updated.body.recordedAt).toBe(entry.body.recordedAt);

    // Journal d'audit : rubriques modifiées et dates des avis, jamais le texte libre de la fiche.
    const [audit] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, 'admin.privacy_breach_updated'))).orderBy(desc(schema.auditLog.occurredAt)).limit(1);
    expect(audit!.actorUserId).toBe(admin.userId);
    expect(audit!.after).toMatchObject({ reference: created.body.privacyReference, seriousHarm: 'serious', caiNotifiedOn: '2026-09-27', fields: expect.arrayContaining(['containment', 'seriousHarm', 'caiNotifiedOn', 'measures']) });
    expect(JSON.stringify(audit!.after)).not.toContain('Double vérification');
    const [creation] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, id), eq(schema.auditLog.action, 'admin.incident_created'))).limit(1);
    expect(creation!.actorUserId).toBe(operator.userId);

    // Règles croisées de la fiche.
    const invalid = await request(server).put(`/v1/admin/incidents/${id}/privacy-breach`).set(bearer(admin.tokens)).send({ ...register, personsAffectedQuebec: 5 });
    expect(invalid.status).toBe(400);
  });

  it('inscrit au registre un incident existant ; numéros consécutifs', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const plain = await request(server).post('/v1/admin/incidents').set(bearer(operator.tokens)).send({ type: 'other', description: 'Téléphone de l\'équipe égaré avec une session ouverte' }).expect(201);
    expect(plain.body).toMatchObject({ type: 'other', severity: 'medium', privacyBreach: false, privacyReference: null });
    const missing = await request(server).get(`/v1/admin/incidents/${plain.body.id}/privacy-breach`).set(bearer(operator.tokens));
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe('PRIVACY_BREACH_NOT_FOUND');

    const first = await request(server).put(`/v1/admin/incidents/${plain.body.id}/privacy-breach`).set(bearer(operator.tokens)).send(register).expect(200);
    const second = await request(server).post('/v1/admin/incidents').set(bearer(operator.tokens)).send({ type: 'privacy', description: 'Deuxième incident', privacyBreach: register }).expect(201);
    const sequence = (reference: string) => Number(reference.split('-')[2]);
    expect(sequence(second.body.privacyReference)).toBe(sequence(first.body.reference) + 1);
    const [recorded] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, plain.body.id), eq(schema.auditLog.action, 'admin.privacy_breach_recorded'))).limit(1);
    expect(recorded!.after).toMatchObject({ reference: first.body.reference, fields: expect.arrayContaining(['discoveredAt', 'dataDescription', 'personsAffected']) });
  });

  it('refuse une entrée invalide, une course inconnue, et les rôles non autorisés ; export du registre par l\'administration', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const noRegister = await request(server).post('/v1/admin/incidents').set(bearer(operator.tokens)).send({ type: 'privacy', description: 'Sans fiche' });
    expect(noRegister.status).toBe(400);
    const sos = await request(server).post('/v1/admin/incidents').set(bearer(operator.tokens)).send({ type: 'sos', description: 'SOS saisi à la main' });
    expect(sos.status).toBe(400);
    const unknownRide = await request(server).post('/v1/admin/incidents').set(bearer(operator.tokens)).send({ type: 'lost_item', description: 'Parapluie oublié', rideId: '00000000-0000-4000-8000-000000000001' });
    expect(unknownRide.status).toBe(404);
    expect(unknownRide.body.code).toBe('RIDE_NOT_FOUND');
    const unknownIncident = await request(server).put('/v1/admin/incidents/00000000-0000-4000-8000-000000000001/privacy-breach').set(bearer(operator.tokens)).send(register);
    expect(unknownIncident.status).toBe(404);

    const readonly = await createStaffAndLogin(app, ['readonly']);
    const finance = await createStaffAndLogin(app, ['finance']);
    expect((await request(server).post('/v1/admin/incidents').set(bearer(readonly.tokens)).send({ type: 'other', description: 'Lecture seule' })).status).toBe(403);
    const created = await request(server).post('/v1/admin/incidents').set(bearer(operator.tokens)).send({ type: 'privacy', description: 'Pour les droits', privacyBreach: register }).expect(201);
    expect((await request(server).get(`/v1/admin/incidents/${created.body.id}/privacy-breach`).set(bearer(finance.tokens))).status).toBe(403);
    expect((await request(server).get('/v1/admin/incidents/privacy-register.csv').set(bearer(operator.tokens))).status).toBe(403);

    const csv = await request(server).get('/v1/admin/incidents/privacy-register.csv').set(bearer(admin.tokens)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]!.startsWith('reference;incident_id;type;severity;status;recorded_at')).toBe(true);
    expect(lines.some((l) => l.startsWith(`${created.body.privacyReference};${created.body.id};privacy;`))).toBe(true);
    const [exported] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'admin.privacy_register_exported'), eq(schema.auditLog.actorUserId, admin.userId))).limit(1);
    expect(exported).toBeDefined();
  });
});
