import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessService } from '../src/modules/auth/access.service.js';
import { listRoutePolicies, type RoutePolicy } from '../src/modules/auth/route-policies.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testPhone, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Étape 20, barrière de l'API : routes `/v1/org/:organizationId`. Deux organisations sœurs A et B sous la racine, chacune
 * avec chauffeur, véhicule, client, course et relevé. Le propriétaire de A (session à double authentification, ancien rôle
 * « readonly » sur la plateforme, qui ne doit rien donner ici), un lecteur de A (rôle personnalisé « lecture des courses »),
 * un administrateur de B (rôle système `org_admin`, connecté par code SMS) et l'administrateur de la plateforme.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const tag = () => Math.random().toString(36).slice(2, 10);
const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';
type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

interface TestOrg {
  id: string;
  path: string;
  driver: TestDriver;
  client: TokensView;
  rideId: string;
  statementId: string;
}

describe('isolation par organisation : routes /v1/org (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  let A: TestOrg;
  let B: TestOrg;
  let ownerA: StaffSession;
  let readerA: TokensView;
  let memberB: TokensView;
  let platformAdmin: StaffSession;
  let ownerRoleId = '';
  let readerRoleId = '';
  let readerMembershipId = '';
  let roleBId = '';
  let memberBMembershipId = '';
  const createdRoles: string[] = [];
  const orgIds: string[] = [];

  const systemRoleId = async (code: string) => (await db(app!).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, code), sql`${schema.roles.organizationId} IS NULL`)).limit(1))[0]!.id;
  const addMembership = async (userId: string, organizationId: string, roleId: string) => {
    const [row] = await db(app!).insert(schema.memberships).values({ userId, organizationId, roleId }).returning({ id: schema.memberships.id });
    app!.get(AccessService).invalidate(userId);
    return row!.id;
  };
  const addRole = async (organizationId: string, name: string, permissions: string[]) => {
    const [row] = await db(app!).insert(schema.roles).values({ organizationId, code: `t_${tag()}`, name, level: 2 }).returning({ id: schema.roles.id });
    await db(app!).insert(schema.rolePermissions).values(permissions.map((permissionCode) => ({ roleId: row!.id, permissionCode })));
    createdRoles.push(row!.id);
    return row!.id;
  };
  const orgRoutes = () => listRoutePolicies(app!).filter((p) => p.path.startsWith('/v1/org/'));
  const call = (p: RoutePolicy, organizationId: string, tokens: Pick<TokensView, 'accessToken'>) =>
    request(server())[p.method.toLowerCase() as Method](p.path.replace(':organizationId', organizationId).replace(/:[A-Za-z]+/g, SAMPLE_ID)).set(bearer(tokens)).send({});
  const get = (path: string, tokens: Pick<TokensView, 'accessToken'>) => request(server()).get(path).set(bearer(tokens));
  const auditCount = async (organizationId: string) => (await db(app!).select({ n: count() }).from(schema.auditLog).where(eq(schema.auditLog.organizationId, organizationId)))[0]!.n;

  async function createOrg(name: string, root: { id: string; path: string }): Promise<TestOrg> {
    const id = randomUUID();
    const path = `${root.path}${id}/`;
    await db(app!).insert(schema.organizations).values({ id, code: `isor-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `Isolation routes ${name}`, type: 'fleet', parentId: root.id, path });
    orgIds.push(id);
    const driver = await createDriver(app!);
    await db(app!).update(schema.drivers).set({ organizationId: id }).where(eq(schema.drivers.id, driver.driverId));
    await db(app!).update(schema.vehicles).set({ organizationId: id }).where(eq(schema.vehicles.id, driver.vehicleId));
    const client = await loginByOtp(app!);
    await db(app!).update(schema.clients).set({ organizationId: id }).where(eq(schema.clients.userId, client.user.id));
    const quotes = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    const quote = quotes.body.quotes[0] as { id: string; maxConsentedCents: number };
    const ride = await request(server())
      .post('/v1/rides')
      .set(bearer(client))
      .set('Idempotency-Key', `isor-${tag()}`)
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents })
      .expect(201);
    await db(app!).update(schema.rides).set({ organizationId: id }).where(eq(schema.rides.id, ride.body.id));
    const [statement] = await db(app!).insert(schema.weeklyStatements).values({ driverId: driver.driverId, organizationId: id, periodStart: '2026-09-21', periodEnd: '2026-09-27' }).returning({ id: schema.weeklyStatements.id });
    return { id, path, driver, client, rideId: ride.body.id as string, statementId: statement!.id };
  }

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    const [root] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(sql`${schema.organizations.parentId} IS NULL`).limit(1);
    A = await createOrg('A', root!);
    B = await createOrg('B', root!);
    ownerRoleId = await systemRoleId('org_owner');
    ownerA = await createStaffAndLogin(app, ['readonly']);
    await addMembership(ownerA.userId, A.id, ownerRoleId);
    readerA = await loginByOtp(app);
    readerRoleId = await addRole(A.id, 'Lecture des courses', ['rides.read']);
    readerMembershipId = await addMembership(readerA.user.id, A.id, readerRoleId);
    memberB = await loginByOtp(app);
    memberBMembershipId = await addMembership(memberB.user.id, B.id, await systemRoleId('org_admin'));
    roleBId = await addRole(B.id, 'Rôle de B', ['rides.read']);
    platformAdmin = await createStaffAndLogin(app, ['admin']);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (createdRoles.length) {
        await db(app).delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, createdRoles));
        await db(app).delete(schema.roles).where(inArray(schema.roles.id, createdRoles));
      }
      if (orgIds.length) {
        await db(app).delete(schema.organizationFeatures).where(inArray(schema.organizationFeatures.organizationId, orgIds));
        await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, orgIds));
      }
    }
    await app?.close();
  });

  it('inventaire : toute route sous /v1/org/ porte @OrgScoped et @Can, sans ancien rôle du personnel', ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const routes = orgRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(15);
    for (const p of routes) {
      const label = `${p.method} ${p.path}`;
      expect(p.orgScoped, label).toBe(true);
      expect(p.permissions.length, label).toBeGreaterThan(0);
      expect(p.roles, label).toEqual([]);
      expect(p.public || p.authenticated, label).toBe(false);
    }
    const byPath = new Map(routes.map((p) => [`${p.method} ${p.path}`, p]));
    expect(byPath.get('GET /v1/org/:organizationId/drivers')?.permissions).toEqual(['drivers.read']);
    expect(byPath.get('POST /v1/org/:organizationId/roles')?.permissions).toEqual(['roles.manage']);
    expect(byPath.get('GET /v1/org/:organizationId/audit')?.permissions).toEqual(['audit.read']);
  });

  it('GET /v1/me/organizations : adhésions actives avec organisation et rôle', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const mine = await get('/v1/me/organizations', ownerA.tokens).expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ organizationId: A.id, path: A.path, type: 'fleet', roleId: ownerRoleId, roleCode: 'org_owner', scope: 'organization', status: 'active', expiresAt: null })]);
    const reader = await get('/v1/me/organizations', readerA).expect(200);
    expect(reader.body).toEqual([expect.objectContaining({ membershipId: readerMembershipId, organizationId: A.id, roleId: readerRoleId, roleName: 'Lecture des courses' })]);
    const b = await get('/v1/me/organizations', memberB).expect(200);
    expect(b.body.map((m: { organizationId: string; roleCode: string }) => [m.organizationId, m.roleCode])).toEqual([[B.id, 'org_admin']]);
    // Une adhésion suspendue n'y figure pas.
    await db(app).update(schema.memberships).set({ status: 'suspended' }).where(eq(schema.memberships.id, memberBMembershipId));
    expect((await get('/v1/me/organizations', memberB).expect(200)).body).toEqual([]);
    await db(app).update(schema.memberships).set({ status: 'active' }).where(eq(schema.memberships.id, memberBMembershipId));
  });

  it('fiche : permissions effectives dans l\'organisation, modules de la formule, double authentification ; les anciens rôles du personnel n\'y donnent rien', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const home = await get(`/v1/org/${A.id}`, ownerA.tokens).expect(200);
    expect(home.body.organization).toMatchObject({ id: A.id, path: A.path, type: 'fleet' });
    expect(home.body.permissions).toEqual(expect.arrayContaining(['members.manage', 'roles.manage', 'rides.read', 'drivers.read']));
    expect(home.body.permissions).not.toContain('staff.manage');
    expect(home.body.modulesRestricted).toBe(false);
    expect(home.body.modules).toContain('rides');
    const reader = await get(`/v1/org/${A.id}`, readerA).expect(200);
    expect(reader.body.permissions).toEqual(['rides.read']);
    // L'ancien rôle « readonly » du propriétaire de A ne donne rien dans B ; l'administrateur de la plateforme n'est membre de rien.
    const crossed = await get(`/v1/org/${B.id}`, ownerA.tokens);
    expect(crossed.status).toBe(403);
    expect(crossed.body.code).toBe('NOT_A_MEMBER');
    const admin = await get(`/v1/org/${A.id}`, platformAdmin.tokens);
    expect(admin.status).toBe(403);
    expect(admin.body.code).toBe('NOT_A_MEMBER');
    // Modules de la formule : B limitée au module des courses, l'administrateur de B perd la lecture des chauffeurs.
    await db(app).insert(schema.organizationFeatures).values([{ organizationId: B.id, module: 'rides', enabled: true }, { organizationId: B.id, module: 'drivers', enabled: false }]);
    app.get(AccessService).invalidate();
    try {
      const limited = await get(`/v1/org/${B.id}`, memberB).expect(200);
      expect(limited.body).toMatchObject({ modulesRestricted: true, modules: ['rides'] });
      expect(limited.body.permissions).toContain('rides.read');
      expect(limited.body.permissions).not.toContain('drivers.read');
      const drivers = await get(`/v1/org/${B.id}/drivers`, memberB);
      expect(drivers.status).toBe(403);
      expect(drivers.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['drivers.read'] } });
    } finally {
      await db(app).delete(schema.organizationFeatures).where(eq(schema.organizationFeatures.organizationId, B.id));
      app.get(AccessService).invalidate();
    }
    // Sans double authentification, une permission sensible ne compte pas : un propriétaire connecté par code SMS ne gère pas les membres.
    const otpOwner = await loginByOtp(app);
    await addMembership(otpOwner.user.id, A.id, ownerRoleId);
    const otpHome = await get(`/v1/org/${A.id}`, otpOwner).expect(200);
    expect(otpHome.body.permissions).toContain('members.read');
    expect(otpHome.body.permissions).not.toContain('members.manage');
    const denied = await request(server()).patch(`/v1/org/${A.id}/memberships/${readerMembershipId}`).set(bearer(otpOwner)).send({ status: 'active' });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['members.manage'] } });
  });

  it('chaque route : hors de son organisation NOT_A_MEMBER, sans la permission FORBIDDEN_ROLE, organisation inconnue 404', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    for (const p of orgRoutes()) {
      const label = `${p.method} ${p.path}`;
      const crossed = await call(p, B.id, ownerA.tokens);
      expect(crossed.status, label).toBe(403);
      expect(crossed.body.code, label).toBe('NOT_A_MEMBER');
      const unknown = await call(p, randomUUID(), ownerA.tokens);
      expect(unknown.status, label).toBe(404);
      expect(unknown.body.code, label).toBe('ORGANIZATION_NOT_FOUND');
      const reader = await call(p, A.id, readerA);
      if (p.permissions.includes('rides.read')) {
        expect(reader.body.code, label).not.toBe('FORBIDDEN_ROLE');
      } else {
        expect(reader.status, label).toBe(403);
        expect(reader.body, label).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: p.permissions } });
      }
    }
  });

  it('lectures : le propriétaire de A ne voit que A (chauffeurs, véhicules, courses, relevés, membres, rôles) ; la plateforme voit tout par /admin', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const drivers = await get(`/v1/org/${A.id}/drivers?pageSize=50`, ownerA.tokens).expect(200);
    expect(drivers.body.items.map((d: { id: string }) => d.id)).toEqual([A.driver.driverId]);
    expect(drivers.body.total).toBe(1);
    expect((await get(`/v1/org/${A.id}/drivers/${A.driver.driverId}`, ownerA.tokens).expect(200)).body.driver.id).toBe(A.driver.driverId);
    const otherDriver = await get(`/v1/org/${A.id}/drivers/${B.driver.driverId}`, ownerA.tokens);
    expect(otherDriver.status).toBe(404);
    expect(otherDriver.body.code).toBe('DRIVER_NOT_FOUND');
    const vehicles = await get(`/v1/org/${A.id}/vehicles?pageSize=50`, ownerA.tokens).expect(200);
    expect(vehicles.body.items.map((v: { id: string }) => v.id)).toEqual([A.driver.vehicleId]);
    const rides = await get(`/v1/org/${A.id}/rides?view=recent&pageSize=50`, ownerA.tokens).expect(200);
    expect(rides.body.items.map((r: { id: string }) => r.id)).toEqual([A.rideId]);
    expect(rides.body.total).toBe(1);
    expect((await get(`/v1/org/${A.id}/rides/${A.rideId}`, ownerA.tokens).expect(200)).body.id).toBe(A.rideId);
    const otherRide = await get(`/v1/org/${A.id}/rides/${B.rideId}`, ownerA.tokens);
    expect(otherRide.status).toBe(404);
    expect(otherRide.body.code).toBe('RIDE_NOT_FOUND');
    const statements = await get(`/v1/org/${A.id}/statements?pageSize=50`, ownerA.tokens).expect(200);
    expect(statements.body.items.map((s: { id: string }) => s.id)).toEqual([A.statementId]);
    const members = await get(`/v1/org/${A.id}/members`, ownerA.tokens).expect(200);
    const memberUserIds = members.body.map((m: { userId: string }) => m.userId);
    expect(memberUserIds).toEqual(expect.arrayContaining([ownerA.userId, readerA.user.id]));
    expect(memberUserIds).not.toContain(memberB.user.id);
    const roles = await get(`/v1/org/${A.id}/roles`, ownerA.tokens).expect(200);
    const roleIds = roles.body.map((r: { id: string }) => r.id);
    expect(roleIds).toContain(readerRoleId);
    expect(roleIds).toContain(ownerRoleId);
    expect(roleIds).not.toContain(roleBId);
    // Le lecteur voit les courses de A ; l'administrateur de B, celles de B.
    expect((await get(`/v1/org/${A.id}/rides?view=recent`, readerA).expect(200)).body.items.map((r: { id: string }) => r.id)).toEqual([A.rideId]);
    expect((await get(`/v1/org/${B.id}/rides?view=recent`, memberB).expect(200)).body.items.map((r: { id: string }) => r.id)).toEqual([B.rideId]);
    expect((await get(`/v1/org/${B.id}/drivers`, memberB).expect(200)).body.items.map((d: { id: string }) => d.id)).toEqual([B.driver.driverId]);
    // La plateforme voit tout, par /admin.
    const all = await get(`/v1/admin/drivers?q=${encodeURIComponent(B.driver.phone)}`, platformAdmin.tokens).expect(200);
    expect(all.body.items.map((d: { id: string }) => d.id)).toEqual([B.driver.driverId]);
    await get(`/v1/admin/rides/${A.rideId}`, platformAdmin.tokens).expect(200);
    await get(`/v1/admin/rides/${B.rideId}`, platformAdmin.tokens).expect(200);
  });

  it('écritures : rôles, invitations et adhésions dans A seulement ; pas d\'escalade ; journal d\'audit porté par A', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Rôles : créé dans A (jamais ailleurs), sans permission de la plateforme ; rôle de B invisible ; rôle système figé.
    const created = await request(server()).post(`/v1/org/${A.id}/roles`).set(bearer(ownerA.tokens)).send({ code: `agent_${tag()}`, name: 'Agent de test', level: 2, permissions: ['rides.read', 'drivers.read'] });
    expect(created.status).toBe(201);
    createdRoles.push(created.body.id);
    expect(created.body).toMatchObject({ organizationId: A.id, system: false, permissions: ['drivers.read', 'rides.read'] });
    const escalation = await request(server()).post(`/v1/org/${A.id}/roles`).set(bearer(ownerA.tokens)).send({ code: `esc_${tag()}`, name: 'Escalade', level: 2, permissions: ['rides.read', 'queues.read'] });
    expect(escalation.status).toBe(403);
    expect(escalation.body).toMatchObject({ code: 'PERMISSION_ESCALATION', details: { refused: ['queues.read'] } });
    const noRolesManage = await request(server()).post(`/v1/org/${B.id}/roles`).set(bearer(memberB)).send({ code: `b_${tag()}`, name: 'Rôle', level: 2, permissions: ['rides.read'] });
    expect(noRolesManage.status).toBe(403);
    expect(noRolesManage.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['roles.manage'] } });
    const foreignRole = await request(server()).put(`/v1/org/${A.id}/roles/${roleBId}/permissions`).set(bearer(ownerA.tokens)).send({ permissions: ['rides.read'] });
    expect(foreignRole.status).toBe(404);
    expect(foreignRole.body.code).toBe('ROLE_NOT_FOUND');
    expect((await request(server()).put(`/v1/org/${A.id}/roles/${ownerRoleId}/permissions`).set(bearer(ownerA.tokens)).send({ permissions: ['rides.read'] })).status).toBe(409);
    const updated = await request(server()).put(`/v1/org/${A.id}/roles/${created.body.id}/permissions`).set(bearer(ownerA.tokens)).send({ permissions: ['rides.read'] }).expect(200);
    expect(updated.body.permissions).toEqual(['rides.read']);

    // Invitation dans A : l'entrée d'audit porte A ; dans B : refusée ; avec un rôle de B : introuvable, et rien n'est journalisé.
    const dispatcherId = await systemRoleId('dispatcher');
    const before = await auditCount(A.id);
    const invitation = await request(server()).post(`/v1/org/${A.id}/invitations`).set(bearer(ownerA.tokens)).send({ roleId: dispatcherId, phone: testPhone() });
    expect(invitation.status).toBe(201);
    // Étape 21 : le lien part par texto après la validation de la transaction restreinte ; le jeton n'est plus rendu.
    expect(invitation.body).toMatchObject({ channel: 'sms' });
    expect(invitation.body.token).toBeUndefined();
    const [queued] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.template, 'organization.invitation'), sql`${schema.notifications.data}->>'invitationId' = ${invitation.body.id as string}`));
    expect(queued).toMatchObject({ organizationId: A.id, channel: 'sms' });
    const [stored] = await db(app).select({ organizationId: schema.invitations.organizationId }).from(schema.invitations).where(eq(schema.invitations.id, invitation.body.id));
    expect(stored!.organizationId).toBe(A.id);
    const [entry] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, invitation.body.id), eq(schema.auditLog.action, 'invitation.created')));
    expect(entry).toMatchObject({ organizationId: A.id, actorUserId: ownerA.userId });
    expect((await request(server()).post(`/v1/org/${B.id}/invitations`).set(bearer(ownerA.tokens)).send({ roleId: dispatcherId, phone: testPhone() })).body.code).toBe('NOT_A_MEMBER');
    const rejected = await request(server()).post(`/v1/org/${A.id}/invitations`).set(bearer(ownerA.tokens)).send({ roleId: roleBId, phone: testPhone() });
    expect(rejected.status).toBe(404);
    expect(rejected.body.code).toBe('ROLE_NOT_FOUND');
    expect(await auditCount(A.id)).toBe(before + 1);

    // Adhésions : celle de B est introuvable depuis A ; suspension puis réactivation du lecteur ; retrait d'un membre de A.
    const foreign = await request(server()).patch(`/v1/org/${A.id}/memberships/${memberBMembershipId}`).set(bearer(ownerA.tokens)).send({ status: 'suspended' });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe('MEMBERSHIP_NOT_FOUND');
    const suspended = await request(server()).patch(`/v1/org/${A.id}/memberships/${readerMembershipId}`).set(bearer(ownerA.tokens)).send({ status: 'suspended' }).expect(200);
    expect(suspended.body).toMatchObject({ id: readerMembershipId, status: 'suspended' });
    expect((await get(`/v1/org/${A.id}/rides`, readerA)).body.code).toBe('NOT_A_MEMBER');
    await request(server()).patch(`/v1/org/${A.id}/memberships/${readerMembershipId}`).set(bearer(ownerA.tokens)).send({ status: 'active' }).expect(200);
    await get(`/v1/org/${A.id}/rides`, readerA).expect(200);
    const notManager = await request(server()).patch(`/v1/org/${B.id}/memberships/${memberBMembershipId}`).set(bearer(memberB)).send({ status: 'active' });
    expect(notManager.status).toBe(403);
    expect(notManager.body.code).toBe('FORBIDDEN_ROLE');
    expect((await request(server()).delete(`/v1/org/${A.id}/memberships/${memberBMembershipId}`).set(bearer(ownerA.tokens))).status).toBe(404);
    const leaving = await loginByOtp(app);
    const leavingMembership = await addMembership(leaving.user.id, A.id, dispatcherId);
    await request(server()).delete(`/v1/org/${A.id}/memberships/${leavingMembership}`).set(bearer(ownerA.tokens)).expect(204);
    expect(await db(app).select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.id, leavingMembership))).toHaveLength(0);
    expect(await db(app).select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.id, memberBMembershipId))).toHaveLength(1);

    // Journal : celui de A ne contient que des entrées de A (dont l'invitation et les adhésions) ; celui de B ne les voit pas.
    const auditA = await get(`/v1/org/${A.id}/audit?limit=200`, ownerA.tokens).expect(200);
    const itemsA = auditA.body.items as Array<{ id: string; organizationId: string | null; action: string }>;
    expect(itemsA.length).toBeGreaterThanOrEqual(4);
    expect(itemsA.every((i) => i.organizationId === A.id)).toBe(true);
    expect(itemsA.some((i) => i.id === entry!.id)).toBe(true);
    expect(itemsA.map((i) => i.action)).toEqual(expect.arrayContaining(['role.created', 'role.permissions_updated', 'membership.updated', 'membership.removed']));
    const auditB = await get(`/v1/org/${B.id}/audit?limit=200`, memberB).expect(200);
    const itemsB = auditB.body.items as Array<{ id: string; organizationId: string | null }>;
    expect(itemsB.every((i) => i.organizationId === B.id)).toBe(true);
    expect(itemsB.some((i) => i.id === entry!.id)).toBe(false);
    // Le lecteur de A n'a pas audit.read.
    expect((await get(`/v1/org/${A.id}/audit`, readerA)).status).toBe(403);
  });
});
