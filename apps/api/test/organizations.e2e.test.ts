import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessService } from '../src/modules/auth/access.service.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, invitationToken, loginByOtp, startTestApp, testPhone, type StaffSession } from './helpers.js';

/** Étape 19 : organisations en arbre, rôle personnalisé qui limite réellement l'accès, invitations, pas d'escalade. */
const tag = () => Math.random().toString(36).slice(2, 10);

describe('organisations, rôles et adhésions (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let rootId = '';
  const createdRoles: string[] = [];
  const createdOrgs: string[] = [];
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    admin = await createStaffAndLogin(app, ['admin']);
    const orgs = await request(server()).get('/v1/admin/organizations').set(bearer(admin.tokens)).expect(200);
    rootId = (orgs.body as Array<{ id: string; parentId: string | null }>).find((o) => o.parentId === null)!.id;
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (createdRoles.length) {
        await db(app).delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, createdRoles));
        await db(app).delete(schema.roles).where(inArray(schema.roles.id, createdRoles));
      }
      if (createdOrgs.length) await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, createdOrgs));
    }
    await app?.close();
  });

  const createRole = async (tokens: StaffSession['tokens'], organizationId: string, permissions: string[]) => {
    const res = await request(server()).post('/v1/admin/roles').set(bearer(tokens)).send({ organizationId, code: `test_${tag()}`, name: 'Rôle de test', level: 2, permissions });
    if (res.status === 201) createdRoles.push(res.body.id);
    return res;
  };

  it('un rôle personnalisé limite réellement l\'accès ; invitation à usage unique ; suspension immédiate', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const role = await createRole(admin.tokens, rootId, ['rides.read']);
    expect(role.status).toBe(201);
    expect(role.body).toMatchObject({ system: false, permissions: ['rides.read'] });

    const phone = testPhone();
    const member = await loginByOtp(app, phone);
    expect((await request(server()).get('/v1/admin/rides').set(bearer(member))).status).toBe(403);

    const invitation = await request(server()).post(`/v1/admin/organizations/${rootId}/invitations`).set(bearer(admin.tokens)).send({ roleId: role.body.id, phone }).expect(201);
    // Étape 21 : le jeton n'est plus rendu ; le lien part par texto (avis mis en file).
    expect(invitation.body).toMatchObject({ channel: 'sms' });
    expect(invitation.body.token).toBeUndefined();
    const token = await invitationToken(app, invitation.body.id);
    expect(token).toMatch(/^inv_/);
    const [stored] = await db(app).select().from(schema.invitations).where(eq(schema.invitations.id, invitation.body.id));
    expect(stored!.tokenHash).not.toContain(token);

    // Une autre personne ne peut pas s'en servir.
    const stranger = await loginByOtp(app);
    expect((await request(server()).post('/v1/invitations/accept').set(bearer(stranger)).send({ token })).status).toBe(403);

    const accepted = await request(server()).post('/v1/invitations/accept').set(bearer(member)).send({ token }).expect(200);
    expect(accepted.body).toMatchObject({ organizationId: rootId, roleId: role.body.id, status: 'active' });
    expect((await request(server()).post('/v1/invitations/accept').set(bearer(member)).send({ token })).status).toBe(409);

    // Le rôle donne la lecture des courses, et rien d'autre.
    await request(server()).get('/v1/admin/rides').set(bearer(member)).expect(200);
    const drivers = await request(server()).get('/v1/admin/drivers').set(bearer(member));
    expect(drivers.status).toBe(403);
    expect(drivers.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['drivers.read'] } });

    const members = await request(server()).get(`/v1/admin/organizations/${rootId}/members`).set(bearer(admin.tokens)).expect(200);
    expect((members.body as Array<{ id: string }>).some((m) => m.id === accepted.body.id)).toBe(true);
    await request(server()).patch(`/v1/admin/memberships/${accepted.body.id}`).set(bearer(admin.tokens)).send({ status: 'suspended' }).expect(200);
    expect((await request(server()).get('/v1/admin/rides').set(bearer(member))).status).toBe(403);
  });

  it('pas d\'escalade ; jamais une permission de la plateforme pour une organisation cliente ; rôles système en lecture seule', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const operator = await createStaffAndLogin(app, ['operator']);
    // Le répartiteur reçoit en plus la gestion des rôles, par une adhésion (session à double authentification).
    const manager = await createRole(admin.tokens, rootId, ['roles.manage', 'roles.read']);
    const [roleRow] = await db(app).select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.id, manager.body.id));
    await db(app).insert(schema.memberships).values({ userId: operator.userId, organizationId: rootId, roleId: roleRow!.id });
    app.get(AccessService).invalidate(operator.userId);

    const escalation = await createRole(operator.tokens, rootId, ['rides.read', 'settings.edit']);
    expect(escalation.status).toBe(403);
    expect(escalation.body).toMatchObject({ code: 'PERMISSION_ESCALATION', details: { refused: ['settings.edit'] } });
    expect((await createRole(operator.tokens, rootId, ['rides.read', 'rides.cancel'])).status).toBe(201);

    const client = await request(server()).post('/v1/admin/organizations').set(bearer(admin.tokens)).send({ parentId: rootId, code: `test-${tag()}`, name: 'Flotte de test', type: 'fleet' }).expect(201);
    createdOrgs.push(client.body.id);
    expect(client.body.path.startsWith('/')).toBe(true);
    expect(client.body.parentId).toBe(rootId);
    const platformOnly = await createRole(operator.tokens, client.body.id, ['queues.read']);
    expect(platformOnly.status).toBe(403);
    expect(platformOnly.body.details.refused).toEqual(['queues.read']);
    expect((await createRole(operator.tokens, client.body.id, ['rides.read'])).status).toBe(201);

    const roles = await request(server()).get(`/v1/admin/roles?organizationId=${client.body.id}`).set(bearer(admin.tokens)).expect(200);
    const system = (roles.body as Array<{ id: string; code: string; system: boolean }>).find((r) => r.code === 'org_owner')!;
    expect(system.system).toBe(true);
    expect((await request(server()).put(`/v1/admin/roles/${system.id}/permissions`).set(bearer(admin.tokens)).send({ permissions: ['rides.read'] })).status).toBe(409);
    const catalog = await request(server()).get('/v1/admin/permissions').set(bearer(admin.tokens)).expect(200);
    expect((catalog.body as Array<{ code: string; sensitive: boolean }>).find((p) => p.code === 'roles.manage')?.sensitive).toBe(true);
  });
});
