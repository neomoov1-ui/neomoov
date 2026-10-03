import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { localMoment } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockLlmProvider, MockPushProvider } from '../src/adapters/mock/index.js';
import { LLM_PROVIDER, PUSH_PROVIDER } from '../src/adapters/types.js';
import { DomainEventsService } from '../src/common/domain-events.js';
import { AgentJobsService } from '../src/modules/agents/agent-jobs.service.js';
import { AlertsService } from '../src/modules/booster/alerts.service.js';
import { InspectionsService } from '../src/modules/booster/inspections.service.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, resetHttpLimits, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Neomoov Booster (phase 1, agent G) : vérification sommaire par caméra (photos simulées, analyse par le modèle simulé,
 * corrections, confirmation et archive, PDF, listes du chauffeur et du dispatch, isolation entre organisations),
 * rapport de performance (captures lues, confirmation, récapitulatifs hebdomadaire et mensuel exacts sur des données
 * connues), alertes (réglages, passe planifiée, envoi par le push simulé avec canal et son, test du son).
 */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(512, 3)]);
const KINDS = ['front_left', 'front_right', 'rear_left', 'rear_right', 'left_side', 'right_side', 'dashboard'];
const TZ = 'America/Toronto';

const INSPECTION_OUTPUT = {
  odometerKm: 123_456, energyPercent: 72, plate: null,
  warningLights: [{ name: 'Pression des pneus', probableCause: 'pneu sous-gonflé' }],
  defects: [
    { zone: 'front_left', kind: 'scratch', description: 'rayure de 10 cm', severity: 'minor' },
    { zone: 'rear_right', kind: 'worn_tire', description: 'bande de roulement lisse', severity: 'major' },
  ],
  items: [{ item: 'lights', state: 'ok', observation: null }, { item: 'mirrors', state: 'minor', observation: 'rétroviseur droit fissuré' }],
  confidence: { odometerKm: 0.9, energyPercent: 0.8, plate: 0.2, warningLights: 0.9, defects: 0.7, items: 0.6 },
  photosUnusable: [6], summary: 'Pneu arrière droit usé, rayure à l\'avant gauche, voyant de pression allumé.',
};
const READING_OUTPUT = {
  app: 'Uber', date: '2026-10-06', startedAt: '07:00', endedAt: '15:30', ridesCents: 24_000, tipsCents: 2_400, promotionsCents: 1_000, ridesCount: 12, onlineMinutes: 480, drivingMinutes: 300,
  confidence: { amounts: 0.9, counts: 0.8, times: 0.7 }, photosUnusable: [], summary: 'Résumé du 6 octobre lu sur deux captures.',
};

/** Prompts versionnés de `docs/agents`, chargés comme le feraient les données de départ (base partagée : jamais réécrits). */
function promptBody(file: string): string {
  const text = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'agents', file), 'utf8').replace(/\r\n/g, '\n');
  return /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(text)![1]!.trim();
}

describe('Neomoov Booster : vérification sommaire, performance, alertes (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  let llm: MockLlmProvider;
  let push: MockPushProvider;
  let admin: StaffSession;
  let a: TestDriver;
  let b: TestDriver;
  let orgA = '';
  let orgB = '';
  let inspectionId = '';
  const createdOrgs: string[] = [];
  const post = (path: string, tokens: { accessToken: string }, body: object = {}) => request(server()).post(path).set(bearer(tokens)).send(body);
  const get = (path: string, tokens: { accessToken: string }) => request(server()).get(path).set(bearer(tokens));
  /** Formulaire multipart (photos) : sans `.send()`, incompatible avec `.attach()`. */
  const upload = (path: string, tokens: { accessToken: string }) => request(server()).post(path).set(bearer(tokens));

  async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 15_000): Promise<T> {
    const start = Date.now();
    for (;;) {
      const value = await read();
      if (ok(value)) return value;
      if (Date.now() - start > timeoutMs) throw new Error(`Délai dépassé : ${what}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    llm = app.get<MockLlmProvider>(LLM_PROVIDER);
    push = app.get<MockPushProvider>(PUSH_PROVIDER);
    const database = db(app);
    // Agents lecteurs d'images et leurs prompts (base partagée : ajoutés s'ils manquent, jamais réécrits).
    for (const [code, file] of [['vehicle_inspection', 'vehicle-inspection.v1.md'], ['performance_reading', 'performance-reading.v1.md']] as const) {
      await database.insert(schema.agents).values({ code, name: `Booster ${code}`, mode: 'approval', model: 'claude-opus-5-5', effort: 'medium', systemPromptKey: `${code}.v1`, tools: [], thresholds: { confirmation: 'driver' } }).onConflictDoNothing();
      await database.insert(schema.agentPrompts).values({ key: `${code}.v1`, agentCode: code, version: 1, body: promptBody(file), sha256: '0'.repeat(64) }).onConflictDoNothing();
    }
    const [root] = await database.select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    const createOrg = async (name: string) => {
      const id = randomUUID();
      await database.insert(schema.organizations).values({ id, code: `booster-${name}-${id.slice(0, 8)}`, name: `Booster ${name}`, type: 'fleet', parentId: root!.id, path: `${root!.path}${id}/` });
      createdOrgs.push(id);
      return id;
    };
    orgA = await createOrg('a');
    orgB = await createOrg('b');
    admin = await createStaffAndLogin(app, ['admin']);
    a = await createDriver(app, 'neo_premium', { firstName: 'Amina' });
    b = await createDriver(app, 'neo_premium', { firstName: 'Bruno' });
    await database.update(schema.drivers).set({ organizationId: orgA }).where(eq(schema.drivers.id, a.driverId));
    await database.update(schema.drivers).set({ organizationId: orgB }).where(eq(schema.drivers.id, b.driverId));
    await database.insert(schema.devices).values({ userId: a.userId, platform: 'android', pushToken: `ExponentPushToken[booster-${randomUUID().slice(0, 8)}]` });
    llm.script((req) => {
      if (req.schemaName === 'vehicle_inspection') return { output: INSPECTION_OUTPUT };
      if (req.schemaName === 'performance_reading') return { output: READING_OUTPUT };
      return undefined;
    });
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (!app) return;
    await cleanupTestData(app);
    if (createdOrgs.length) await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, createdOrgs));
    await app.close();
  });

  // --- Vérification sommaire -----------------------------------------------------------------------------------------

  it('ouvre un rapport avec ses photos : plaque et nom repris, brouillon, vues déclarées', async ({ skip }) => {
    if (!app) return skip();
    let req = upload('/v1/driver/booster/inspections', a.tokens).field('kinds', KINDS.join(','));
    for (const kind of KINDS) req = req.attach('photos', kind === 'dashboard' ? PNG : JPEG, `${kind}.jpg`);
    const res = await req;
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    inspectionId = res.body.id;
    expect(res.body.status).toBe('draft');
    expect(res.body.photos).toHaveLength(7);
    expect(res.body.photos.map((p: { kind: string }) => p.kind)).toEqual(KINDS);
    expect(res.body.photos[6].contentType).toBe('image/png');
    expect(res.body.plate).toMatch(/^T[A-Z0-9]{6}$/);
    expect(res.body.driverName).toContain('Amina');
    expect(res.body.vehicleId).toBe(a.vehicleId);
    expect(res.body.analysis.status).toBe('none');
    expect(res.body.formats).toEqual([]);
    expect(Object.keys(res.body.items)).toHaveLength(12);
    // Un fichier qui n'est pas une image est refusé ; un autre chauffeur ne voit pas le rapport.
    const bad = await upload('/v1/driver/booster/inspections', a.tokens).attach('photos', Buffer.from('bonjour'), 'x.txt');
    expect(bad.status).toBe(415);
    expect((await get(`/v1/driver/booster/inspections/${inspectionId}`, b.tokens)).status).toBe(404);
  });

  it('refuse l\'analyse sans assez de photos, puis analyse et préremplit (champs lus, voyant, défauts, éléments visibles)', async ({ skip }) => {
    if (!app) return skip();
    const few = await upload('/v1/driver/booster/inspections', a.tokens).attach('photos', JPEG, 'a.jpg').attach('photos', JPEG, 'b.jpg');
    expect(few.status).toBe(201);
    const refused = await post(`/v1/driver/booster/inspections/${few.body.id}/analyse`, a.tokens);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('NOT_ENOUGH_PHOTOS');

    const res = await post(`/v1/driver/booster/inspections/${inspectionId}/analyse`, a.tokens);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('analysed');
    expect(res.body.analysis.status).toBe('done');
    expect(res.body.analysis.promptKey).toBe('vehicle_inspection.v1');
    expect(res.body.analysis.confidence).toBe(0.68);
    expect(res.body.analysis.photosUnusable).toEqual([6]);
    expect(res.body.analysis.itemsFromAnalysis).toEqual(['lights', 'mirrors', 'tires', 'warning_lights']);
    expect(res.body.odometerKm).toBe(123_456);
    expect(res.body.energyPercent).toBe(72);
    expect(res.body.warningLightOn).toBe(true);
    expect(res.body.warningLightReason).toBe('Pression des pneus (pneu sous-gonflé)');
    expect(res.body.items.tires).toEqual({ state: 'major', note: 'bande de roulement lisse' });
    expect(res.body.items.mirrors).toEqual({ state: 'minor', note: 'rétroviseur droit fissuré' });
    expect(res.body.items.warning_lights.state).toBe('minor');
    expect(res.body.bodyZones).toEqual([{ zone: 'front_left', description: 'rayure : rayure de 10 cm' }, { zone: 'rear_right', description: 'pneu usé : bande de roulement lisse' }]);
    expect(res.body.severity).toBe('major');
    // Le modèle a reçu les sept photos en pièces jointes, avec le prompt versionné.
    const vision = llm.requests.find((r) => r.schemaName === 'vehicle_inspection')!;
    expect(vision.messages[0]!.attachments).toHaveLength(7);
    expect(vision.system).toContain('vérification sommaire');
    // Journal des agents : une exécution réussie, avec son coût.
    const [run] = await db(app).select().from(schema.agentRuns).where(and(eq(schema.agentRuns.agentCode, 'vehicle_inspection'), eq(schema.agentRuns.triggerRef, `${inspectionId}:1`)));
    expect(run?.status).toBe('succeeded');
  });

  it('le chauffeur corrige (gravité recalculée) ; l\'archivage exige l\'attestation et produit le PDF ; une défectuosité majeure alerte le dispatch', async ({ skip }) => {
    if (!app) return skip();
    const corrected = await request(server()).patch(`/v1/driver/booster/inspections/${inspectionId}`).set(bearer(a.tokens)).send({ items: { ...INSPECTION_ITEMS_OK(), mirrors: { state: 'minor', note: 'fissuré' } }, bodyZones: [], licenceNumber: 'T1234-567890-12', accessoryNumber: 'A-42' });
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200);
    expect(corrected.body.severity).toBe('minor');
    expect(corrected.body.licenceNumber).toBe('T1234-567890-12');
    const [stored] = await db(app).select({ licence: schema.vehicleInspections.licenceNumber }).from(schema.vehicleInspections).where(eq(schema.vehicleInspections.id, inspectionId));
    expect(stored!.licence).not.toContain('567890');

    const noAttestation = await post(`/v1/driver/booster/inspections/${inspectionId}/confirm`, a.tokens, { allItemsChecked: false });
    expect(noAttestation.status).toBe(400);
    const archived: Array<{ inspectionId: string; severity: string }> = [];
    const off = app.get(DomainEventsService).on('booster.inspection_archived', (e) => { archived.push({ inspectionId: e.inspectionId, severity: e.severity }); });
    const res = await post(`/v1/driver/booster/inspections/${inspectionId}/confirm`, a.tokens, { allItemsChecked: true, items: { ...INSPECTION_ITEMS_OK(), tires: { state: 'major', note: 'pneu lisse' } }, notes: 'Pneu à remplacer avant le service.' });
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('archived');
    expect(res.body.severity).toBe('major');
    expect(res.body.allItemsChecked).toBe(true);
    expect(res.body.confirmedAt).not.toBeNull();
    expect(res.body.formats).toEqual(['pdf', 'jpeg']);
    expect(archived).toEqual([{ inspectionId, severity: 'major' }]);
    const pdf = await get(`/v1/driver/booster/inspections/${inspectionId}/pdf`, a.tokens);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const link = await get(`/v1/driver/booster/inspections/${inspectionId}/download`, a.tokens);
    expect(link.status).toBe(200);
    expect(link.body.format).toBe('pdf');
    expect(link.body.url).toContain('mock://storage/');
    // Copie JPEG : rendue par pdftoppm et ffmpeg (image de l'API) ; sans ces outils (poste de développement), 503 explicite.
    const jpeg = await get(`/v1/driver/booster/inspections/${inspectionId}/jpeg`, a.tokens);
    if (jpeg.status === 200) {
      expect(jpeg.headers['content-type']).toBe('image/jpeg');
      expect([...jpeg.body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
      const jpegLink = await get(`/v1/driver/booster/inspections/${inspectionId}/download?format=jpeg`, a.tokens);
      expect(jpegLink.body).toMatchObject({ format: 'jpeg', url: expect.stringContaining('.jpg') });
    } else {
      expect(jpeg.status).toBe(503);
      expect(jpeg.body.code).toBe('JPEG_UNAVAILABLE');
      expect((await get(`/v1/driver/booster/inspections/${inspectionId}/download?format=jpeg`, a.tokens)).status).toBe(503);
    }
    expect((await get(`/v1/driver/booster/inspections/${inspectionId}/download?format=png`, a.tokens)).status).toBe(400);
    const photo = await get(`/v1/driver/booster/inspections/${inspectionId}/photos/0`, a.tokens);
    expect(photo.status).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    // Archivé : plus de modification ; la liste du chauffeur le montre ; le dispatch est alerté par courriel.
    expect((await request(server()).patch(`/v1/driver/booster/inspections/${inspectionId}`).set(bearer(a.tokens)).send({ notes: 'x' })).status).toBe(409);
    const list = await get('/v1/driver/booster/inspections?status=archived', a.tokens);
    expect(list.body.items.map((i: { id: string }) => i.id)).toContain(inspectionId);
    const alerts = await until(() => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.inspection_major'), eq(schema.notifications.recipientUserId, admin.userId))), (rows) => rows.length > 0, 'alerte du personnel');
    expect((alerts[0]!.data as { items: string }).items).toBe('Pneus');
    const audit = await until(() => db(app!).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'booster.inspection_archived'), eq(schema.auditLog.entityId, inspectionId))), (rows) => rows.length > 0, 'archivage journalisé');
    expect((audit[0]!.after as { severity: string }).severity).toBe('major');
  });

  it('le dispatch liste, filtre (gravité, chauffeur, jour), lit le détail (permis masqué), le PDF, les photos, les manquants du jour et l\'export CSV', async ({ skip }) => {
    if (!app) return skip();
    const today = localMoment(new Date(), TZ).date;
    const all = await get('/v1/admin/booster/inspections?majorOnly=true', admin.tokens);
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const mine = all.body.items.find((i: { id: string }) => i.id === inspectionId);
    expect(mine).toBeDefined();
    expect(mine.licenceNumber).toBeUndefined();
    expect(mine.licenceNumberLast4).toBe('0-12');
    expect(mine.driverPublicNumber).toBeDefined();
    expect(mine.organizationId).toBe(orgA);
    const byDriver = await get(`/v1/admin/booster/inspections?driverId=${a.driverId}&date=${today}`, admin.tokens);
    expect(byDriver.body.items.map((i: { id: string }) => i.id)).toContain(inspectionId);
    expect((await get(`/v1/admin/booster/inspections?driverId=${b.driverId}`, admin.tokens)).body.total).toBe(0);
    const detail = await get(`/v1/admin/booster/inspections/${inspectionId}`, admin.tokens);
    expect(detail.status).toBe(200);
    expect(detail.body.driverFullName).toContain('Amina');
    expect((await get(`/v1/admin/booster/inspections/${inspectionId}/pdf`, admin.tokens)).headers['content-type']).toContain('application/pdf');
    expect((await get(`/v1/admin/booster/inspections/${inspectionId}/photos/6`, admin.tokens)).headers['content-type']).toBe('image/png');
    expect((await get(`/v1/admin/booster/inspections/${inspectionId}/photos/9`, admin.tokens)).status).toBe(404);
    // Chauffeurs en ligne sans rapport archivé aujourd'hui : B (en ligne, rien), pas A (rapport archivé).
    await db(app).update(schema.drivers).set({ isOnline: true }).where(inArray(schema.drivers.id, [a.driverId, b.driverId]));
    const missing = await get('/v1/admin/booster/inspections/missing-today', admin.tokens);
    expect(missing.status).toBe(200);
    const ids = missing.body.map((m: { driverId: string }) => m.driverId);
    expect(ids).toContain(b.driverId);
    expect(ids).not.toContain(a.driverId);
    await db(app).update(schema.drivers).set({ isOnline: false }).where(inArray(schema.drivers.id, [a.driverId, b.driverId]));
    const csv = await get(`/v1/admin/booster/inspections/export.csv?driverId=${a.driverId}`, admin.tokens);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toContain('date;heure;chauffeur');
    expect(csv.text).toContain('"major"');
    expect(csv.text).toContain('Pneus (major)');
    // Un chauffeur n'a pas accès aux routes du dispatch.
    expect((await get('/v1/admin/booster/inspections', a.tokens)).status).toBe(403);
  });

  it('isole les rapports entre organisations : sous le contexte de A, ceux de B sont invisibles, la plateforme voit tout', async ({ skip }) => {
    if (!app) return skip();
    const resB = await upload('/v1/driver/booster/inspections', b.tokens).attach('photos', JPEG, 'b.jpg');
    expect(resB.status).toBe(201);
    const scope = app.get(OrgScopeService);
    const inspections = app.get(InspectionsService);
    const query = { page: 1, pageSize: 100, majorOnly: false };
    const inA = await scope.runForOrganization(orgA, () => inspections.adminList(query));
    expect(inA.items.map((i) => i.id)).toContain(inspectionId);
    expect(inA.items.map((i) => i.id)).not.toContain(resB.body.id);
    const inB = await scope.runForOrganization(orgB, () => inspections.adminList(query));
    expect(inB.items.map((i) => i.id)).toContain(resB.body.id);
    expect(inB.items.map((i) => i.id)).not.toContain(inspectionId);
    const platform = await inspections.adminList(query);
    expect(platform.items.map((i) => i.id)).toEqual(expect.arrayContaining([inspectionId, resB.body.id]));
    const [rowB] = await db(app).select({ organizationId: schema.vehicleInspections.organizationId }).from(schema.vehicleInspections).where(eq(schema.vehicleInspections.id, resB.body.id));
    expect(rowB!.organizationId).toBe(orgB);
  });

  it('une analyse refusée par le modèle est consignée et le rapport reste modifiable à la main', async ({ skip }) => {
    if (!app) return skip();
    let req = upload('/v1/driver/booster/inspections', a.tokens);
    for (let i = 0; i < 6; i += 1) req = req.attach('photos', JPEG, `p${i}.jpg`);
    const created = await req;
    const off = llm.script((r) => (r.schemaName === 'vehicle_inspection' ? { refuse: true } : undefined));
    llm.scripts.unshift(llm.scripts.pop()!);
    const res = await post(`/v1/driver/booster/inspections/${created.body.id}/analyse`, a.tokens);
    off();
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.status).toBe('draft');
    expect(res.body.analysis.status).toBe('failed');
    expect(res.body.analysis.error).toBeTruthy();
    const manual = await post(`/v1/driver/booster/inspections/${created.body.id}/confirm`, a.tokens, { allItemsChecked: true, odometerKm: 1000 });
    expect(manual.status).toBe(200);
    expect(manual.body.severity).toBe('ok');
  });

  it('analyse asynchrone (file agents) : réponse immédiate « en cours », lisible par les routes existantes, résultat après la tâche ; tâche remplacée ignorée ; attente perdue rendue en échec', async ({ skip }) => {
    if (!app) return skip();
    let req = upload('/v1/driver/booster/inspections', a.tokens);
    for (let i = 0; i < 6; i += 1) req = req.attach('photos', JPEG, `async${i}.jpg`);
    const created = await req;
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    const visionCalls = () => llm.requests.filter((r) => r.schemaName === 'vehicle_inspection').length;
    const before = visionCalls();
    const queued = await post(`/v1/driver/booster/inspections/${id}/analyse?async=true`, a.tokens);
    expect(queued.status, JSON.stringify(queued.body)).toBe(200);
    expect(queued.body.analysis).toMatchObject({ status: 'pending', promptKey: 'vehicle_inspection.v1', analysedAt: null, error: null });
    expect(queued.body.status).toBe('draft');
    // Pas d'appel au modèle pendant la requête ; une seconde demande pendant l'attente ne relance rien.
    expect(visionCalls()).toBe(before);
    expect((await post(`/v1/driver/booster/inspections/${id}/analyse?async=true`, a.tokens)).body.analysis.status).toBe('pending');
    expect((await get(`/v1/driver/booster/inspections/${id}`, a.tokens)).body.analysis.status).toBe('pending');
    const [row] = await db(app).select({ analysisCount: schema.vehicleInspections.analysisCount }).from(schema.vehicleInspections).where(eq(schema.vehicleInspections.id, id));
    const attempt = row!.analysisCount;
    // Tâche d'une tentative remplacée : ignorée. Tâche attendue (traitement de la file `agents`, comme le worker) : analyse faite.
    const inspections = app.get(InspectionsService);
    expect(await inspections.runAnalysis(id, attempt + 5)).toBeNull();
    await app.get(AgentJobsService).process('booster.inspection', { id, attempt });
    const done = await get(`/v1/driver/booster/inspections/${id}`, a.tokens);
    expect(done.body.analysis.status).toBe('done');
    expect(done.body.status).toBe('analysed');
    expect(done.body.odometerKm).toBe(123_456);
    expect(visionCalls()).toBe(before + 1);
    // Rejouée après le résultat : rien n'est refait.
    expect(await inspections.runAnalysis(id, attempt)).toBeNull();
    // Attente perdue (tâche jamais traitée depuis plus de 10 minutes) : échec lisible, analyse relançable.
    const stale = { promptKey: 'vehicle_inspection.v1', model: null, analysedAt: new Date(Date.now() - 3_600_000).toISOString(), confidence: null, raw: null, error: null, pending: true, requestedAt: new Date(Date.now() - 3_600_000).toISOString(), attempt: attempt + 1 };
    await db(app).update(schema.vehicleInspections).set({ analysis: stale, analysisCount: attempt + 1 }).where(eq(schema.vehicleInspections.id, id));
    expect((await get(`/v1/driver/booster/inspections/${id}`, a.tokens)).body.analysis).toMatchObject({ status: 'failed', error: 'ANALYSIS_TIMEOUT' });
    const again = await post(`/v1/driver/booster/inspections/${id}/analyse?async=true`, a.tokens);
    expect(again.body.analysis.status).toBe('pending');
    // Sans le paramètre, le réglage `booster.analysis_async` (faux par défaut) garde l'analyse synchrone.
    const sync = await post(`/v1/driver/booster/inspections/${id}/analyse?async=false`, a.tokens);
    expect(sync.body.analysis.status).toBe('done');
  });

  // --- Rapport de performance ----------------------------------------------------------------------------------------

  it('lit des captures d\'écran, laisse le chauffeur compléter, confirme et calcule le solde et les ratios', async ({ skip }) => {
    if (!app) return skip();
    const created = await post('/v1/driver/booster/performance', a.tokens, { date: '2026-10-06', startOdometerKm: 10_000, startEnergyPercent: 90 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe('draft');
    expect(created.body.source).toBe('manual');
    expect((await post(`/v1/driver/booster/performance/${id}/analyse`, a.tokens)).body.code).toBe('NO_SCREENSHOTS');
    const shots = await request(server()).post(`/v1/driver/booster/performance/${id}/screenshots`).set(bearer(a.tokens)).attach('screenshots', JPEG, 'uber-1.jpg').attach('screenshots', PNG, 'uber-2.png');
    expect(shots.status, JSON.stringify(shots.body)).toBe(200);
    expect(shots.body.screenshots).toHaveLength(2);
    expect(shots.body.source).toBe('screenshot');
    const read = await post(`/v1/driver/booster/performance/${id}/analyse`, a.tokens);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.status).toBe('analysed');
    expect(read.body.reading.status).toBe('done');
    expect(read.body.reading.app).toBe('Uber');
    expect(read.body.reading.confidence).toBe(0.8);
    expect(read.body.ridesCents).toBe(24_000);
    expect(read.body.tipsCents).toBe(2_400);
    expect(read.body.promotionsCents).toBe(1_000);
    expect(read.body.ridesCount).toBe(12);
    expect(read.body.onlineMinutes).toBe(480);
    expect(read.body.drivingMinutes).toBe(300);
    // Heures lues sur la capture, dans le fuseau du service (6 octobre 2026, heure avancée : UTC-4).
    expect(read.body.startedAt).toBe('2026-10-06T11:00:00.000Z');
    expect(read.body.endedAt).toBe('2026-10-06T19:30:00.000Z');
    const reading = llm.requests.find((r) => r.schemaName === 'performance_reading')!;
    expect(reading.messages[0]!.attachments).toHaveLength(2);
    const confirmed = await post(`/v1/driver/booster/performance/${id}/confirm`, a.tokens, { endOdometerKm: 10_200, endEnergyPercent: 40, energyCents: 1_500, cleaningCents: 500 });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.status).toBe('confirmed');
    expect(confirmed.body.summary).toMatchObject({ sessionMinutes: 510, basisMinutes: 480, distanceKm: 200, energyUsedPoints: 50, energyPer100Km: 25, drivingSharePercent: 63, grossCents: 27_400, costsCents: 2_000, netCents: 25_400, netPerHourCents: 3_175, netPerKmCents: 127, grossPerRideCents: 2_000, tipsPercent: 10 });
    expect(confirmed.body.formats).toEqual(['pdf', 'jpeg']);
    const pdf = await get(`/v1/driver/booster/performance/${id}/pdf`, a.tokens);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await request(server()).patch(`/v1/driver/booster/performance/${id}`).set(bearer(a.tokens)).send({ tipsCents: 1 })).status).toBe(409);
    expect((await get(`/v1/driver/booster/performance/${id}`, b.tokens)).status).toBe(404);
  });

  it('récapitulatifs hebdomadaire et mensuel exacts sur des données connues, pour le chauffeur et le dispatch', async ({ skip }) => {
    if (!app) return skip();
    // Deux autres sessions saisies à la main : même semaine (8 octobre) et semaine suivante du même mois (13 octobre) ; un brouillon ne compte pas.
    const s2 = await post('/v1/driver/booster/performance', a.tokens, { date: '2026-10-08', onlineMinutes: 240, startOdometerKm: 100, endOdometerKm: 150, ridesCount: 5, ridesCents: 10_000, tipsCents: 500, energyCents: 1_000 });
    expect((await post(`/v1/driver/booster/performance/${s2.body.id}/confirm`, a.tokens)).status).toBe(200);
    const s3 = await post('/v1/driver/booster/performance', a.tokens, { date: '2026-10-13', onlineMinutes: 60, ridesCount: 2, ridesCents: 4_000 });
    expect((await post(`/v1/driver/booster/performance/${s3.body.id}/confirm`, a.tokens)).status).toBe(200);
    expect((await post('/v1/driver/booster/performance', a.tokens, { date: '2026-10-07', ridesCents: 99_999 })).status).toBe(201);

    const week = await get('/v1/driver/booster/performance/recap?period=week&date=2026-10-07', a.tokens);
    expect(week.status, JSON.stringify(week.body)).toBe(200);
    expect(week.body).toMatchObject({ period: 'week', start: '2026-10-05', end: '2026-10-11', label: '2026-W41' });
    expect(week.body.sessions).toHaveLength(2);
    // Semaine : 480 + 240 minutes, 200 + 50 km, 12 + 5 courses, brut 27 400 + 10 500, coûts 2 000 + 1 000, net 25 400 + 9 500.
    expect(week.body.totals).toEqual({ sessions: 2, minutes: 720, distanceKm: 250, rides: 17, grossCents: 37_900, tipsCents: 2_900, costsCents: 3_000, netCents: 34_900, netPerHourCents: 2_908, netPerKmCents: 140 });
    const month = await get('/v1/driver/booster/performance/recap?period=month&date=2026-10-20', a.tokens);
    expect(month.body).toMatchObject({ period: 'month', start: '2026-10-01', end: '2026-10-31', label: '2026-10' });
    expect(month.body.totals).toEqual({ sessions: 3, minutes: 780, distanceKm: 250, rides: 19, grossCents: 41_900, tipsCents: 2_900, costsCents: 3_000, netCents: 38_900, netPerHourCents: 2_992, netPerKmCents: 156 });
    const list = await get('/v1/driver/booster/performance?from=2026-10-01&to=2026-10-31&status=confirmed', a.tokens);
    expect(list.body.total).toBe(3);
    // Dispatch : liste par chauffeur, récapitulatif, export.
    const adminList = await get(`/v1/admin/booster/performance?driverId=${a.driverId}`, admin.tokens);
    expect(adminList.status).toBe(200);
    expect(adminList.body.total).toBe(4);
    expect(adminList.body.items[0].driverFullName).toContain('Amina');
    const adminRecap = await get(`/v1/admin/booster/performance/recap?driverId=${a.driverId}&period=week&date=2026-10-07`, admin.tokens);
    expect(adminRecap.body.totals.netCents).toBe(34_900);
    const csv = await get(`/v1/admin/booster/performance/export.csv?driverId=${a.driverId}&from=2026-10-01&to=2026-10-31`, admin.tokens);
    expect(csv.status).toBe(200);
    expect(csv.text.trim().split('\n')).toHaveLength(4);
    expect(csv.text).toContain('"25400"');
  });

  // --- Alertes ---------------------------------------------------------------------------------------------------------

  it('réglages des alertes : défauts documentés, fusion, fenêtres de gain de la plateforme, test du son par push', async ({ skip }) => {
    if (!app) return skip();
    const defaults = await get('/v1/driver/booster/alerts', a.tokens);
    expect(defaults.status).toBe(200);
    expect(defaults.body).toMatchObject({ sessionStart: '07:00', sessionEnd: '17:00', timeZone: TZ, updatedAt: null });
    expect(defaults.body.reminders.inspection).toBe(true);
    expect(defaults.body.styles.inspection.sound).toBe('check');
    expect(defaults.body.peakPeriods.length).toBeGreaterThan(0);
    expect(defaults.body.sounds).toContain('peak');
    const updated = await request(server()).put('/v1/driver/booster/alerts').set(bearer(a.tokens)).send({ sessionEnd: '18:30', reminders: { peak_zone: false }, styles: { session_end: { sound: 'none', color: '#112233' } } });
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body.sessionEnd).toBe('18:30');
    expect(updated.body.sessionStart).toBe('07:00');
    expect(updated.body.reminders).toMatchObject({ inspection: true, peak_zone: false });
    expect(updated.body.styles.session_end).toEqual({ sound: 'none', color: '#112233' });
    expect(updated.body.updatedAt).not.toBeNull();
    expect((await request(server()).put('/v1/driver/booster/alerts').set(bearer(a.tokens)).send({ sessionStart: '7h' })).status).toBe(400);
    // Test du son : une notification push immédiate avec le canal et le son du type.
    const test = await post('/v1/driver/booster/alerts/test', a.tokens, { type: 'peak_period' });
    expect(test.status).toBe(200);
    const [queued] = await until(() => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'booster.alert_test'), eq(schema.notifications.recipientUserId, a.userId))), (rows) => rows.length > 0, 'test mis en file');
    expect(queued!.channel).toBe('push');
    expect(await app.get(NotificationDeliveryService).deliver(queued!.id)).toBe('sent');
    const sent = push.sent.at(-1)!;
    expect(sent.channelId).toBe('booster-peak');
    expect(sent.sound).toBe('booster_peak.wav');
    expect(sent.data).toMatchObject({ alertType: 'peak_period', screen: 'booster', color: '#16A34A' });
  });

  it('la passe planifiée envoie les alertes dues à l\'heure habituelle, une fois par jour ; la vérification n\'est rappelée que sans rapport du jour', async ({ skip }) => {
    if (!app) return skip();
    const now = new Date();
    const local = localMoment(now, TZ);
    const hhmm = `${String(Math.floor(local.minutes / 60)).padStart(2, '0')}:${String(local.minutes % 60).padStart(2, '0')}`;
    // A (rapport archivé aujourd'hui) et B (aucun) commencent leur session maintenant ; A reçoit les informations et le début, B aussi la vérification sommaire.
    for (const d of [a, b]) expect((await request(server()).put('/v1/driver/booster/alerts').set(bearer(d.tokens)).send({ sessionStart: hhmm, sessionEnd: '23:59', reminders: { peak_period: false, peak_zone: false } })).status).toBe(200);
    const alerts = app.get(AlertsService);
    const first = await alerts.tick(now);
    expect(first.sent).toBeGreaterThanOrEqual(5);
    const templatesOf = async (userId: string) => (await db(app!).select({ template: schema.notifications.template }).from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), inArray(schema.notifications.template, ['booster.inspection', 'booster.session_info', 'booster.session_start', 'booster.session_end'])))).map((r) => r.template).sort();
    expect(await templatesOf(a.userId)).toEqual(['booster.session_info', 'booster.session_start']);
    expect(await templatesOf(b.userId)).toEqual(['booster.inspection', 'booster.session_info', 'booster.session_start']);
    // Rejouer la passe dans la même minute n'envoie rien de plus (marques du jour).
    const again = await alerts.tick(now);
    expect(again.sent).toBe(0);
    expect(await templatesOf(a.userId)).toHaveLength(2);
    // Envoi réel par le push simulé : canal « session » et son du type, écran du rapport de performance pour les informations de début.
    const [info] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, a.userId), eq(schema.notifications.template, 'booster.session_info')));
    expect(await app.get(NotificationDeliveryService).deliver(info!.id)).toBe('sent');
    const sent = push.sent.at(-1)!;
    expect(sent.channelId).toBe('booster-session');
    expect(sent.sound).toBe('booster_session.wav');
    expect(sent.data).toMatchObject({ screen: 'booster-performance', alertType: 'session_info', color: '#1485E0' });
    expect(sent.title).toBe('Démarrage de session');
  });
});

/** Les douze éléments conformes (forme attendue par l'API). */
function INSPECTION_ITEMS_OK(): Record<string, { state: 'ok'; note: null }> {
  return Object.fromEntries(['brake_fluid', 'parking_brake', 'lights', 'tires', 'valves', 'wipers', 'washer', 'mirrors', 'roof_light', 'warning_lights', 'battery', 'ramp'].map((k) => [k, { state: 'ok' as const, note: null }]));
}
