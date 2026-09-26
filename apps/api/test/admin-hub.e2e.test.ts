import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testPhone, type StaffSession } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1024, 3)]);
const inOneYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);

describe('My Hub et API publique (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let operator: StaffSession;
  const server = () => app!.getHttpServer();

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

  it('validation d\'un chauffeur : file des documents, visionneuse, refus motivé, approbation, véhicule, activation, notes, suspension, réactivation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const account = await loginByOtp(app);
    await request(server()).post('/v1/driver/apply').set(bearer(account)).send({ firstName: 'Nadia', lastName: 'Benali', qualification: 'saaq_authorized' }).expect(201);
    const driver = (await request(server()).post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }).expect(200)).body as { accessToken: string };
    await request(server()).patch('/v1/driver/profile').set(bearer(driver)).send({ gstNumber: '123456789 RT0001', qstNumber: '1234567890 TQ0001' }).expect(200);
    const vehicle = await request(server()).post('/v1/driver/vehicles').set(bearer(driver)).send({ make: 'Kia', model: 'EV6', year: 2024, colour: 'Gris', plate: `H${String(Date.now()).slice(-5)}`, seats: 5 }).expect(201);
    const doc = await request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', 'licence').field('number', 'B1234-567890-12').field('expiresOn', inOneYear()).attach('file', JPEG, 'permis.jpg').expect(201);
    const second = await request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', 'insurance').field('expiresOn', inOneYear()).attach('file', JPEG, 'assurance.jpg').expect(201);

    const list = await request(server()).get('/v1/admin/drivers?q=Benali').set(bearer(operator.tokens)).expect(200);
    const row = list.body.items[0];
    expect(row).toMatchObject({ firstName: 'Nadia', status: 'pending', documentsPending: 2 });
    expect(row.phone).toMatch(/^\+1 \d{3} •••-\d{4}$/);
    const queue = await request(server()).get('/v1/admin/documents').set(bearer(operator.tokens)).expect(200);
    const queued = queue.body.items.find((d: { id: string }) => d.id === doc.body.id);
    expect(queued).toMatchObject({ type: 'licence', status: 'pending', driverName: 'Nadia Benali', number: `${'•'.repeat(12)}-12` });
    const file = await request(server()).get(`/v1/admin/documents/${doc.body.id}/content`).set(bearer(operator.tokens)).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(file.body as Buffer).subarray(0, 3)).toEqual(JPEG.subarray(0, 3));
    expect((await request(server()).post(`/v1/admin/documents/${second.body.id}/review`).set(bearer(operator.tokens)).send({ decision: 'rejected' })).status).toBe(400);
    const rejected = await request(server()).post(`/v1/admin/documents/${second.body.id}/review`).set(bearer(operator.tokens)).send({ decision: 'rejected', reason: 'Photo illisible' }).expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectionReason: 'Photo illisible' });
    await request(server()).post(`/v1/admin/documents/${doc.body.id}/review`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    const driverDocs = await request(server()).get('/v1/driver/documents').set(bearer(driver)).expect(200);
    expect(driverDocs.body.items.find((i: { type: string }) => i.type === 'insurance').current.rejectionReason).toBe('Photo illisible');

    const reviewed = await request(server()).post(`/v1/admin/vehicles/${vehicle.body.id}/review`).set(bearer(operator.tokens)).send({ status: 'active', nextInspectionDueOn: inOneYear() }).expect(200);
    expect(reviewed.body.status).toBe('active');
    const activated = await request(server()).post(`/v1/admin/drivers/${row.id}/activate`).set(bearer(operator.tokens)).expect(200);
    expect(activated.body.driver).toMatchObject({ status: 'active', gstNumber: '•••••6789 RT0001', qstNumber: '••••••7890 TQ0001' });
    expect(JSON.stringify(activated.body)).not.toContain('123456789RT0001');
    await request(server()).post(`/v1/admin/drivers/${row.id}/notes`).set(bearer(operator.tokens)).send({ body: 'Entretien téléphonique concluant.' }).expect(201);
    const suspended = await request(server()).post(`/v1/admin/drivers/${row.id}/suspend`).set(bearer(operator.tokens)).send({ reason: 'Plainte à instruire' }).expect(200);
    expect(suspended.body.driver.status).toBe('suspended');
    expect(suspended.body.sanctions[0]).toMatchObject({ type: 'suspension', reason: 'Plainte à instruire', endsAt: null });
    expect(suspended.body.notes[0].body).toBe('Entretien téléphonique concluant.');
    const reactivated = await request(server()).post(`/v1/admin/drivers/${row.id}/reactivate`).set(bearer(operator.tokens)).expect(200);
    expect(reactivated.body.driver.status).toBe('active');
    expect(reactivated.body.sanctions[0].endsAt).not.toBeNull();
    const audit = await db(app).select({ action: schema.auditLog.action }).from(schema.auditLog).where(and(eq(schema.auditLog.entityId, row.id), eq(schema.auditLog.actorUserId, operator.userId)));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['admin.driver_activated', 'admin.driver_suspended', 'admin.driver_reactivated']));

    // Lecture seule : consulte, ne décide pas.
    const readonly = await createStaffAndLogin(app, ['readonly']);
    await request(server()).get(`/v1/admin/drivers/${row.id}`).set(bearer(readonly.tokens)).expect(200);
    expect((await request(server()).post(`/v1/admin/drivers/${row.id}/activate`).set(bearer(readonly.tokens))).status).toBe(403);
    expect((await request(server()).get(`/v1/admin/documents/${doc.body.id}/content`).set(bearer(readonly.tokens))).status).toBe(403);
  });

  it('répartition : course créée par téléphone, liste des courses ouvertes, recherche, annulation par l\'opérateur sans frais', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const quotes = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    const created = await request(server()).post('/v1/admin/rides').set(bearer(operator.tokens)).send({ quoteId: quotes.body.quotes[0].id, guest: { name: 'Jean Tremblay', phone: testPhone() }, paymentMethod: 'cash' }).expect(201);
    const active = await request(server()).get('/v1/admin/rides?q=Tremblay').set(bearer(operator.tokens)).expect(200);
    const listed = active.body.items.find((r: { id: string }) => r.id === created.body.id);
    expect(listed).toMatchObject({ state: 'requested', clientName: 'Jean Tremblay', driverName: null, paymentMethod: 'cash' });
    expect(listed.clientPhone).toMatch(/•••/);
    const cancelled = await request(server()).post(`/v1/admin/rides/${created.body.id}/cancel`).set(bearer(operator.tokens)).send({ reason: 'Le client a appelé pour annuler' }).expect(200);
    expect(cancelled.body).toMatchObject({ state: 'cancelled_by_client', feeCents: 0 });
    const recent = await request(server()).get('/v1/admin/rides?view=recent&q=Tremblay').set(bearer(operator.tokens)).expect(200);
    expect(recent.body.items.find((r: { id: string }) => r.id === created.body.id).state).toBe('cancelled_by_client');
    const events = await request(server()).get(`/v1/admin/rides/${created.body.id}/events`).set(bearer(operator.tokens)).expect(200);
    expect(events.body.find((e: { type: string }) => e.type === 'client_cancels')).toMatchObject({ actorKind: 'operator' });
  });

  it('tableau de bord, incidents et décisions, approbations des agents, rapports', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const online = await createDriver(app);
    await request(server()).post('/v1/driver/status').set(bearer(online.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates }).expect(200);
    const dashboard = await request(server()).get('/v1/admin/dashboard').set(bearer(operator.tokens)).expect(200);
    expect(dashboard.body.counts.driversOnline).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.fleet.find((f: { driverId: string }) => f.driverId === online.driverId)).toMatchObject({ status: 'online', coordinates: { lat: expect.closeTo(45.523, 3) } });
    await request(server()).post('/v1/driver/status').set(bearer(online.tokens)).send({ status: 'offline' }).expect(200);

    // Incident signalé par le chauffeur, décidé par l'opérateur.
    const [incident] = await db(app).insert(schema.incidents).values({ type: 'complaint', severity: 'high', reportedByKind: 'driver', reportedByUserId: online.userId, description: 'Client agressif' }).returning();
    const open = await request(server()).get('/v1/admin/incidents?status=open').set(bearer(operator.tokens)).expect(200);
    expect(open.body.items.some((i: { id: string }) => i.id === incident!.id)).toBe(true);
    expect((await request(server()).post(`/v1/admin/incidents/${incident!.id}/decide`).set(bearer(operator.tokens)).send({ status: 'decided' })).body.code).toBe('DECISION_REQUIRED');
    const decided = await request(server()).post(`/v1/admin/incidents/${incident!.id}/decide`).set(bearer(operator.tokens)).send({ status: 'decided', decision: 'Avertissement au client, course remboursée.' }).expect(200);
    expect(decided.body).toMatchObject({ status: 'decided', decision: 'Avertissement au client, course remboursée.' });
    expect(decided.body.decidedAt).not.toBeNull();

    // Action proposée par un agent en mode approbation.
    const [run] = await db(app).insert(schema.agentRuns).values({ agentCode: 'customer_relations', trigger: 'test', status: 'awaiting_approval' }).returning();
    const [approval] = await db(app).insert(schema.approvals).values({ agentRunId: run!.id, proposedAction: 'refund', data: { amountCents: 1500 }, justification: 'Retard de 20 minutes' }).returning();
    const pending = await request(server()).get('/v1/admin/approvals').set(bearer(operator.tokens)).expect(200);
    expect(pending.body.items.find((a: { id: string }) => a.id === approval!.id)).toMatchObject({ agentCode: 'customer_relations', proposedAction: 'refund', decision: 'pending' });
    const approved = await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'approved' }).expect(200);
    expect(approved.body.decision).toBe('approved');
    expect((await request(server()).post(`/v1/admin/approvals/${approval!.id}/decide`).set(bearer(operator.tokens)).send({ decision: 'rejected', note: 'Décision déjà prise' })).status).toBe(409);
    const agents = await request(server()).get('/v1/admin/agents').set(bearer(operator.tokens)).expect(200);
    expect(agents.body.find((a: { code: string }) => a.code === 'customer_relations').runs7d).toBeGreaterThanOrEqual(1);
    await db(app).delete(schema.approvals).where(eq(schema.approvals.id, approval!.id));
    await db(app).delete(schema.agentRuns).where(eq(schema.agentRuns.id, run!.id));
    await db(app).delete(schema.incidents).where(eq(schema.incidents.id, incident!.id));

    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const report = await request(server()).get(`/v1/admin/reports?from=${weekAgo}&to=${today}`).set(bearer(operator.tokens)).expect(200);
    expect(report.body.daily).toHaveLength(7);
    expect(report.body.totals.ridesRequested).toBeGreaterThanOrEqual(0);
    const csv = await request(server()).get(`/v1/admin/reports.csv?from=${weekAgo}&to=${today}`).set(bearer(operator.tokens)).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\r\n')[0]).toBe('date;demandées;terminées;annulées;revenus_cents');
  });

  it('réglages (administrateur seul, même type), tarifs datés, polygones validés', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const settings = await request(server()).get('/v1/admin/settings?q=packs.low').set(bearer(operator.tokens)).expect(200);
    expect(settings.body.find((s: { key: string }) => s.key === 'packs.low_threshold').value).toBe(3);
    expect((await request(server()).patch('/v1/admin/settings/packs.low_threshold').set(bearer(operator.tokens)).send({ value: 4 })).status).toBe(403);
    expect((await request(server()).patch('/v1/admin/settings/packs.low_threshold').set(bearer(admin.tokens)).send({ value: 'quatre' })).body.code).toBe('SETTING_TYPE_MISMATCH');
    expect((await request(server()).patch('/v1/admin/settings/packs.low_threshold').set(bearer(admin.tokens)).send({ value: 4 }).expect(200)).body.value).toBe(4);
    await request(server()).patch('/v1/admin/settings/packs.low_threshold').set(bearer(admin.tokens)).send({ value: 3 }).expect(200);

    const past = await request(server()).post('/v1/admin/tariffs').set(bearer(operator.tokens)).send({ category: 'neo_xl', baseCents: 500, perKmCents: 210, perMinuteCents: 60, minimumCents: 1500, validFrom: '2020-01-01' });
    expect(past.body.code).toBe('VALID_FROM_IN_PAST');
    const future = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const added = await request(server()).post('/v1/admin/tariffs').set(bearer(operator.tokens)).send({ category: 'neo_xl', baseCents: 500, perKmCents: 210, perMinuteCents: 60, minimumCents: 1500, validFrom: future }).expect(201);
    expect(added.body).toMatchObject({ category: 'neo_xl', validFrom: future });
    const tariffs = await request(server()).get('/v1/admin/tariffs').set(bearer(operator.tokens)).expect(200);
    expect(tariffs.body.some((t: { id: string }) => t.id === added.body.id)).toBe(true);
    await db(app).delete(schema.pricingRules).where(eq(schema.pricingRules.id, added.body.id));

    const zones = await request(server()).get('/v1/admin/zones').set(bearer(operator.tokens)).expect(200);
    const plateau = zones.body.find((z: { code: string }) => z.code === 'plateau');
    const bowtie = { type: 'Polygon', coordinates: [[[-73.6, 45.5], [-73.5, 45.6], [-73.5, 45.5], [-73.6, 45.6], [-73.6, 45.5]]] };
    const refused = await request(server()).put('/v1/admin/zones/plateau').set(bearer(operator.tokens)).send({ geometry: bowtie });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'INVALID_POLYGON', details: { reason: 'self_intersecting' } });
    const kept = await request(server()).put('/v1/admin/zones/plateau').set(bearer(operator.tokens)).send({ geometry: plateau.geometry }).expect(200);
    expect(kept.body.geometry.coordinates[0]).toHaveLength(plateau.geometry.coordinates[0].length);
  });

  it('API publique : clé à portée limitée, anti-robots, limitation, prospect visible dans My Hub, devis sans compte', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await resetHttpLimits(app);
    const created = await request(server()).post('/v1/admin/api-keys').set(bearer(admin.tokens)).send({ name: 'WordPress neomoov.net', scopes: ['public:write'] }).expect(201);
    const key = { Authorization: `Bearer ${created.body.key}` };
    const phone = testPhone();
    const lead = { kind: 'driver', firstName: 'Omar', lastName: 'Haddad', phone, email: 'omar@exemple.ca', city: 'Laval', antiBotToken: 'ok', consent: true };
    expect((await request(server()).post('/v1/public/leads').send(lead)).status).toBe(401);
    const client = await loginByOtp(app);
    expect((await request(server()).post('/v1/public/leads').set(bearer(client)).send(lead)).status).toBe(403);
    expect((await request(server()).post('/v1/public/leads').set(key).send({ ...lead, antiBotToken: 'fail' })).body.code).toBe('ANTI_BOT_FAILED');
    expect((await request(server()).post('/v1/public/leads').set(key).send({ ...lead, consent: false })).status).toBe(400);
    const received = await request(server()).post('/v1/public/leads').set(key).send(lead).expect(201);
    expect(received.body.status).toBe('received');
    const leads = await request(server()).get('/v1/admin/leads?q=Haddad').set(bearer(operator.tokens)).expect(200);
    expect(leads.body.items[0]).toMatchObject({ firstName: 'Omar', kind: 'driver', source: 'WordPress neomoov.net', status: 'new', email: 'o•••@exemple.ca' });
    expect(leads.body.items[0].phone).not.toContain(phone.slice(-7, -4));
    await request(server()).patch(`/v1/admin/leads/${received.body.id}`).set(bearer(operator.tokens)).send({ status: 'contacted' }).expect(200);
    // Clé publique : aucun accès au reste de l'API.
    expect((await request(server()).get('/v1/admin/leads').set(key)).status).toBe(403);
    const quotes = await request(server()).post('/v1/public/quotes').set(key).send({ origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    expect(quotes.body.quotes.map((q: { category: string }) => q.category)).toEqual(['neo_premium', 'neo_prestige', 'neo_xl']);
    await db(app).delete(schema.leads).where(inArray(schema.leads.phone, [phone]));
    await db(app).delete(schema.apiKeys).where(sql`${schema.apiKeys.id} = ${created.body.id}`);
  });
});
