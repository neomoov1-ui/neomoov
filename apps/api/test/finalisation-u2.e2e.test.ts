import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpCode } from '../src/common/crypto.js';
import { SettingsService } from '../src/common/settings.service.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import { ComplianceService } from '../src/modules/compliance/compliance.service.js';
import { FleetNoticesService } from '../src/modules/fleet/fleet-notices.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testEmail, testPhone, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Finalisation du 3 octobre 2026 (agent U2) : conditions des rôles appliquées par la garde des organisations (montant
 * maximal, zones, lecture seule) sans escalade ; alerte au propriétaire quand une permission sensible est utilisée ;
 * écritures métier de l'organisation (annulation d'une course, suspension et réactivation d'un chauffeur) ; statut de
 * facturation (lecture seule : écritures refusées, sauf course en cours et régularisation ; héritée des sous-organisations) ;
 * facturation de l'organisation et portail client simulé ; critères Pilote de la flotte ; suggestion d'entretien ; relevé
 * des échéances au gestionnaire ; question « ask » de Caddy ; règle des 60 000 km et antécédents judiciaires.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const tag = () => Math.random().toString(36).slice(2, 10);
type Tokens = Pick<TokensView, 'accessToken'>;
type Org = { id: string; path: string };

describe('finalisation U2 : organisations, flotte et facturation (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  let root: Org;
  let A: Org;
  let A1: Org;
  let B: Org;
  let C: Org;
  let owner: TokensView;
  let owner2: TokensView;
  let agent: TokensView;
  let client: TokensView;
  let driverA: TestDriver;
  let driverB: TestDriver;
  let admin: StaffSession;
  let agentRoleId = '';
  let plateauZones: string[] = [];
  const orgIds: string[] = [];
  const createdRoles: string[] = [];
  const domains: string[] = [];
  const planCode = `e2e-u2-${tag()}`;

  const get = (path: string, tokens: Tokens) => request(server()).get(path).set(bearer(tokens));
  const post = (path: string, tokens: Tokens, body: object = {}) => request(server()).post(path).set(bearer(tokens)).send(body);
  const put = (path: string, tokens: Tokens, body: object = {}) => request(server()).put(path).set(bearer(tokens)).send(body);
  const patch = (path: string, tokens: Tokens, body: object = {}) => request(server()).patch(path).set(bearer(tokens)).send(body);
  const systemRoleId = async (code: string) => (await db(app!).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, code), isNull(schema.roles.organizationId))).limit(1))[0]!.id;
  const addMembership = async (userId: string, organizationId: string, roleId: string, scope: 'organization' | 'subtree' = 'organization') => {
    const [row] = await db(app!).insert(schema.memberships).values({ userId, organizationId, roleId, scope }).returning({ id: schema.memberships.id });
    app!.get(AccessService).invalidate(userId);
    return row!.id;
  };
  async function createOrg(name: string, parent: Org): Promise<Org> {
    const id = randomUUID();
    const path = `${parent.path}${id}/`;
    await db(app!).insert(schema.organizations).values({ id, code: `u2-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `Finalisation ${name}`, type: 'fleet', parentId: parent.id, path });
    orgIds.push(id);
    return { id, path };
  }
  async function enrollMemberMfa(tokens: TokensView): Promise<TokensView> {
    const start = await post('/v1/auth/mfa/start', tokens).expect(200);
    const enroll = await request(server()).post('/v1/auth/mfa/enroll').send({ mfaToken: start.body.mfaToken }).expect(200);
    const confirm = await request(server()).post('/v1/auth/mfa/confirm').send({ mfaToken: start.body.mfaToken, code: totpCode(enroll.body.secret as string) });
    if (confirm.status !== 200) throw new Error(`Second facteur refusé : ${confirm.status} ${JSON.stringify(confirm.body)}`);
    const { backupCodes: _codes, ...session } = confirm.body as TokensView & { backupCodes: string[] };
    return session;
  }
  /** Devis puis course de l'organisation A, saisis par `tokens`, pour le client de test (rattaché à A). */
  async function orgQuote(tokens: Tokens): Promise<{ id: string; maxConsentedCents: number }> {
    const quotes = await post(`/v1/org/${A.id}/quotes`, tokens, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3) });
    expect(quotes.status, JSON.stringify(quotes.body)).toBe(201);
    return quotes.body.quotes[0] as { id: string; maxConsentedCents: number };
  }
  const orgRide = (tokens: Tokens, quoteId: string) => post(`/v1/org/${A.id}/rides`, tokens, { quoteId, clientUserId: client.user.id, paymentMethod: 'cash', paymentChoice: 'pay_driver_after' });
  const notificationsOf = (template: string, userId: string) =>
    db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.template, template), eq(schema.notifications.recipientUserId, userId))).orderBy(desc(schema.notifications.createdAt));
  async function setSetting(key: string, value: unknown) {
    await db(app!).insert(schema.settings).values({ scope: 'global', key, value, description: 'essai' }).onConflictDoUpdate({ target: [schema.settings.scope, schema.settings.key], set: { value } });
    app!.get(SettingsService).invalidate();
  }

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    [root] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1) as [Org];
    A = await createOrg('A', root);
    A1 = await createOrg('A1', A);
    B = await createOrg('B', root);
    C = await createOrg('C', root);
    const ownerRoleId = await systemRoleId('org_owner');
    const first = await loginByOtp(app, testPhone(), {}, { card: false });
    await addMembership(first.user.id, A.id, ownerRoleId, 'subtree');
    await addMembership(first.user.id, C.id, ownerRoleId);
    owner = await enrollMemberMfa(first);
    owner2 = await loginByOtp(app, testPhone(), {}, { card: false });
    // Propriétaires joignables par courriel (l'alerte part par courriel, sinon par texto).
    for (const id of [first.user.id, owner2.user.id]) await db(app).update(schema.users).set({ email: testEmail('u2-proprio') }).where(eq(schema.users.id, id));
    await addMembership(owner2.user.id, A.id, ownerRoleId);
    agent = await loginByOtp(app, testPhone(), {}, { card: false });
    client = await loginByOtp(app, testPhone(), {}, { card: false });
    await db(app).update(schema.clients).set({ organizationId: A.id }).where(eq(schema.clients.userId, client.user.id));
    driverA = await createDriver(app, 'neo_premium', { firstName: 'Ada' });
    driverB = await createDriver(app, 'neo_premium', { firstName: 'Basile' });
    await db(app).update(schema.drivers).set({ organizationId: A.id }).where(eq(schema.drivers.id, driverA.driverId));
    await db(app).update(schema.vehicles).set({ organizationId: A.id }).where(eq(schema.vehicles.driverId, driverA.driverId));
    await db(app).update(schema.drivers).set({ organizationId: B.id }).where(eq(schema.drivers.id, driverB.driverId));
    admin = await createStaffAndLogin(app, ['admin']);
    plateauZones = [...(await db(app).execute<{ code: string }>(sql`SELECT code FROM zones WHERE active AND ST_Covers(geometry, ST_SetSRID(ST_MakePoint(${PLATEAU.coordinates.lng}, ${PLATEAU.coordinates.lat}), 4326)::geography) ORDER BY code`))].map((z) => z.code);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      if (domains.length) await db(app).delete(schema.organizationDomains).where(inArray(schema.organizationDomains.domain, domains));
      await db(app).delete(schema.platformInvoices).where(inArray(schema.platformInvoices.organizationId, orgIds.length ? orgIds : [randomUUID()]));
      await db(app).delete(schema.subscriptions).where(inArray(schema.subscriptions.organizationId, orgIds.length ? orgIds : [randomUUID()]));
      await db(app).delete(schema.organizationFeatures).where(inArray(schema.organizationFeatures.organizationId, orgIds.length ? orgIds : [randomUUID()]));
      await cleanupTestData(app);
      if (createdRoles.length) {
        await db(app).delete(schema.memberships).where(inArray(schema.memberships.roleId, createdRoles));
        await db(app).delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, createdRoles));
        await db(app).delete(schema.roles).where(inArray(schema.roles.id, createdRoles));
      }
      for (const id of [...orgIds].reverse()) {
        await db(app).delete(schema.memberships).where(eq(schema.memberships.organizationId, id));
        await db(app).delete(schema.organizations).where(eq(schema.organizations.id, id)).catch(() => undefined);
      }
      await db(app).delete(schema.plans).where(eq(schema.plans.code, planCode));
      await setSetting('compliance.background_check_tracked', false);
    }
    await app?.close();
  });

  it('conditions des rôles : montant maximal, zones et lecture seule appliqués par la garde, sans escalade', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    expect(plateauZones.length).toBeGreaterThan(0);
    // Rôle personnalisé de l'agent : créer des courses jusqu'à 1 $, annuler en lecture seule (aucune annulation).
    const role = await post(`/v1/org/${A.id}/roles`, owner, {
      code: `agent_${tag()}`, name: 'Agent limité', level: 2, permissions: ['rides.read', 'rides.create', 'rides.cancel'],
      conditions: { 'rides.create': { maxAmountCents: 100 }, 'rides.cancel': { readOnly: true } },
    });
    expect(role.status, JSON.stringify(role.body)).toBe(201);
    agentRoleId = role.body.id as string;
    createdRoles.push(agentRoleId);
    expect(role.body.conditions).toEqual({ 'rides.create': { maxAmountCents: 100 }, 'rides.cancel': { readOnly: true } });
    // Conditions sur une permission non accordée : refusées.
    const stray = await post(`/v1/org/${A.id}/roles`, owner, { code: `r_${tag()}`, name: 'Rôle', level: 2, permissions: ['rides.read'], conditions: { 'rides.cancel': { readOnly: true } } });
    expect(stray.status).toBe(400);
    expect(stray.body.code).toBe('CONDITIONS_ON_UNGRANTED_PERMISSION');
    await addMembership(agent.user.id, A.id, agentRoleId);

    // Un devis n'engage aucun montant ; la course, si (prix maximal consenti au-delà du plafond).
    const quote = await orgQuote(agent);
    expect(quote.maxConsentedCents).toBeGreaterThan(100);
    const refused = await orgRide(agent, quote.id);
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'PERMISSION_CONDITION_UNMET', details: { refusals: { 'rides.create': 'amount' } } });

    // Le propriétaire remplace le plafond par la zone du départ : la course passe.
    const updated = await put(`/v1/org/${A.id}/roles/${agentRoleId}/permissions`, owner, {
      permissions: ['rides.read', 'rides.create', 'rides.cancel'], conditions: { 'rides.create': { zones: [plateauZones[0]!] }, 'rides.cancel': { readOnly: true } },
    }).expect(200);
    expect(updated.body.conditions['rides.create']).toEqual({ zones: [plateauZones[0]] });
    app.get(AccessService).invalidate(agent.user.id);
    const created = await orgRide(agent, quote.id);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const rideId = created.body.id as string;
    // Lecture seule sur l'annulation : refusée en écriture ; la lecture des courses reste permise.
    const cancel = await post(`/v1/org/${A.id}/rides/${rideId}/cancel`, agent, { reason: 'Essai', chargeFee: false });
    expect(cancel.status).toBe(403);
    expect(cancel.body).toMatchObject({ code: 'PERMISSION_CONDITION_UNMET', details: { refusals: { 'rides.cancel': 'read_only' } } });
    await get(`/v1/org/${A.id}/rides/${rideId}`, agent).expect(200);
    // Une zone qui ne contient pas le départ : refus par zone.
    await put(`/v1/org/${A.id}/roles/${agentRoleId}/permissions`, owner, { permissions: ['rides.read', 'rides.create'], conditions: { 'rides.create': { zones: ['zone-inexistante-u2'] } } }).expect(200);
    app.get(AccessService).invalidate(agent.user.id);
    const second = await orgQuote(owner);
    const outside = await orgRide(agent, second.id);
    expect(outside.status).toBe(403);
    expect(outside.body.details.refusals).toEqual({ 'rides.create': 'zone' });
    // Vue des rôles : les conditions sont rendues.
    const roles = await get(`/v1/org/${A.id}/roles`, owner).expect(200);
    expect((roles.body as Array<{ id: string; conditions: object }>).find((r) => r.id === agentRoleId)!.conditions).toEqual({ 'rides.create': { zones: ['zone-inexistante-u2'] } });
    // Sans conditions dans le corps (écran qui ne les gère pas) : celles des permissions gardées restent ; un objet vide les efface.
    const kept = await put(`/v1/org/${A.id}/roles/${agentRoleId}/permissions`, owner, { permissions: ['rides.read', 'rides.create'] }).expect(200);
    expect(kept.body.conditions).toEqual({ 'rides.create': { zones: ['zone-inexistante-u2'] } });
    const cleared = await put(`/v1/org/${A.id}/roles/${agentRoleId}/permissions`, owner, { permissions: ['rides.read', 'rides.create'], conditions: {} }).expect(200);
    expect(cleared.body.conditions).toEqual({});

    // Le propriétaire annule la course (route d'organisation) ; une course d'une autre organisation est introuvable.
    const cancelled = await post(`/v1/org/${A.id}/rides/${rideId}/cancel`, owner, { reason: 'Client joint par téléphone', chargeFee: false });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(cancelled.body.feeCents).toBe(0);
    expect((await post(`/v1/org/${B.id}/rides/${rideId}/cancel`, owner, { reason: 'Autre', chargeFee: false })).status).toBe(403);
  });

  it('alerte au propriétaire : permission sensible utilisée par un autre membre, une fois par délai', { timeout: 60_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [membership] = await db(app).select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.userId, agent.user.id), eq(schema.memberships.organizationId, A.id))).limit(1);
    expect(membership).toBeDefined();
    const before = (await notificationsOf('organization.sensitive_permission_used', owner2.user.id)).length;
    await patch(`/v1/org/${A.id}/memberships/${membership!.id}`, owner, { status: 'suspended' }).expect(200);
    await patch(`/v1/org/${A.id}/memberships/${membership!.id}`, owner, { status: 'active' }).expect(200);
    const alerts = await notificationsOf('organization.sensitive_permission_used', owner2.user.id);
    expect(alerts.length - before).toBe(1);
    expect(alerts[0]!).toMatchObject({ channel: 'email', organizationId: A.id });
    expect(alerts[0]!.data).toMatchObject({ permissions: ['members.manage'] });
    // L'auteur n'est jamais avisé de ses propres actions.
    expect(await notificationsOf('organization.sensitive_permission_used', owner.user.id)).toHaveLength(0);
    // Chaque usage est journalisé dans l'organisation ; l'alerte, une seule fois.
    const used = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'organization.sensitive_permission_used'), eq(schema.auditLog.organizationId, A.id)));
    expect(used.length).toBeGreaterThanOrEqual(2);
    const alerted = await db(app).select().from(schema.auditLog).where(and(
      eq(schema.auditLog.action, 'organization.sensitive_permission_alerted'), eq(schema.auditLog.organizationId, A.id), sql`${schema.auditLog.after} -> 'permissions' @> '["members.manage"]'::jsonb`,
    ));
    expect(alerted).toHaveLength(1);
    // Une permission non sensible n'alerte personne.
    await get(`/v1/org/${A.id}/rides`, owner).expect(200);
    expect((await notificationsOf('organization.sensitive_permission_used', owner2.user.id)).length - before).toBe(1);
  });

  it('chauffeurs : suspension et réactivation par l\'organisation ; une suspension de la plateforme lui reste', { timeout: 60_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    expect((await post(`/v1/org/${A.id}/drivers/${driverB.driverId}/suspend`, owner, { reason: 'Hors organisation' })).status).toBe(404);
    const suspended = await post(`/v1/org/${A.id}/drivers/${driverA.driverId}/suspend`, owner, { reason: 'Documents à revoir avec la flotte' });
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(200);
    expect(suspended.body.driver.status).toBe('suspended');
    const reactivated = await post(`/v1/org/${A.id}/drivers/${driverA.driverId}/reactivate`, owner);
    expect(reactivated.status, JSON.stringify(reactivated.body)).toBe(200);
    expect(reactivated.body.driver.status).toBe('active');
    expect((await post(`/v1/org/${A.id}/drivers/${driverA.driverId}/reactivate`, owner)).body.code).toBe('DRIVER_NOT_SUSPENDED');
    // Suspension décidée par le personnel de la plateforme : l'organisation ne la lève pas.
    await post(`/v1/admin/drivers/${driverA.driverId}/suspend`, admin.tokens, { reason: 'Sécurité : enquête de la plateforme' }).expect(200);
    const blocked = await post(`/v1/org/${A.id}/drivers/${driverA.driverId}/reactivate`, owner);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('SUSPENDED_BY_PLATFORM');
    await post(`/v1/admin/drivers/${driverA.driverId}/reactivate`, admin.tokens).expect(200);
  });

  it('statut de facturation : lecture seule héritée, écritures refusées sauf course en cours et régularisation', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const quote = await orgQuote(owner);
    const created = await orgRide(owner, quote.id);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const rideId = created.body.id as string;
    await db(app).update(schema.rides).set({ state: 'in_progress' }).where(eq(schema.rides.id, rideId));
    await db(app).update(schema.organizations).set({ status: 'read_only' }).where(eq(schema.organizations.id, A.id));
    try {
      const write = await post(`/v1/org/${A.id}/quotes`, owner, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3) });
      expect(write.status).toBe(403);
      expect(write.body).toMatchObject({ code: 'ORGANIZATION_READ_ONLY', details: { status: 'read_only' } });
      // Sous-organisation : le statut de l'organisation cliente s'applique.
      const sub = await post(`/v1/org/${A1.id}/quotes`, owner, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3) });
      expect(sub.body.code).toBe('ORGANIZATION_READ_ONLY');
      // Lectures permises.
      await get(`/v1/org/${A.id}/rides`, owner).expect(200);
      // Course en cours : jamais bloquée par la facturation (la transition est jugée par le gestionnaire, pas par le statut).
      const onRide = await post(`/v1/org/${A.id}/rides/${rideId}/cancel`, owner, { reason: 'Essai', chargeFee: false });
      expect(onRide.body.code).not.toBe('ORGANIZATION_READ_ONLY');
      // Se protéger : retirer un membre reste possible.
      const [membership] = await db(app).select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.userId, agent.user.id), eq(schema.memberships.organizationId, A.id))).limit(1);
      await patch(`/v1/org/${A.id}/memberships/${membership!.id}`, owner, { status: 'suspended' }).expect(200);
      await db(app).update(schema.organizations).set({ status: 'suspended' }).where(eq(schema.organizations.id, A.id));
      expect((await post(`/v1/org/${A.id}/quotes`, owner, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3) })).body.code).toBe('ORGANIZATION_SUSPENDED');
    } finally {
      await db(app).update(schema.organizations).set({ status: 'active' }).where(eq(schema.organizations.id, A.id));
      await db(app).update(schema.rides).set({ state: 'cancelled_by_client' }).where(eq(schema.rides.id, rideId));
    }
    await post(`/v1/org/${A.id}/quotes`, owner, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3) }).expect(201);
  });

  it('facturation de l\'organisation : vue sans identifiant du fournisseur, portail client simulé, permis en lecture seule', { timeout: 60_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const empty = await get(`/v1/org/${C.id}/billing`, owner).expect(200);
    expect(empty.body).toEqual({ subscription: null, invoices: [] });
    expect((await post(`/v1/org/${C.id}/billing/portal`, owner, {})).body.code).toBe('BILLING_CUSTOMER_MISSING');
    expect((await post(`/v1/org/${C.id}/billing/portal`, owner, { returnPath: 'https://exemple.test/' })).status).toBe(400);
    await db(app).insert(schema.plans).values({
      code: planCode, name: 'Essai U2', modules: ['organization', 'rides', 'clients', 'payments', 'finance', 'reports', 'vehicles', 'drivers', 'dispatch'],
      setupFeeCents: 0, monthlyPriceCents: 1_000, annualPriceCents: 10_000, perActiveVehicleCents: 0, includedVehicles: 5,
    });
    await post(`/v1/admin/organizations/${C.id}/subscription`, admin.tokens, { planCode, billingPeriod: 'monthly' }).expect(200);
    app.get(AccessService).invalidate(owner.user.id);
    const view = await get(`/v1/org/${C.id}/billing`, owner).expect(200);
    expect(view.body.subscription).toMatchObject({ planCode, status: 'active' });
    expect(view.body.subscription).not.toHaveProperty('stripeCustomerId');
    expect(view.body.invoices.length).toBeGreaterThan(0);
    expect(view.body.invoices[0]).not.toHaveProperty('stripeInvoiceId');
    await db(app).update(schema.organizations).set({ status: 'read_only' }).where(eq(schema.organizations.id, C.id));
    const portal = await post(`/v1/org/${C.id}/billing/portal`, owner, { returnPath: '/hub/organisation' });
    expect(portal.status, JSON.stringify(portal.body)).toBe(200);
    expect(portal.body).toMatchObject({ simulated: true });
    expect(portal.body.url).toContain(encodeURIComponent('/hub/organisation'));
    // Un membre sans `billing.manage` ne l'ouvre pas.
    expect((await post(`/v1/org/${C.id}/billing/portal`, owner2, {})).status).toBe(403);
  });

  it('flotte : critères Pilote de l\'organisation, suggestion d\'entretien, relevé des échéances au gestionnaire', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    expect((await get(`/v1/org/${A.id}/fleet/pilot`, owner).expect(200)).body.mode).toBe('off');
    expect((await put(`/v1/org/${A.id}/fleet/pilot`, owner, { mode: 'minimum', criteria: { originZones: ['zone-inexistante-u2'] } })).body.code).toBe('PILOT_UNKNOWN_ZONE');
    const saved = await put(`/v1/org/${A.id}/fleet/pilot`, owner, { mode: 'minimum', criteria: { minFareCents: 2_500, categories: ['neo_premium'] } }).expect(200);
    expect(saved.body).toMatchObject({ mode: 'minimum', criteria: { minFareCents: 2_500, categories: ['neo_premium'] } });
    expect((await get(`/v1/org/${A.id}/fleet/pilot`, owner).expect(200)).body.criteria.minFareCents).toBe(2_500);

    // Suggestion d'entretien : règles déterministes, sans appel au modèle.
    await db(app).update(schema.vehicles).set({ odometerKm: 52_000 }).where(eq(schema.vehicles.id, driverA.vehicleId));
    const maintenance = await get(`/v1/org/${A.id}/vehicles/${driverA.vehicleId}/maintenance`, owner).expect(200);
    expect(maintenance.body.aiSuggestion).toContain('Aucune inspection enregistrée');
    expect(maintenance.body.aiSuggestion).toContain('Pneus');

    // Relevé des échéances : un document qui expire dans 5 jours ; un seul relevé par jour.
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await db(app).update(schema.driverDocuments).set({ expiresOn: soon }).where(and(eq(schema.driverDocuments.driverId, driverA.driverId), eq(schema.driverDocuments.type, 'insurance')));
    await app.get(ComplianceService).refreshDriver(driverA.driverId);
    const notices = app.get(FleetNoticesService);
    await notices.run(new Date());
    const digests = await notificationsOf('fleet.compliance_digest', owner2.user.id);
    expect(digests.length).toBeGreaterThanOrEqual(1);
    expect(digests[0]!.data).toMatchObject({ days: 14 });
    expect(Number((digests[0]!.data as { documents: number }).documents)).toBeGreaterThanOrEqual(1);
    await notices.run(new Date());
    expect(await notificationsOf('fleet.compliance_digest', owner2.user.id)).toHaveLength(digests.length);
    const [marker] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'fleet.manager_notice_sent'), eq(schema.auditLog.organizationId, A.id), sql`${schema.auditLog.after} ->> 'day' IS NOT NULL`)).orderBy(desc(schema.auditLog.occurredAt)).limit(1);
    expect(marker).toBeDefined();
  });

  it('Caddy : certificat à la demande pour un domaine vérifié seulement', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const verified = `u2-${tag()}.exemple-flotte.ca`;
    const pending = `u2-${tag()}.exemple-flotte.ca`;
    domains.push(verified, pending);
    await db(app).insert(schema.organizationDomains).values([
      { organizationId: A.id, domain: verified, kind: 'booking', verificationToken: tag(), verifiedAt: new Date() },
      { organizationId: A.id, domain: pending, kind: 'booking', verificationToken: tag() },
    ]);
    expect((await request(server()).get('/v1/internal/tls/ask').query({ domain: verified }).expect(200)).body).toEqual({ allowed: true });
    expect((await request(server()).get('/v1/internal/tls/ask').query({ domain: verified.toUpperCase() })).status).toBe(200);
    expect((await request(server()).get('/v1/internal/tls/ask').query({ domain: pending })).status).toBe(404);
    expect((await request(server()).get('/v1/internal/tls/ask').query({ domain: 'inconnu-u2.exemple.ca' })).status).toBe(404);
    expect((await request(server()).get('/v1/internal/tls/ask').query({ domain: '127.0.0.1' })).status).toBe(404);
  });

  it('conformité : règle des 60 000 km sur le certificat et renouvellement des antécédents sur réglage', { timeout: 60_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const operator = await createStaffAndLogin(app, ['operator']);
    const expires = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await db(app).update(schema.vehicles).set({ odometerKm: 75_000 }).where(eq(schema.vehicles.id, driverB.vehicleId));
    const [certificate] = await db(app).insert(schema.driverDocuments).values({ driverId: driverB.driverId, type: 'mechanical_check', fileKey: `test/${driverB.driverId}/mechanical`, status: 'pending' }).returning({ id: schema.driverDocuments.id });
    // Approbation par la plateforme avec le kilométrage lu sur le certificat.
    await post(`/v1/admin/documents/${certificate!.id}/review`, operator.tokens, { decision: 'approved', expiresOn: expires, odometerKm: 10_000 }).expect(200);
    const [vehicle] = await db(app).select({ km: schema.vehicles.mechanicalCheckKm }).from(schema.vehicles).where(eq(schema.vehicles.id, driverB.vehicleId));
    expect(vehicle!.km).toBe(10_000);
    const checkOf = async () => (await db(app!).select().from(schema.complianceChecks).where(and(eq(schema.complianceChecks.entityId, driverB.vehicleId), eq(schema.complianceChecks.type, 'mechanical_inspection'), eq(schema.complianceChecks.status, 'pending'))))[0];
    const today = await app.get(ComplianceService).today();
    // 65 000 km depuis la vérification : exigée aujourd'hui, avant la date du certificat.
    expect((await checkOf())?.dueOn).toBe(today);
    await db(app).update(schema.vehicles).set({ mechanicalCheckKm: 70_000 }).where(eq(schema.vehicles.id, driverB.vehicleId));
    await app.get(ComplianceService).refreshDriver(driverB.driverId);
    expect((await checkOf())?.dueOn).toBe(expires);

    // Antécédents judiciaires : non suivis par défaut ; suivis une fois le réglage activé.
    const bgExpires = new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10);
    await db(app).insert(schema.driverDocuments).values({ driverId: driverB.driverId, type: 'background_check', fileKey: `test/${driverB.driverId}/background`, status: 'approved', verifiedAt: new Date(), expiresOn: bgExpires });
    const background = async () => db(app!).select().from(schema.complianceChecks).where(and(eq(schema.complianceChecks.entityId, driverB.driverId), eq(schema.complianceChecks.type, 'document:background_check'), eq(schema.complianceChecks.status, 'pending')));
    await app.get(ComplianceService).refreshDriver(driverB.driverId);
    expect(await background()).toHaveLength(0);
    await setSetting('compliance.background_check_tracked', true);
    await app.get(ComplianceService).refreshDriver(driverB.driverId);
    expect((await background())[0]?.dueOn).toBe(bgExpires);
  });
});
