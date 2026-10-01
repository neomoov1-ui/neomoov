import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { NETWORK_SHARED_FIELDS, PERMISSION_CODES, PERMISSIONS, SYSTEM_ROLES, type TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PAYMENT_PROVIDER, SMS_PROVIDER, type MockPaymentProvider, type MockSmsProvider } from '../src/index.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import { FleetDispatchService } from '../src/modules/fleet/fleet-dispatch.service.js';
import { DispatchService } from '../src/modules/rides/dispatch.service.js';
import { OrganizationStatementsService } from '../src/modules/settlement/organization-statements.service.js';
import { StatementsService } from '../src/modules/settlement/statements.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testPhone, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Étape 23, module Flotte : parcours complet du critère (gestionnaire, chauffeur, versement) sur deux organisations sœurs
 * A et B sous la racine. Le gestionnaire de A invite un chauffeur par texto, le chauffeur accepte et est rattaché, un
 * véhicule est créé, inspecté par la plateforme et affecté ; une course reçue par A (devis et course saisis par son
 * répartiteur) est attribuée à ce chauffeur par la répartition interne, puis terminée ; le relevé hebdomadaire porte la
 * ligne de partage et le relevé de A est versé (Stripe Connect simulé). Accès croisé : B ne voit ni n'attribue rien de A.
 * Mode réseau : une course de A non pourvue repart au réseau Neomoov avec les seuls champs permis.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const TZ = 'America/Toronto';

function localToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
}

describe('module Flotte : parcours gestionnaire, chauffeur, versement (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  const orgIds: string[] = [];
  let A = { id: '', path: '' };
  let B = { id: '', path: '' };
  let ownerA: StaffSession;
  let ownerB: StaffSession;
  let dispatcherA: TokensView;
  let platformAdmin: StaffSession;
  let driverA: TestDriver;
  let driverB: TestDriver;
  let vehicleId = '';
  let rideId = '';
  let statementId = '';
  let organizationStatementId = '';

  const systemRoleId = async (code: string) => (await db(app!).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, code), isNull(schema.roles.organizationId))).limit(1))[0]!.id;
  const addMembership = async (userId: string, organizationId: string, roleCode: string) => {
    await db(app!).insert(schema.memberships).values({ userId, organizationId, roleId: await systemRoleId(roleCode) });
    app!.get(AccessService).invalidate(userId);
  };
  const createOrg = async (name: string, root: { id: string; path: string }) => {
    const id = randomUUID();
    const path = `${root.path}${id}/`;
    await db(app!).insert(schema.organizations).values({ id, code: `flotte-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `Flotte ${name}`, type: 'fleet', parentId: root.id, path });
    orgIds.push(id);
    return { id, path };
  };
  /** Catalogue du domaine (permissions et rôles système de cette étape) recopié sans rien retirer : la base est partagée. */
  const ensureCatalog = async () => {
    const database = db(app!);
    for (const code of PERMISSION_CODES) {
      const d = PERMISSIONS[code];
      await database.insert(schema.permissions).values({ code, module: d.module, description: d.description, sensitive: d.sensitive, platformOnly: d.platformOnly }).onConflictDoNothing();
    }
    for (const role of SYSTEM_ROLES) {
      const [existing] = await database.select({ id: schema.roles.id }).from(schema.roles).where(and(isNull(schema.roles.organizationId), eq(schema.roles.code, role.code))).limit(1);
      const id = existing?.id ?? (await database.insert(schema.roles).values({ code: role.code, name: role.name, level: role.level }).returning({ id: schema.roles.id }))[0]!.id;
      await database.insert(schema.rolePermissions).values(role.permissions.map((permissionCode) => ({ roleId: id, permissionCode }))).onConflictDoNothing();
    }
  };
  const post = (path: string, tokens: Pick<TokensView, 'accessToken'>, body: object = {}) => request(server()).post(path).set(bearer(tokens)).send(body);
  const get = (path: string, tokens: Pick<TokensView, 'accessToken'>) => request(server()).get(path).set(bearer(tokens));

  /** Devis et course saisis par le répartiteur de A (course reçue par l'organisation). */
  const orgRide = async (options: { guestName: string; paymentMethod: 'cash' | 'terminal'; specialRequests?: string }) => {
    const quotes = await post(`/v1/org/${A.id}/quotes`, dispatcherA, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3) });
    expect(quotes.status, JSON.stringify(quotes.body)).toBe(201);
    const quote = quotes.body.quotes[0] as { id: string };
    const ride = await post(`/v1/org/${A.id}/rides`, dispatcherA, {
      quoteId: quote.id, guest: { name: options.guestName, phone: testPhone(), language: 'fr' }, paymentMethod: options.paymentMethod, paymentChoice: 'pay_driver_after',
      ...(options.specialRequests ? { specialRequests: options.specialRequests } : {}),
    });
    expect(ride.status, JSON.stringify(ride.body)).toBe(201);
    return ride.body.id as string;
  };

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    await ensureCatalog();
    const [root] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    A = await createOrg('A', root!);
    B = await createOrg('B', root!);
    // Propriétaires connectés avec double authentification (partage des revenus et versements : permissions sensibles).
    ownerA = await createStaffAndLogin(app, ['readonly']);
    await addMembership(ownerA.userId, A.id, 'org_owner');
    ownerB = await createStaffAndLogin(app, ['readonly']);
    await addMembership(ownerB.userId, B.id, 'org_owner');
    dispatcherA = await loginByOtp(app);
    await addMembership(dispatcherA.user.id, A.id, 'dispatcher');
    platformAdmin = await createStaffAndLogin(app, ['admin']);
    // Chauffeur actif de la plateforme (documents approuvés, véhicule personnel) qui rejoindra A ; chauffeur de B.
    driverA = await createDriver(app, 'neo_premium', { firstName: 'Fleur' });
    driverB = await createDriver(app, 'neo_premium', { firstName: 'Bruno' });
    await db(app).update(schema.drivers).set({ organizationId: B.id }).where(eq(schema.drivers.id, driverB.driverId));
    await db(app).update(schema.vehicles).set({ organizationId: B.id }).where(eq(schema.vehicles.driverId, driverB.driverId));
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (orgIds.length) {
        await db(app).delete(schema.organizationStatements).where(inArray(schema.organizationStatements.organizationId, orgIds));
        await db(app).delete(schema.revenueShareRules).where(inArray(schema.revenueShareRules.organizationId, orgIds));
        await db(app).delete(schema.invitations).where(inArray(schema.invitations.organizationId, orgIds));
        await db(app).delete(schema.memberships).where(inArray(schema.memberships.organizationId, orgIds));
        await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, orgIds));
      }
    }
    await app?.close();
  });

  it('parcours complet : invitation, rattachement, véhicule, course de l\'organisation, répartition interne, relevé et versement', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);

    // 1. Le gestionnaire invite le chauffeur par texto ; le jeton n'est pas rendu à la personne qui invite.
    const invited = await post(`/v1/org/${A.id}/drivers/invitations`, ownerA.tokens, { phone: driverA.phone, firstName: 'Fleur' });
    expect(invited.status, JSON.stringify(invited.body)).toBe(201);
    expect(invited.body).toMatchObject({ phone: driverA.phone, sent: true });
    expect(JSON.stringify(invited.body)).not.toContain('drv_');
    const message = [...sms.sent].reverse().find((m) => m.to === driverA.phone && m.body.includes('rejoindre'));
    expect(message?.body).toContain('Flotte A vous invite à conduire avec Neomoov');
    const token = decodeURIComponent(/token=([^\s&]+)/.exec(message!.body)![1]!);
    // Le parcours générique des invitations refuse un jeton de chauffeur ; une autre personne ne peut pas l'accepter.
    expect((await post('/v1/invitations/accept', driverA.tokens, { token })).body.code).toBe('DRIVER_INVITATION');
    expect((await post('/v1/driver-invitations/accept', dispatcherA, { token })).status).toBe(403);

    // 2. Le chauffeur accepte : son profil existant est rattaché à A, son véhicule personnel le suit.
    const accepted = await post('/v1/driver-invitations/accept', driverA.tokens, { token });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ driverId: driverA.driverId, organizationId: A.id, created: false, previousOrganizationId: null });
    expect((await post('/v1/driver-invitations/accept', driverA.tokens, { token })).body.code).toBe('INVITATION_ALREADY_USED');
    const [attached] = await db(app).select({ organizationId: schema.drivers.organizationId }).from(schema.drivers).where(eq(schema.drivers.id, driverA.driverId));
    expect(attached!.organizationId).toBe(A.id);
    const [personal] = await db(app).select({ organizationId: schema.vehicles.organizationId, ownerUserId: schema.vehicles.ownerUserId }).from(schema.vehicles).where(eq(schema.vehicles.id, driverA.vehicleId));
    expect(personal).toEqual({ organizationId: A.id, ownerUserId: driverA.userId });
    const drivers = await get(`/v1/org/${A.id}/drivers`, ownerA.tokens).expect(200);
    expect(drivers.body.items.map((d: { id: string }) => d.id)).toEqual([driverA.driverId]);
    expect(drivers.body.items[0]).toMatchObject({ documents: { approved: 3, pending: 0 }, nextDocumentExpiryOn: '2030-01-01', currentVehicle: { id: driverA.vehicleId } });

    // 3. Véhicule de l'organisation : créé (en attente), inspecté par la plateforme, affecté au chauffeur ; entretien.
    const created = await post(`/v1/org/${A.id}/vehicles`, ownerA.tokens, { driverId: driverA.driverId, make: 'Tesla', model: 'Model Y', year: 2025, colour: 'grise', plate: `F${randomUUID().slice(0, 6).toUpperCase()}`, seats: 4, odometerKm: 12_000 });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ category: 'neo_premium', status: 'pending', current: false });
    vehicleId = created.body.id;
    await post(`/v1/admin/vehicles/${vehicleId}/review`, platformAdmin.tokens, { status: 'active', nextInspectionDueOn: '2027-01-15' }).expect(200);
    const assigned = await post(`/v1/org/${A.id}/vehicles/${vehicleId}/assign`, ownerA.tokens, { driverId: driverA.driverId });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    expect(assigned.body).toMatchObject({ driverId: driverA.driverId, status: 'active', current: true });
    const maintenance = await post(`/v1/org/${A.id}/vehicles/${vehicleId}/maintenance`, ownerA.tokens, { kind: 'tires', performedOn: localToday(), odometerKm: 12_500, costCents: 64_000, nextDueOn: '2027-04-01' });
    expect(maintenance.status, JSON.stringify(maintenance.body)).toBe(201);
    expect(maintenance.body.due).toEqual([{ kind: 'tires', dueOn: '2027-04-01', dueKm: null, status: 'ok' }]);
    expect(maintenance.body.aiSuggestion).toBeNull();

    // 4. Règle de partage de A : 20 % du tarif chauffeur.
    const rule = await post(`/v1/org/${A.id}/revenue-share-rules`, ownerA.tokens, { mode: 'percentage', percentagePpm: 200_000, effectiveFrom: '2026-01-01' });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);

    // 5. Course reçue par A, saisie par son répartiteur ; répartition interne vers son chauffeur.
    rideId = await orgRide({ guestName: 'Marie Tremblay', paymentMethod: 'cash' });
    const [rideRow] = await db(app).select({ organizationId: schema.rides.organizationId }).from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(rideRow!.organizationId).toBe(A.id);
    // Un chauffeur d'une autre organisation n'est jamais attribuable (introuvable sous le contexte de A).
    const foreign = await post(`/v1/org/${A.id}/rides/${rideId}/assign`, dispatcherA, { driverId: driverB.driverId });
    expect([foreign.status, foreign.body.code]).toEqual([404, 'DRIVER_NOT_FOUND']);
    const internal = await post(`/v1/org/${A.id}/rides/${rideId}/assign`, dispatcherA, { driverId: driverA.driverId, vehicleId });
    expect(internal.status, JSON.stringify(internal.body)).toBe(200);
    expect(internal.body.state).toBe('assigned');
    // Réattribution interne : nouvelle recherche, offres aux seuls chauffeurs de A ; puis attribution de nouveau.
    const reassigned = await post(`/v1/org/${A.id}/rides/${rideId}/reassign`, dispatcherA, { reason: 'Changement de chauffeur demandé', excludeDriver: false });
    expect(reassigned.status, JSON.stringify(reassigned.body)).toBe(200);
    const offered = await db(app).select({ driverId: schema.rideOffers.driverId }).from(schema.rideOffers).where(eq(schema.rideOffers.rideId, rideId));
    expect(offered.map((o) => o.driverId).every((id) => id === driverA.driverId)).toBe(true);
    await post(`/v1/org/${A.id}/rides/${rideId}/assign`, dispatcherA, { driverId: driverA.driverId, vehicleId }).expect(200);
    const live = await get(`/v1/org/${A.id}/live`, dispatcherA).expect(200);
    expect(live.body.rides.map((r: { id: string }) => r.id)).toContain(rideId);

    // 6. Le chauffeur fait la course jusqu'au bout.
    for (const step of ['depart', 'arrive', 'start'] as const) await post(`/v1/driver/rides/${rideId}/${step}`, driverA.tokens).expect(200);
    const completed = await post(`/v1/driver/rides/${rideId}/complete`, driverA.tokens, { measuredDistanceMeters: 4200, measuredDurationSeconds: 900 });
    expect(completed.status, JSON.stringify(completed.body)).toBe(200);
    const [done] = await db(app).select({ fareCents: schema.rides.fareCents }).from(schema.rides).where(eq(schema.rides.id, rideId));
    const fareCents = done!.fareCents!;
    expect(fareCents).toBeGreaterThan(0);

    // 7. Relevé hebdomadaire du chauffeur : ligne de partage de 20 % du tarif, relevé à A ; visible par A, pas par B.
    const periodStart = mondayOf(localToday());
    const statements = app.get(StatementsService);
    const generation = await statements.generate({ periodStart, driverId: driverA.driverId });
    expect(generation.generated).toBe(1);
    statementId = generation.statements[0]!.id!;
    await statements.issue(statementId);
    const lines = await db(app).select().from(schema.statementLines).where(and(eq(schema.statementLines.statementId, statementId), eq(schema.statementLines.kind, 'fleet_share')));
    expect(lines.map((l) => [l.amountCents, l.label])).toEqual([[Math.floor((fareCents * 200_000 + 500_000) / 1_000_000), 'Part de l\'organisation : 20 % du tarif']]);
    const shareCents = lines[0]!.amountCents;
    const seen = await get(`/v1/org/${A.id}/statements/${statementId}`, ownerA.tokens).expect(200);
    expect(seen.body).toMatchObject({ driverId: driverA.driverId, shareCents, status: 'issued' });
    expect((await get(`/v1/org/${B.id}/statements/${statementId}`, ownerB.tokens)).status).toBe(404);

    // 8. Versement à l'organisation : compte Connect ouvert (simulé), relevé de A versé par transfert.
    expect((await get(`/v1/org/${A.id}/payout-account`, ownerA.tokens).expect(200)).body).toMatchObject({ mode: 'offline', linked: false });
    const onboarding = await post(`/v1/org/${A.id}/payout-account/onboarding`, ownerA.tokens).expect(200);
    expect(onboarding.body.simulated).toBe(true);
    expect((await get(`/v1/org/${A.id}/payout-account`, ownerA.tokens).expect(200)).body).toMatchObject({ mode: 'connect', linked: true, onboarded: true });
    const periodEnd = new Date(Date.parse(`${periodStart}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
    const report = await app.get(OrganizationStatementsService).issueAndPay({ startDate: periodStart, endDate: periodEnd });
    expect(report.paid).toBeGreaterThanOrEqual(1);
    const orgStatements = await get(`/v1/org/${A.id}/organization-statements`, ownerA.tokens).expect(200);
    expect(orgStatements.body).toHaveLength(1);
    expect(orgStatements.body[0]).toMatchObject({ organizationId: A.id, periodStart, status: 'paid', shareCents, driverCount: 1, lines: [{ driverId: driverA.driverId, statementId, shareCents }] });
    organizationStatementId = orgStatements.body[0].id;
    const transfer = app.get<MockPaymentProvider>(PAYMENT_PROVIDER).transfers.get(orgStatements.body[0].transferRef);
    expect(transfer?.amountCents).toBe(shareCents);
    // Rejouée, la passe ne verse rien de plus ; l'export des virements porte le relevé.
    await app.get(OrganizationStatementsService).issueAndPay({ startDate: periodStart, endDate: periodEnd });
    expect((await get(`/v1/org/${A.id}/organization-statements/${organizationStatementId}`, ownerA.tokens).expect(200)).body.transferRef).toBe(orgStatements.body[0].transferRef);
    const csv = await get(`/v1/org/${A.id}/payouts/export.csv`, ownerA.tokens).expect(200);
    expect(csv.text).toContain(`${periodStart};${periodEnd};paid;${shareCents};1;`);

    // 9. Rapport de la semaine : la course, son tarif et la part de A, par chauffeur et par véhicule.
    const weekly = await get(`/v1/org/${A.id}/reports/weekly?periodStart=${periodStart}`, ownerA.tokens).expect(200);
    expect(weekly.body.totals).toEqual({ rides: 1, fareCents, shareCents });
    expect(weekly.body.byVehicle).toEqual([expect.objectContaining({ vehicleId, rides: 1, fareCents })]);

    // 10. Propriétaire de véhicule (rôle système N3) : ses véhicules, leurs courses et revenus, leurs échéances ; rien d'autre.
    const vehicleOwner = await loginByOtp(app);
    await addMembership(vehicleOwner.user.id, A.id, 'vehicle_owner');
    const patched = await request(server()).patch(`/v1/org/${A.id}/vehicles/${vehicleId}`).set(bearer(ownerA.tokens)).send({ ownerUserId: vehicleOwner.user.id, odometerKm: 13_000 });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body).toMatchObject({ ownerUserId: vehicleOwner.user.id, odometerKm: 13_000 });
    const dashboard = await get(`/v1/org/${A.id}/owner/vehicles?periodStart=${periodStart}`, vehicleOwner).expect(200);
    expect(dashboard.body.vehicles).toEqual([expect.objectContaining({ vehicleId, rides: 1, fareCents, maintenanceDue: [expect.objectContaining({ kind: 'tires', status: 'ok' })] })]);
    expect((await get(`/v1/org/${A.id}/drivers`, vehicleOwner)).body.code).toBe('FORBIDDEN_ROLE');
    expect((await get(`/v1/org/${A.id}/owner/vehicles`, dispatcherA)).body.code).toBe('FORBIDDEN_ROLE');
  });

  it('accès croisé : B ne voit ni n\'attribue rien de A', { timeout: 60_000 }, async ({ skip }) => {
    if (!app || !rideId) return skip('parcours précédent absent');
    // B ne voit que son chauffeur ; rien de A (404 sur chaque ligne de A, jamais 403).
    const driversB = await get(`/v1/org/${B.id}/drivers`, ownerB.tokens).expect(200);
    expect(driversB.body.items.map((d: { id: string }) => d.id)).toEqual([driverB.driverId]);
    expect((await post(`/v1/org/${B.id}/rides/${rideId}/assign`, ownerB.tokens, { driverId: driverB.driverId })).status).toBe(404);
    expect((await post(`/v1/org/${B.id}/vehicles/${vehicleId}/assign`, ownerB.tokens, { driverId: driverB.driverId })).status).toBe(404);
    expect((await get(`/v1/org/${B.id}/vehicles/${vehicleId}/maintenance`, ownerB.tokens)).status).toBe(404);
    expect((await get(`/v1/org/${B.id}/organization-statements/${organizationStatementId}`, ownerB.tokens)).status).toBe(404);
    expect((await get(`/v1/org/${B.id}/organization-statements`, ownerB.tokens).expect(200)).body).toEqual([]);
    expect((await get(`/v1/org/${B.id}/revenue-share-rules`, ownerB.tokens).expect(200)).body).toEqual([]);
    expect((await get(`/v1/org/${B.id}/live`, ownerB.tokens).expect(200)).body.rides).toEqual([]);
    expect((await get(`/v1/org/${B.id}/reports/weekly`, ownerB.tokens).expect(200)).body.totals.rides).toBe(0);
    expect((await post(`/v1/org/${B.id}/organization-statements/${organizationStatementId}/settle-offline`, ownerB.tokens, { method: 'interac', reference: 'X-1' })).status).toBe(404);
    // B ne peut pas viser A, ni inviter un chauffeur chez A ; le répartiteur de A n'a pas les permissions du gestionnaire.
    expect((await get(`/v1/org/${A.id}/drivers`, ownerB.tokens)).body.code).toBe('NOT_A_MEMBER');
    expect((await post(`/v1/org/${A.id}/drivers/invitations`, ownerB.tokens, { phone: testPhone() })).status).toBe(403);
    expect((await post(`/v1/org/${A.id}/revenue-share-rules`, dispatcherA, { mode: 'rent', weeklyRentCents: 1000, effectiveFrom: '2026-01-01' })).body.code).toBe('FORBIDDEN_ROLE');
  });

  it('mode réseau : une course de A non pourvue repart au réseau Neomoov avec les seuls champs permis', { timeout: 90_000 }, async ({ skip }) => {
    if (!app || !A.id) return skip('organisations absentes');
    // Chauffeur de la plateforme qui accepte le paiement par terminal (les tests de la répartition s'isolent par ce mode).
    const networkDriver = await createDriver(app, 'neo_premium', { acceptsTerminal: true, firstName: 'Réseau' });
    const settings = await request(server()).patch(`/v1/org/${A.id}/fleet/settings`).set(bearer(ownerA.tokens)).send({ networkMode: 'neomoov_network', networkAfterMinutes: 5 });
    expect(settings.status, JSON.stringify(settings.body)).toBe(200);
    expect(settings.body).toEqual({ networkMode: 'neomoov_network', networkAfterMinutes: 5 });
    const shared = await orgRide({ guestName: 'Jean-Philippe Gagnon', paymentMethod: 'terminal', specialRequests: 'Appeler Mme Gagnon au 514 555 0199' });
    // Avant le délai : la répartition de A ne propose jamais la course à un chauffeur hors de A.
    await app.get(DispatchService).start(shared, { reason: 'operator' });
    const before = await db(app).select({ driverId: schema.rideOffers.driverId }).from(schema.rideOffers).where(eq(schema.rideOffers.rideId, shared));
    expect(before.map((o) => o.driverId)).not.toContain(networkDriver.driverId);
    const early = await app.get(FleetDispatchService).networkPass(new Date(Date.now() + 60_000));
    expect(early.shared).not.toContain(shared);
    // Après le délai : partagée une seule fois, journal limité aux champs permis, offre au chauffeur du réseau.
    const pass = await app.get(FleetDispatchService).networkPass(new Date(Date.now() + 10 * 60_000));
    expect(pass.shared).toContain(shared);
    expect((await app.get(FleetDispatchService).networkPass(new Date(Date.now() + 20 * 60_000))).shared).not.toContain(shared);
    const [event] = await db(app).select({ data: schema.rideEvents.data }).from(schema.rideEvents).where(and(eq(schema.rideEvents.rideId, shared), eq(schema.rideEvents.type, 'network_shared')));
    const transmitted = (event!.data as { transmitted: Record<string, unknown> }).transmitted;
    expect(Object.keys(transmitted).sort()).toEqual([...NETWORK_SHARED_FIELDS].sort());
    expect(transmitted['passengerFirstName']).toBe('Jean-Philippe');
    expect(JSON.stringify(transmitted)).not.toMatch(/Gagnon|514 555|\+1999/);
    const offers = await get('/v1/driver/offers', networkDriver.tokens).expect(200);
    const offer = (offers.body as Array<{ rideId: string; ride: Record<string, unknown> }>).find((o) => o.rideId === shared);
    expect(offer, JSON.stringify(offers.body)).toBeDefined();
    expect(offer!.ride['specialRequests']).toBeNull();
    expect(JSON.stringify(offer)).not.toMatch(/Gagnon|514 555/);
    const [row] = await db(app).select({ sharedAt: schema.rides.networkSharedAt }).from(schema.rides).where(eq(schema.rides.id, shared));
    expect(row!.sharedAt).not.toBeNull();
    // Retour au mode isolé pour la suite.
    await request(server()).patch(`/v1/org/${A.id}/fleet/settings`).set(bearer(ownerA.tokens)).send({ networkMode: 'isolated' }).expect(200);
    await db(app).execute(sql`DELETE FROM ride_offers WHERE ride_id = ${shared}::uuid`);
  });
});
