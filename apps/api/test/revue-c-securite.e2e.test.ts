import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { StaffRole, TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpCode } from '../src/common/crypto.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import { listRoutePolicies, type RoutePolicy } from '../src/modules/auth/route-policies.js';
import { StaffAuthService } from '../src/modules/auth/staff-auth.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testEmail, testPhone, type StaffSession } from './helpers.js';

/**
 * Revue du code du 2 octobre 2026, agent C (sécurité 1, 5 et 6) : le personnel n'écrit plus sur les courses par les
 * routes du client ; `createStaff` ne fusionne jamais un compte client ou chauffeur ; pendant un accès temporaire, le
 * support ne peut ni s'inviter, ni toucher aux membres, aux rôles ou aux sous-organisations, et la plateforme n'invite
 * que pour amorcer une organisation sans propriétaire.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const tag = () => Math.random().toString(36).slice(2, 10);
const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';
const STAFF_ROLES: StaffRole[] = ['admin', 'operator', 'finance', 'readonly'];
const SUPPORT_EXCLUDED = ['members.invite', 'members.manage', 'roles.manage', 'organizations.manage', 'domains.manage'];
type Tokens = Pick<TokensView, 'accessToken'>;

describe('revue du 2 octobre 2026, agent C : personnel, comptes du personnel, accès du support (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  const createdOrgs: string[] = [];
  const get = (path: string, tokens: Tokens) => request(server()).get(path).set(bearer(tokens));
  const post = (path: string, tokens: Tokens, body: object = {}) => request(server()).post(path).set(bearer(tokens)).send(body);

  beforeAll(async () => {
    app = await startTestApp();
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (createdOrgs.length) {
        await db(app).delete(schema.invitations).where(inArray(schema.invitations.organizationId, createdOrgs));
        await db(app).delete(schema.supportAccessGrants).where(inArray(schema.supportAccessGrants.organizationId, createdOrgs));
        await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, createdOrgs));
      }
    }
    await app?.close();
  });

  /** Course planifiée d'un client (paiement au chauffeur : aucune carte nécessaire). */
  async function bookRide(client: Tokens): Promise<string> {
    const quotes = await post('/v1/quotes', client, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    const quote = quotes.body.quotes[0] as { id: string; maxConsentedCents: number };
    const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `revue-c-${tag()}`)
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201);
    return created.body.id as string;
  }

  const concrete = (p: RoutePolicy, rideId: string) => p.path.replace(':id', p.owns?.entity === 'ride' ? rideId : SAMPLE_ID).replace(/:[A-Za-z]+/g, SAMPLE_ID);

  it('sécurité 1 : le personnel ne contourne la propriété qu\'en lecture ; 403 sur chaque POST de /v1/rides/:id/* ; le client, le chauffeur et l\'exploitation gardent leurs routes', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app, testPhone(), {}, { card: false });
    const driver = await createDriver(app);
    const rideId = await bookRide(client);
    const policies = listRoutePolicies(app);
    const ownedWrites = policies.filter((p) => p.owns && p.method !== 'GET');
    const rideWrites = ownedWrites.filter((p) => p.owns!.entity === 'ride');
    expect(rideWrites.map((p) => `${p.method} ${p.path}`)).toEqual(expect.arrayContaining(['POST /v1/rides/:id/cancel', 'POST /v1/rides/:id/share', 'POST /v1/rides/:id/messages', 'POST /v1/rides/:id/sos', 'POST /v1/rides/:id/rate']));
    // Aucune route n'ouvre aujourd'hui l'écriture au personnel ; celle qui le ferait exigerait une permission (contrôle du démarrage).
    for (const p of policies) if (p.owns?.staffMayWrite) expect(p.permissions.length, `${p.method} ${p.path}`).toBeGreaterThan(0);

    const sessions = new Map<StaffRole, StaffSession>();
    for (const role of STAFF_ROLES) {
      const staff = await createStaffAndLogin(app, [role]);
      sessions.set(role, staff);
      await resetHttpLimits(app);
      // Lecture : le personnel voit la course et ses messages.
      await get(`/v1/rides/${rideId}`, staff.tokens).expect(200);
      await get(`/v1/rides/${rideId}/messages`, staff.tokens).expect(200);
      // Écriture par une route du client : refusée, quel que soit le rôle, avant toute action.
      for (const p of rideWrites) {
        const res = await request(server())[p.method.toLowerCase() as 'post'](concrete(p, rideId)).set(bearer(staff.tokens)).send({});
        expect(res.status, `${role} ${p.method} ${p.path}`).toBe(403);
        expect(res.body.code, `${role} ${p.method} ${p.path}`).toBe('NOT_OWNER');
      }
      // Autres ressources possédées (appareils…) : plus de passe-droit non plus (403 ou 404, jamais un succès).
      for (const p of ownedWrites.filter((p) => p.owns!.entity !== 'ride')) {
        const res = await request(server())[p.method.toLowerCase() as 'post' | 'delete' | 'patch' | 'put'](concrete(p, rideId)).set(bearer(staff.tokens)).send({});
        expect([403, 404], `${role} ${p.method} ${p.path}`).toContain(res.status);
      }
    }
    // La course est intacte : ni annulée, ni partagée ; aucun message, aucun incident.
    const [row] = await db(app).select({ state: schema.rides.state, trackingToken: schema.rides.trackingToken }).from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(row).toEqual({ state: 'requested', trackingToken: null });
    expect(await db(app).select({ id: schema.incidents.id }).from(schema.incidents).where(eq(schema.incidents.rideId, rideId))).toHaveLength(0);
    expect(await db(app).select({ id: schema.rideMessages.id }).from(schema.rideMessages).where(eq(schema.rideMessages.rideId, rideId))).toHaveLength(0);

    // L'exploitation agit par ses routes et ses permissions.
    const operator = sessions.get('operator')!;
    await post(`/v1/admin/rides/${rideId}/assign`, operator.tokens, { driverId: driver.driverId }).expect(200);
    const fromOperator = await post(`/v1/admin/rides/${rideId}/messages`, operator.tokens, { body: 'Entrée par la porte 3' }).expect(201);
    expect(fromOperator.body.senderKind).toBe('operator');
    expect((await post(`/v1/admin/rides/${rideId}/messages`, sessions.get('readonly')!.tokens, { body: 'x' })).status).toBe(403);
    // Le chauffeur de la course écrit et déclenche un SOS, mais n'annule ni ne partage par la route du client.
    await post(`/v1/rides/${rideId}/messages`, driver.tokens, { body: 'Je suis en route' }).expect(201);
    expect((await post(`/v1/rides/${rideId}/share`, driver.tokens)).body.code).toBe('NOT_CLIENT');
    expect((await post(`/v1/rides/${rideId}/cancel`, driver.tokens, { reason: 'changed_plans' })).body.code).toBe('NOT_CLIENT');
    // Le client garde ses actions.
    const shared = await post(`/v1/rides/${rideId}/share`, client).expect(200);
    expect(shared.body.token).toMatch(/^[A-Za-z0-9_-]{16,24}$/);
    await post(`/v1/rides/${rideId}/messages`, client, { body: 'Je porte un manteau rouge' }).expect(201);
    const sos = await post(`/v1/rides/${rideId}/sos`, driver.tokens, { description: 'Client agressif' }).expect(201);
    expect(sos.body.status).toBe('alerted');
    const cancelled = await post(`/v1/admin/rides/${rideId}/cancel`, operator.tokens, { reason: 'Le client a appelé pour annuler' }).expect(200);
    expect(cancelled.body.state).toBe('cancelled_by_client');
  });

  it('sécurité 6 : createStaff ne fusionne jamais un compte client ou chauffeur, ne touche pas au téléphone, et révoque les sessions quand le mot de passe change', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const staffService = app.get(StaffAuthService);
    const base = { firstName: 'Revue', lastName: 'C', language: 'fr' as const, password: 'MotDePasse-Revue-C-2026', roles: ['readonly'] as StaffRole[] };
    const userRow = async (id: string) => (await db(app!).select({ phone: schema.users.phone, email: schema.users.email, primaryRole: schema.users.primaryRole, firstName: schema.users.firstName }).from(schema.users).where(eq(schema.users.id, id)))[0]!;

    // Un client (profil client créé à l'inscription) avec un courriel : ni par son courriel, ni par son téléphone.
    const client = await loginByOtp(app, testPhone(), {}, { card: false });
    const clientEmail = testEmail('client');
    await db(app).update(schema.users).set({ email: clientEmail }).where(eq(schema.users.id, client.user.id));
    const before = await userRow(client.user.id);
    await expect(staffService.createStaff({ ...base, email: clientEmail, phone: testPhone() })).rejects.toMatchObject({ code: 'USER_HAS_PROFILE', status: 409 });
    await expect(staffService.createStaff({ ...base, email: testEmail('staff'), phone: before.phone })).rejects.toMatchObject({ code: 'PHONE_TAKEN', status: 409 });
    expect(await userRow(client.user.id)).toEqual(before);
    expect(await db(app).select({ userId: schema.staffCredentials.userId }).from(schema.staffCredentials).where(eq(schema.staffCredentials.userId, client.user.id))).toHaveLength(0);
    expect(await db(app).select({ role: schema.userRoles.role }).from(schema.userRoles).where(and(eq(schema.userRoles.userId, client.user.id), eq(schema.userRoles.role, 'readonly')))).toHaveLength(0);
    // Un chauffeur : même refus.
    const driver = await createDriver(app);
    const driverEmail = testEmail('driver');
    await db(app).update(schema.users).set({ email: driverEmail }).where(eq(schema.users.id, driver.userId));
    await expect(staffService.createStaff({ ...base, email: driverEmail, phone: testPhone() })).rejects.toMatchObject({ code: 'USER_HAS_PROFILE', status: 409 });

    // Un membre du personnel existant, même courriel et autre téléphone : mis à jour, téléphone conservé, sessions révoquées, nouveau mot de passe en vigueur.
    const first = await createStaffAndLogin(app, ['readonly']);
    await get('/v1/me', first.tokens).expect(200);
    const firstBefore = await userRow(first.userId);
    const updated = await staffService.createStaff({ ...base, email: first.email, phone: testPhone(), roles: ['finance'], firstName: 'Nouveau' });
    expect(updated.id).toBe(first.userId);
    // Nom et rôle principal suivent la demande (comportement existant) ; courriel et téléphone sont conservés.
    expect(await userRow(first.userId)).toEqual({ ...firstBefore, firstName: 'Nouveau', primaryRole: 'finance' });
    const revoked = await get('/v1/me', first.tokens);
    expect(revoked.status).toBe(401);
    expect(revoked.body.code).toBe('SESSION_REVOKED');
    expect((await request(server()).post('/v1/auth/staff/login').send({ email: first.email, password: first.password })).status).toBe(401);
    const login = await request(server()).post('/v1/auth/staff/login').send({ email: first.email, password: base.password }).expect(200);
    expect(login.body.status).toBe('mfa_required');
    const roles = (await db(app).select({ role: schema.userRoles.role }).from(schema.userRoles).where(eq(schema.userRoles.userId, first.userId))).map((r) => r.role).sort();
    expect(roles).toEqual(['finance', 'readonly']);

    // Courriel d'un compte du personnel et téléphone d'un autre : refusé, les deux comptes intacts.
    const second = await createStaffAndLogin(app, ['readonly']);
    const secondBefore = await userRow(second.userId);
    await expect(staffService.createStaff({ ...base, email: first.email, phone: secondBefore.phone })).rejects.toMatchObject({ code: 'EMAIL_TAKEN', status: 409 });
    expect(await userRow(second.userId)).toEqual(secondBefore);
    await get('/v1/me', second.tokens).expect(200);
  });

  it('sécurité 5 : pendant un accès du support, ni invitation (même son propre courriel), ni membres, ni rôles, ni sous-organisation ; la plateforme n\'invite que pour amorcer une organisation sans propriétaire', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [root] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    const createOrg = async (name: string) => {
      const id = randomUUID();
      await db(app!).insert(schema.organizations).values({ id, code: `revue-c-${name}-${id.slice(0, 8)}`, name: `Revue C ${name}`, type: 'fleet', parentId: root!.id, path: `${root!.path}${id}/` });
      createdOrgs.push(id);
      return id;
    };
    const systemRoleId = async (code: string) => (await db(app!).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, code), isNull(schema.roles.organizationId))).limit(1))[0]!.id;
    const A = await createOrg('A');
    const [ownerRoleId, dispatcherRoleId] = await Promise.all([systemRoleId('org_owner'), systemRoleId('dispatcher')]);

    // Propriétaire de A, connecté par code SMS puis second facteur (l'approbation d'un accès du support est une permission sensible).
    const otp = await loginByOtp(app, testPhone(), {}, { card: false });
    const [membership] = await db(app).insert(schema.memberships).values({ userId: otp.user.id, organizationId: A, roleId: ownerRoleId, scope: 'organization' }).returning({ id: schema.memberships.id });
    app.get(AccessService).invalidate(otp.user.id);
    const start = await post('/v1/auth/mfa/start', otp).expect(200);
    const enroll = await request(server()).post('/v1/auth/mfa/enroll').send({ mfaToken: start.body.mfaToken }).expect(200);
    const confirm = await request(server()).post('/v1/auth/mfa/confirm').send({ mfaToken: start.body.mfaToken, code: totpCode(enroll.body.secret as string) }).expect(200);
    const owner = confirm.body as TokensView;

    const support = await createStaffAndLogin(app, ['admin']);
    const grant = await post(`/v1/admin/organizations/${A}/support-access`, support.tokens, { reason: 'Vérifier une invitation contestée (revue C)', durationMinutes: 30 }).expect(201);
    await post(`/v1/org/${A}/support-access/${grant.body.id}/approve`, owner).expect(200);

    // Pendant l'accès : lecture, mais aucune des permissions exclues.
    await get(`/v1/org/${A}/members`, support.tokens).expect(200);
    const home = await get(`/v1/org/${A}`, support.tokens).expect(200);
    expect(home.body.supportAccess).toMatchObject({ grantId: grant.body.id });
    expect(home.body.permissions).toContain('rides.read');
    for (const code of SUPPORT_EXCLUDED) expect(home.body.permissions, code).not.toContain(code);
    // S'inviter soi-même comme propriétaire : refusé, aucune invitation créée.
    const self = await post(`/v1/org/${A}/invitations`, support.tokens, { roleId: ownerRoleId, email: support.email });
    expect(self.status).toBe(403);
    expect(self.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['members.invite'] } });
    expect(await db(app).select({ id: schema.invitations.id }).from(schema.invitations).where(eq(schema.invitations.organizationId, A))).toHaveLength(0);
    // Membres, rôles, sous-organisations : refusés aussi.
    expect((await request(server()).patch(`/v1/org/${A}/memberships/${membership!.id}`).set(bearer(support.tokens)).send({ status: 'suspended' })).status).toBe(403);
    expect((await request(server()).delete(`/v1/org/${A}/memberships/${membership!.id}`).set(bearer(support.tokens))).status).toBe(403);
    expect((await post(`/v1/org/${A}/roles`, support.tokens, { code: `revue_c_${tag()}`, name: 'Rôle', level: 2, permissions: ['rides.read'] })).status).toBe(403);
    expect((await post(`/v1/org/${A}/organizations`, support.tokens, { code: `revue-c-sub-${tag()}`, name: 'Sous-organisation', type: 'sub_org' })).status).toBe(403);
    expect((await post(`/v1/org/${A}/ownership/transfer`, support.tokens, { membershipId: membership!.id })).status).toBe(403);
    expect(await db(app).select({ status: schema.memberships.status }).from(schema.memberships).where(eq(schema.memberships.id, membership!.id))).toEqual([{ status: 'active' }]);

    // Plateforme : une organisation qui a un propriétaire n'accepte plus d'invitation de la plateforme ; une organisation sans propriétaire, oui (amorçage).
    const platform = await post(`/v1/admin/organizations/${A}/invitations`, support.tokens, { roleId: ownerRoleId, email: support.email });
    expect(platform.status).toBe(409);
    expect(platform.body.code).toBe('ORGANIZATION_HAS_OWNER');
    const B = await createOrg('B');
    await post(`/v1/admin/organizations/${B}/invitations`, support.tokens, { roleId: ownerRoleId, email: testEmail('owner-b') }).expect(201);
    // Le propriétaire, lui, invite toujours depuis My Hub.
    await post(`/v1/org/${A}/invitations`, owner, { roleId: dispatcherRoleId, phone: testPhone() }).expect(201);
  });

  it('sécurité 4 : les mots de passe faux verrouillent le couple courriel et adresse, jamais le compte ; un 423 ne révèle pas l\'existence d\'un compte', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const staff = await createStaffAndLogin(app, ['finance']);
    // `trust proxy 1` : l'adresse du client vient de X-Forwarded-For (un seul relais, Caddy).
    const login = (email: string, password: string, ip: string) => request(server()).post('/v1/auth/staff/login').set('X-Forwarded-For', ip).send({ email, password });
    const attacker = '198.51.100.7';
    const elsewhere = '198.51.100.8';
    for (let i = 0; i < 5; i += 1) {
      const res = await login(staff.email, 'faux-mot-de-passe', attacker);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    // Depuis cette adresse : verrou dur, même avec le bon mot de passe ; depuis une autre, le membre du personnel se connecte.
    const locked = await login(staff.email, staff.password, attacker);
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.details.retryAfter).toBeGreaterThan(0);
    const home = await login(staff.email, staff.password, elsewhere);
    expect(home.status).toBe(200);
    expect(home.body.status).toBe('mfa_required');
    // Le compte n'a pas été verrouillé en base : aucun échec de mot de passe n'y est compté.
    const [credentials] = await db(app).select({ failedAttempts: schema.staffCredentials.failedAttempts, lockedUntil: schema.staffCredentials.lockedUntil }).from(schema.staffCredentials).where(eq(schema.staffCredentials.userId, staff.userId));
    expect(credentials).toEqual({ failedAttempts: 0, lockedUntil: null });
    // Un courriel inconnu reçoit exactement la même suite de réponses (401 puis 423) : rien à énumérer.
    const unknown = testEmail('inconnu');
    for (let i = 0; i < 5; i += 1) expect((await login(unknown, 'faux-mot-de-passe', attacker)).status).toBe(401);
    const unknownLocked = await login(unknown, 'faux-mot-de-passe', attacker);
    expect(unknownLocked.status).toBe(423);
    expect(unknownLocked.body.code).toBe('ACCOUNT_LOCKED');
  });
});
