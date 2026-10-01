import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockSmsProvider, MockStorageProvider } from '../src/adapters/mock/index.js';
import { SMS_PROVIDER, STORAGE_PROVIDER } from '../src/adapters/types.js';
import { currentOrgScope } from '../src/common/org-scope.context.js';
import { AdminIncidentsService } from '../src/modules/admin/admin-incidents.service.js';
import { ConversationsService } from '../src/modules/agents/conversations.service.js';
import type { UserActor } from '../src/modules/auth/actor.js';
import { ComplianceService } from '../src/modules/compliance/compliance.service.js';
import { CreditsService } from '../src/modules/credits/credits.service.js';
import { DriverActivityService } from '../src/modules/drivers/driver-activity.service.js';
import { InvoiceJobsService } from '../src/modules/invoicing/invoice-jobs.service.js';
import { NotificationJobsService } from '../src/modules/notifications/notification-jobs.service.js';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';
import { NotificationsOutbox } from '../src/modules/rides/notifications-outbox.js';
import { RidesService } from '../src/modules/rides/rides.service.js';
import { ScheduledService } from '../src/modules/rides/scheduled.service.js';
import { SettlementJobsService } from '../src/modules/settlement/settlement-jobs.service.js';
import { StatementsService } from '../src/modules/settlement/statements.service.js';
import { cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, testPhone, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Étape 20, critère 3 et colonnes d'organisation : les lignes créées (avis, conversations, incidents, crédits, relevés)
 * portent l'organisation du contexte, sinon celle de la course, du chauffeur ou de la personne concernée ; les tâches de
 * fond (relevés, rappels des planifiées, conformité, envoi des avis, facturation) s'exécutent par lots, chaque organisation
 * cliente sous son contexte, la plateforme sans contexte. Deux organisations sœurs A et B sous la racine.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lng: -73.582, lat: 45.523 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lng: -73.567, lat: 45.5 } };
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const MARKER = `iso-jobs-${RUN}`;
/** Semaine réglée par la passe du vendredi 14 mars 2025 à 6 h 30 (heure de Montréal) : loin des données des autres fichiers. */
const PERIOD_START = '2025-03-03';
const FRIDAY = new Date('2025-03-14T10:30:00Z');

interface Org {
  id: string;
  path: string;
}

interface Party {
  org: Org;
  driver: TestDriver;
  client: TokensView;
  clientId: string;
  /** Course terminée dans la semaine réglée, de l'organisation. */
  rideId: string;
  /** Course planifiée de demain, réservée il y a deux jours (rappel de la veille dû). */
  scheduledRideId: string;
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('isolation par organisation : lignes créées et tâches de fond (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let scope: OrgScopeService;
  let root: Org;
  let A: Party;
  let B: Party;
  /** Chauffeur de A qui a aussi servi une course de la plateforme dans la semaine : relevé fait par la plateforme. */
  let mixed: TestDriver;
  let mixedRides: string[] = [];
  let staff: StaffSession;
  let staffActor: UserActor;
  let seq = 0;

  async function createOrganization(name: string): Promise<Org> {
    const id = randomUUID();
    const path = `${root.path}${id}/`;
    await db(app!).insert(schema.organizations).values({ id, code: `isj-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `Isolation tâches ${name}`, type: 'fleet', parentId: root.id, path });
    return { id, path };
  }

  async function attachDriver(org: Org): Promise<TestDriver> {
    const driver = await createDriver(app!, 'neo_premium', { acceptsScheduled: false });
    await db(app!).update(schema.drivers).set({ organizationId: org.id }).where(eq(schema.drivers.id, driver.driverId));
    await db(app!).update(schema.vehicles).set({ organizationId: org.id }).where(eq(schema.vehicles.id, driver.vehicleId));
    return driver;
  }

  async function insertRide(o: { org: string; driver?: TestDriver; clientId?: string | null; completedAt?: string; requestedAt?: Date; createdAt?: Date }): Promise<string> {
    const completed = Boolean(o.completedAt);
    const [row] = await db(app!).insert(schema.rides).values({
      publicNumber: `ISJ-${RUN}-${(seq += 1)}`, cityCode: 'montreal', clientId: o.clientId ?? null, guestName: o.clientId ? null : 'Camille Invitée', guestPhone: o.clientId ? null : testPhone(),
      driverId: o.driver?.driverId ?? null, vehicleId: o.driver?.vehicleId ?? null, organizationId: o.org, reservedCategory: 'neo_premium', state: completed ? 'completed' : 'requested', type: 'scheduled',
      requestedAt: o.requestedAt ?? null, originAddress: PLATEAU.address, originPosition: PLATEAU.coordinates, destinationAddress: CENTRE.address, destinationPosition: CENTRE.coordinates,
      paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: 5_000, quotedTotalCents: 3_156, finalPriceCents: completed ? 3_156 : null,
      fareCents: 2_455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274, distanceMeters: 8_000, durationSeconds: 1_080,
      stateTimestamps: completed ? { completed: o.completedAt } : { requested: new Date().toISOString() }, ...(o.createdAt ? { createdAt: o.createdAt } : {}),
    }).returning({ id: schema.rides.id });
    return row!.id;
  }

  async function party(org: Org): Promise<Party> {
    const driver = await attachDriver(org);
    const client = await loginByOtp(app!);
    const [clientRow] = await db(app!).update(schema.clients).set({ organizationId: org.id }).where(eq(schema.clients.userId, client.user.id)).returning({ id: schema.clients.id });
    const rideId = await insertRide({ org: org.id, driver, clientId: clientRow!.id, completedAt: '2025-03-05T15:00:00Z' });
    const scheduledRideId = await insertRide({ org: org.id, clientId: clientRow!.id, requestedAt: new Date(Date.now() + 23 * 3_600_000), createdAt: new Date(Date.now() - 2 * 86_400_000) });
    return { org, driver, client, clientId: clientRow!.id, rideId, scheduledRideId };
  }

  const notice = async (marker: string) => (await db(app!).select().from(schema.notifications).where(sql`${schema.notifications.data}->>'marker' = ${marker}`))[0];
  const auditOrg = async (action: string, entityId: string) =>
    until(async () => (await db(app!).select({ organizationId: schema.auditLog.organizationId }).from(schema.auditLog).where(and(eq(schema.auditLog.action, action), eq(schema.auditLog.entityId, entityId))))[0], Boolean, `audit ${action}`);

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    scope = app.get(OrgScopeService);
    const [rootRow] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    root = rootRow!;
    const [orgA, orgB] = await Promise.all([createOrganization('A'), createOrganization('B')]);
    A = await party(orgA);
    B = await party(orgB);
    mixed = await attachDriver(orgA);
    mixedRides = [await insertRide({ org: orgA.id, driver: mixed, clientId: A.clientId, completedAt: '2025-03-06T15:00:00Z' }), await insertRide({ org: root.id, driver: mixed, completedAt: '2025-03-07T15:00:00Z' })];
    staff = await createStaffAndLogin(app, ['operator']);
    staffActor = { kind: 'user', userId: staff.userId, sessionId: randomUUID(), primaryRole: 'operator', roles: ['operator'], amr: ['pwd', 'mfa'] };
  });

  afterAll(async () => {
    if (app) {
      const drivers = [A?.driver.driverId, B?.driver.driverId, mixed?.driverId].filter((id): id is string => Boolean(id));
      if (drivers.length) await db(app).delete(schema.complianceChecks).where(inArray(schema.complianceChecks.entityId, drivers));
      // Alertes de test au personnel restées en attente : jamais envoyées par une API lancée plus tard sur cette base.
      await db(app).update(schema.notifications).set({ error: 'test_cleanup' }).where(and(isNull(schema.notifications.sentAt), isNull(schema.notifications.error), sql`${schema.notifications.data}->>'marker' LIKE ${`${MARKER}%`}`));
      await cleanupTestData(app);
      const orgs = [A?.org.id, B?.org.id].filter((id): id is string => Boolean(id));
      if (orgs.length) await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, orgs)).catch(() => undefined);
    }
    await app?.close();
  });

  it('contexte imbriqué : une autre organisation dans une transaction à part, sans changer la portée englobante ; le travail qui survit retombe sur la plateforme', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const ids = [A.driver.driverId, B.driver.driverId];
    const seen = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();
    let late: Promise<{ rows: string[]; organizationId: string | null }> | null = null;
    await scope.run(A.org.path, async (tx) => {
      const inner = await scope.run(B.org.path, async (txB) => seen(await txB.select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids))));
      expect(inner).toEqual([B.driver.driverId]);
      // La portée de A n'a pas bougé (pas de `SET LOCAL` d'un point de sauvegarde), ni pour la transaction, ni pour les services.
      expect(seen(await tx.select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids)))).toEqual([A.driver.driverId]);
      expect(seen(await db(app!).select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids)))).toEqual([A.driver.driverId]);
      // Même organisation : point de sauvegarde de la transaction en cours.
      expect(await scope.run(A.org.path, async (sp) => seen(await sp.select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids))))).toEqual([A.driver.driverId]);
      late = (async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { rows: seen(await db(app!).select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.id, ids))), organizationId: currentOrgScope()?.organizationId ?? null };
      })();
    });
    // Après la fin de la transaction : le pool de la plateforme (pas un exécuteur mort), l'organisation gardée pour l'étiquetage.
    expect(await late).toEqual({ rows: ids.slice().sort(), organizationId: A.org.id });
  });

  it('organisation posée à la création : sous le contexte de A, avis, conversation, incident et crédit portent A', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    let conversationId = '';
    let incidentId = '';
    let creditId = '';
    await scope.run(A.org.path, async (tx) => {
      await app!.get(NotificationsOutbox).queue({ recipientUserId: A.client.user.id, channel: 'in_app', template: 'iso.jobs', data: { marker: `${MARKER}-ctx` } });
      conversationId = (await app!.get(ConversationsService).receive({ channel: 'app', externalId: `${MARKER}-ctx`, userId: A.client.user.id, phone: null, text: 'Bonjour', language: 'fr', rideId: null })).conversation.id;
      incidentId = (await app!.get(DriverActivityService).reportIncident(A.driver.userId, A.rideId, { kind: 'lost_item', description: 'Parapluie oublié sur la banquette' })).incidentId;
      creditId = await app!.get(CreditsService).grant(tx, { userId: A.client.user.id, amountCents: 500, origin: 'goodwill', note: MARKER });
    });
    expect((await notice(`${MARKER}-ctx`))?.organizationId).toBe(A.org.id);
    expect((await db(app).select({ o: schema.conversations.organizationId }).from(schema.conversations).where(eq(schema.conversations.id, conversationId)))[0]?.o).toBe(A.org.id);
    expect((await db(app).select({ o: schema.incidents.organizationId }).from(schema.incidents).where(eq(schema.incidents.id, incidentId)))[0]?.o).toBe(A.org.id);
    expect((await db(app).select({ o: schema.credits.organizationId }).from(schema.credits).where(eq(schema.credits.id, creditId)))[0]?.o).toBe(A.org.id);
    // Sous contexte, l'organisation proposée par l'appelant ne l'emporte jamais sur celle du contexte : la ligne reste à A.
    const forced = await scope.run(A.org.path, (tx) => app!.get(CreditsService).grant(tx, { userId: A.client.user.id, amountCents: 100, origin: 'goodwill', organizationId: B.org.id }));
    expect((await db(app).select({ o: schema.credits.organizationId }).from(schema.credits).where(eq(schema.credits.id, forced)))[0]?.o).toBe(A.org.id);
  });

  it('organisation posée à la création par la plateforme : celle de la course, du chauffeur ou de la personne (service ou base)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const outbox = app.get(NotificationsOutbox);
    const rides = app.get(RidesService);
    // Avis : organisation donnée par le service (destinataire de la course), puis dérivée par la base (course dans `data`).
    await outbox.queue({ ...(await rides.recipientOf(await rides.getRide(A.rideId))), channel: 'in_app', template: 'iso.jobs', data: { marker: `${MARKER}-recipient` } });
    await outbox.queue({ recipientUserId: B.client.user.id, channel: 'in_app', template: 'iso.jobs', data: { marker: `${MARKER}-ride-b`, rideId: B.rideId } });
    await outbox.queue({ recipientUserId: staff.userId, channel: 'in_app', template: 'iso.jobs', data: { marker: `${MARKER}-platform` } });
    expect((await notice(`${MARKER}-recipient`))?.organizationId).toBe(A.org.id);
    expect((await notice(`${MARKER}-ride-b`))?.organizationId).toBe(B.org.id);
    expect((await notice(`${MARKER}-platform`))?.organizationId).toBeNull();
    // Conversation : dérivée de la course (base) ; incident : organisation de la course (service) ; crédit : profil de la personne (base).
    const conversation = await app.get(ConversationsService).receive({ channel: 'web', externalId: `${MARKER}-web`, userId: A.client.user.id, phone: null, text: 'Où est mon reçu ?', language: 'fr', rideId: A.rideId });
    expect(conversation.conversation.organizationId).toBe(A.org.id);
    const incident = await app.get(AdminIncidentsService).create({ type: 'lost_item', severity: 'low', description: 'Objet trouvé dans le véhicule', rideId: B.rideId }, staffActor);
    expect((await db(app).select({ o: schema.incidents.organizationId }).from(schema.incidents).where(eq(schema.incidents.id, incident.id)))[0]?.o).toBe(B.org.id);
    const [raw] = await db(app).insert(schema.incidents).values({ rideId: A.rideId, type: 'other', reportedByKind: 'system', description: 'Insertion directe sans organisation' }).returning({ o: schema.incidents.organizationId });
    expect(raw!.o).toBe(A.org.id);
    const credits = app.get(CreditsService);
    const driverCredit = await credits.grant(db(app), { userId: B.driver.userId, amountCents: 200, origin: 'driver_pack', note: MARKER });
    const clientCredit = await credits.grant(db(app), { userId: A.client.user.id, amountCents: 300, origin: 'goodwill', note: MARKER });
    const staffCredit = await credits.grant(db(app), { userId: staff.userId, amountCents: 100, origin: 'goodwill', note: MARKER });
    const orgOf = async (id: string) => (await db(app!).select({ o: schema.credits.organizationId }).from(schema.credits).where(eq(schema.credits.id, id)))[0]?.o;
    expect([await orgOf(driverCredit), await orgOf(clientCredit), await orgOf(staffCredit)]).toEqual([B.org.id, A.org.id, null]);
  });

  it('relevés : une génération sous le contexte de A ne touche que A ; sans contexte, tout ; le relevé appartient à l\'organisation du chauffeur', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const statements = app.get(StatementsService);
    const mine = async (driverId: string) => db(app!).select().from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.driverId, driverId), eq(schema.weeklyStatements.periodStart, PERIOD_START)));
    const underA = await scope.run(A.org.path, () => statements.generate({ periodStart: PERIOD_START }, FRIDAY));
    expect(underA.statements.map((s) => s.driverId).sort()).toEqual([A.driver.driverId, mixed.driverId].sort());
    expect(await mine(B.driver.driverId)).toHaveLength(0);
    expect((await mine(A.driver.driverId))[0]).toMatchObject({ organizationId: A.org.id, status: 'draft' });
    // Sans contexte : la plateforme voit tout (B, et les deux courses du chauffeur mixte dans son brouillon recalculé).
    const all = await statements.generate({ periodStart: PERIOD_START }, FRIDAY);
    expect(all.statements.map((s) => s.driverId)).toEqual(expect.arrayContaining([A.driver.driverId, B.driver.driverId, mixed.driverId]));
    expect((await mine(B.driver.driverId))[0]).toMatchObject({ organizationId: B.org.id, status: 'draft' });
    const mixedDraft = all.statements.find((s) => s.driverId === mixed.driverId)!;
    expect(new Set(mixedDraft.lines.map((l) => l.rideId).filter(Boolean))).toEqual(new Set(mixedRides));
    // Le chauffeur mixte est écarté des lots d'organisation : la plateforme le règle, complet.
    expect([...(await statements.driversWithForeignRides({ startDate: PERIOD_START, endDate: '2025-03-09', timeZone: 'America/Toronto' }))]).toContain(mixed.driverId);
  });

  it('passe du vendredi par lots : chaque relevé émis sous le contexte de son organisation, le chauffeur mixte par la plateforme ; PDF rangés sous le préfixe de l\'organisation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const report = await app.get(SettlementJobsService).tick(FRIDAY);
    expect(report.issued).toBeGreaterThanOrEqual(3);
    const statementOf = async (driverId: string) => (await db(app!).select().from(schema.weeklyStatements).where(and(eq(schema.weeklyStatements.driverId, driverId), eq(schema.weeklyStatements.periodStart, PERIOD_START))))[0]!;
    const [a, b, m] = [await statementOf(A.driver.driverId), await statementOf(B.driver.driverId), await statementOf(mixed.driverId)];
    for (const s of [a, b, m]) expect(s.status).not.toBe('draft');
    expect([a.organizationId, b.organizationId, m.organizationId]).toEqual([A.org.id, B.org.id, A.org.id]);
    // L'émission s'est faite sous le contexte de l'organisation (journal à son nom), sauf pour le chauffeur mixte (plateforme).
    expect((await auditOrg('statement.issued', a.id))?.organizationId).toBe(A.org.id);
    expect((await auditOrg('statement.issued', b.id))?.organizationId).toBe(B.org.id);
    expect((await auditOrg('statement.issued', m.id))?.organizationId).toBeNull();
    const lines = await db(app).select({ rideId: schema.statementLines.rideId }).from(schema.statementLines).where(eq(schema.statementLines.statementId, m.id));
    expect(new Set(lines.map((l) => l.rideId).filter(Boolean))).toEqual(new Set(mixedRides));
    // Avis du relevé à son organisation ; PDF produit sous son contexte, rangé sous son préfixe.
    const issuedNotice = (await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'statement.issued'), sql`${schema.notifications.data}->>'statementId' = ${a.id}`)))[0];
    expect(issuedNotice?.organizationId).toBe(A.org.id);
    const pdfOf = (id: string) => until(async () => (await db(app!).select({ k: schema.weeklyStatements.pdfKey }).from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)))[0]?.k ?? null, Boolean, 'PDF du relevé');
    expect(await pdfOf(a.id)).toMatch(new RegExp(`^org/${A.org.id}/statements/`));
    expect(await pdfOf(b.id)).toMatch(new RegExp(`^org/${B.org.id}/statements/`));
    expect(app.get<MockStorageProvider>(STORAGE_PROVIDER).objects.has((await pdfOf(a.id))!)).toBe(true);
  });

  it('rappels des planifiées : chaque course traitée sous le contexte de son organisation, avis à son nom', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const report = await app.get(ScheduledService).tick(new Date());
    expect(report.reminders).toEqual(expect.arrayContaining([A.scheduledRideId, B.scheduledRideId]));
    for (const p of [A, B]) {
      const reminders = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'ride.scheduled_reminder'), sql`${schema.notifications.data}->>'rideId' = ${p.scheduledRideId}`));
      expect(reminders.length).toBeGreaterThan(0);
      expect(new Set(reminders.map((n) => n.organizationId))).toEqual(new Set([p.org.id]));
      expect(reminders.every((n) => n.recipientUserId === p.client.user.id)).toBe(true);
    }
    // Rejouée, la passe n'émet rien de plus pour ces courses (marque dans le journal de la course).
    const again = await app.get(ScheduledService).tick(new Date());
    expect(again.reminders).not.toContain(A.scheduledRideId);
  });

  it('conformité : une passe sous le contexte de A ne crée d\'échéances que pour ses chauffeurs ; la plateforme traite les autres', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    for (const driverId of [A.driver.driverId, B.driver.driverId]) {
      await db(app).update(schema.driverDocuments).set({ expiresOn: '2026-10-20' }).where(and(eq(schema.driverDocuments.driverId, driverId), eq(schema.driverDocuments.type, 'licence')));
    }
    const checks = (driverId: string) => db(app!).select().from(schema.complianceChecks).where(and(eq(schema.complianceChecks.entityId, driverId), eq(schema.complianceChecks.type, 'document:licence')));
    const now = new Date('2026-09-20T13:00:00Z');
    const report = await scope.runFor(A.org.id, () => app!.get(ComplianceService).run(now));
    expect(report.reminders).toBeGreaterThanOrEqual(1);
    expect((await checks(A.driver.driverId))[0]).toMatchObject({ dueOn: '2026-10-20', remindersSent: 1 });
    expect(await checks(B.driver.driverId)).toHaveLength(0);
    const expiring = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, A.driver.userId), eq(schema.notifications.template, 'document.expiring')));
    expect(expiring.length).toBeGreaterThan(0);
    expect(expiring.every((n) => n.organizationId === A.org.id)).toBe(true);
    await app.get(ComplianceService).run(now, B.driver.driverId);
    expect((await checks(B.driver.driverId))[0]).toMatchObject({ dueOn: '2026-10-20', remindersSent: 1 });
  });

  it('envoi des avis : chacun dans le contexte de son organisation, y compris une alerte au personnel partie du contexte de A', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const outbox = app.get(NotificationsOutbox);
    await scope.run(A.org.path, () => outbox.queueForStaff('alert.agent_escalation', { reason: 'iso', summary: 'Test d\'isolation', marker: `${MARKER}-staff` }, 'sms'));
    const staffAlerts = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, staff.userId), sql`${schema.notifications.data}->>'marker' = ${`${MARKER}-staff`}`));
    expect(staffAlerts).toHaveLength(1);
    expect(staffAlerts[0]!.organizationId).toBe(A.org.id);
    const ids = [staffAlerts[0]!.id, (await notice(`${MARKER}-ctx`))!.id, (await notice(`${MARKER}-ride-b`))!.id, (await notice(`${MARKER}-platform`))!.id];
    expect(await app.get(NotificationJobsService).sweep(new Date(), { ids })).toBe(4);
    const rows = await db(app).select({ sentAt: schema.notifications.sentAt, error: schema.notifications.error }).from(schema.notifications).where(inArray(schema.notifications.id, ids));
    expect(rows.every((r) => r.sentAt && !r.error)).toBe(true);
    // Coordonnées du personnel lues sous le contexte de A par la fonction de la plateforme : le texto est parti.
    const [phone] = await db(app).select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, staff.userId));
    expect(app.get<MockSmsProvider>(SMS_PROVIDER).sent.some((m) => m.to === phone!.phone)).toBe(true);
  });

  it('facturation : la facture d\'une course de A est émise sous son contexte, PDF sous son préfixe, avis à son nom', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await app.get(InvoiceJobsService).run({ kind: 'ride', rideId: A.rideId });
    const [invoice] = await db(app).select().from(schema.invoices).where(and(eq(schema.invoices.rideId, A.rideId), isNull(schema.invoices.creditNoteOfId)));
    expect(invoice).toBeDefined();
    expect(invoice!.pdfKey).toMatch(new RegExp(`^org/${A.org.id}/invoices/`));
    const issued = (await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'invoice.issued'), sql`${schema.notifications.data}->>'invoiceId' = ${invoice!.id}`)))[0];
    expect(issued?.organizationId).toBe(A.org.id);
    // Une course de la plateforme garde son rangement et ses avis sans organisation cliente.
    await app.get(InvoiceJobsService).run({ kind: 'ride', rideId: mixedRides[1]! });
    const [platformInvoice] = await db(app).select().from(schema.invoices).where(and(eq(schema.invoices.rideId, mixedRides[1]!), isNull(schema.invoices.creditNoteOfId)));
    expect(platformInvoice!.pdfKey).toMatch(/^invoices\//);
  });
});
