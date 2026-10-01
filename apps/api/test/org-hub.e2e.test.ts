import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockSmsProvider } from '../src/adapters/mock/index.js';
import { SMS_PROVIDER } from '../src/adapters/types.js';
import { totpCode } from '../src/common/crypto.js';
import { AccessService } from '../src/modules/auth/access.service.js';
import { StaffAuthService } from '../src/modules/auth/staff-auth.service.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testEmail, testPhone, trackUser } from './helpers.js';

/**
 * Étape 21 : My Hub côté organisation cliente. Second facteur des membres connectés par code SMS, règle du dernier
 * propriétaire et transfert, invitations envoyées par texto ou courriel (jeton jamais rendu), sous-organisations, tableau
 * de bord, catalogue, accès temporaire du support (demande, approbation, accès pendant la durée seulement, refus après
 * révocation ou expiration, journal), et le parcours du critère : un administrateur N1 crée une sous-organisation, un rôle
 * limité et invite un agent, qui ne voit que ce que son rôle permet.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const tag = () => Math.random().toString(36).slice(2, 10);
type Tokens = Pick<TokensView, 'accessToken'>;

describe('My Hub côté organisation et accès du support (étape 21, intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  let root: { id: string; path: string };
  let A: { id: string; path: string };
  let B: { id: string; path: string };
  let ownerRoleId = '';
  let dispatcherRoleId = '';
  let owner: { phone: string; userId: string; membershipId: string; tokens: TokensView; secret: string };
  let memberB: TokensView;
  const orgPaths = new Map<string, string>();
  const createdRoles: string[] = [];

  const get = (path: string, tokens: Tokens) => request(server()).get(path).set(bearer(tokens));
  const post = (path: string, tokens: Tokens, body: object = {}) => request(server()).post(path).set(bearer(tokens)).send(body);
  const systemRoleId = async (code: string) => (await db(app!).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, code), isNull(schema.roles.organizationId))).limit(1))[0]!.id;
  const addMembership = async (userId: string, organizationId: string, roleId: string, scope: 'organization' | 'subtree' = 'organization') => {
    const [row] = await db(app!).insert(schema.memberships).values({ userId, organizationId, roleId, scope }).returning({ id: schema.memberships.id });
    app!.get(AccessService).invalidate(userId);
    return row!.id;
  };
  async function createOrg(name: string, parent: { id: string; path: string }, type = 'fleet') {
    const id = randomUUID();
    const path = `${parent.path}${id}/`;
    await db(app!).insert(schema.organizations).values({ id, code: `hub-${name.toLowerCase()}-${id.slice(0, 8)}`, name: `My Hub ${name}`, type, parentId: parent.id, path });
    orgPaths.set(id, path);
    return { id, path };
  }
  /** Second facteur d'un membre connecté par code SMS : inscription au premier usage, puis session à double authentification. */
  async function enrollMemberMfa(tokens: TokensView): Promise<{ tokens: TokensView; secret: string; backupCodes: string[] }> {
    const start = await post('/v1/auth/mfa/start', tokens).expect(200);
    expect(start.body.status).toBe('mfa_enrollment_required');
    const enroll = await request(server()).post('/v1/auth/mfa/enroll').send({ mfaToken: start.body.mfaToken }).expect(200);
    const confirm = await request(server()).post('/v1/auth/mfa/confirm').send({ mfaToken: start.body.mfaToken, code: totpCode(enroll.body.secret as string) });
    if (confirm.status !== 200) throw new Error(`Second facteur refusé : ${confirm.status} ${JSON.stringify(confirm.body)}`);
    const { backupCodes, ...session } = confirm.body as TokensView & { backupCodes: string[] };
    return { tokens: session, secret: enroll.body.secret as string, backupCodes };
  }
  const queuedFor = async (template: string, key: string, value: string) =>
    db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.template, template), sql`${schema.notifications.data}->>${key} = ${value}`)).orderBy(desc(schema.notifications.createdAt));
  async function ride(client: TokensView, organizationId: string): Promise<string> {
    const quotes = await post('/v1/quotes', client, { category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    const quote = quotes.body.quotes[0] as { id: string; maxConsentedCents: number };
    const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', `hub-${tag()}`)
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201);
    await db(app!).update(schema.rides).set({ organizationId }).where(eq(schema.rides.id, created.body.id));
    return created.body.id as string;
  }

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    [root] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1) as [{ id: string; path: string }];
    A = await createOrg('A', root);
    B = await createOrg('B', root);
    ownerRoleId = await systemRoleId('org_owner');
    dispatcherRoleId = await systemRoleId('dispatcher');
    memberB = await loginByOtp(app, testPhone(), {}, { card: false });
    await addMembership(memberB.user.id, B.id, await systemRoleId('org_admin'));
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (createdRoles.length) {
        await db(app).delete(schema.memberships).where(inArray(schema.memberships.roleId, createdRoles));
        await db(app).delete(schema.invitations).where(inArray(schema.invitations.roleId, createdRoles));
        await db(app).delete(schema.rolePermissions).where(inArray(schema.rolePermissions.roleId, createdRoles));
        await db(app).delete(schema.roles).where(inArray(schema.roles.id, createdRoles));
      }
      const ids = [...orgPaths.entries()].sort((a, b) => b[1].length - a[1].length).map(([id]) => id);
      if (ids.length) {
        await db(app).delete(schema.supportAccessGrants).where(inArray(schema.supportAccessGrants.organizationId, ids));
        await db(app).delete(schema.organizationFeatures).where(inArray(schema.organizationFeatures.organizationId, ids));
        for (const id of ids) await db(app).delete(schema.organizations).where(eq(schema.organizations.id, id));
      }
    }
    await app?.close();
  });

  it('double authentification d\'un membre connecté par code SMS : proposée pour une permission sensible, sans rôle du personnel', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    const otp = await loginByOtp(app, phone, {}, { card: false });
    const membershipId = await addMembership(otp.user.id, A.id, ownerRoleId);
    const home = await get(`/v1/org/${A.id}`, otp).expect(200);
    expect(home.body).toMatchObject({ mfa: false, supportAccess: null });
    expect(home.body.mfaPermissions).toEqual(expect.arrayContaining(['members.manage', 'roles.manage']));
    expect(home.body.permissions).not.toContain('roles.manage');
    const denied = await post(`/v1/org/${A.id}/roles`, otp, { code: `r_${tag()}`, name: 'Rôle', level: 2, permissions: ['rides.read'] });
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: 'FORBIDDEN_ROLE', details: { required: ['roles.manage'], mfaRequired: true } });

    // Jetons de passage distincts : une route du personnel refuse celui d'un membre.
    const start = await post('/v1/auth/mfa/start', otp).expect(200);
    expect((await request(server()).post('/v1/auth/staff/mfa/enroll').send({ mfaToken: start.body.mfaToken })).body.code).toBe('INVALID_TRANSIENT_TOKEN');
    const enrolled = await enrollMemberMfa(otp);
    expect(enrolled.backupCodes).toHaveLength(10);
    // La session du code SMS seul est remplacée ; la nouvelle porte « mfa » et aucun rôle du personnel.
    expect((await get(`/v1/org/${A.id}`, otp)).status).toBe(401);
    const homeMfa = await get(`/v1/org/${A.id}`, enrolled.tokens).expect(200);
    expect(homeMfa.body).toMatchObject({ mfa: true, mfaPermissions: [] });
    expect(homeMfa.body.permissions).toEqual(expect.arrayContaining(['members.manage', 'roles.manage']));
    const refreshed = await request(server()).post('/v1/auth/refresh').send({ refreshToken: enrolled.tokens.refreshToken }).expect(200);
    expect((await get(`/v1/org/${A.id}`, refreshed.body).expect(200)).body.mfa).toBe(true);
    // Le second facteur du membre est gardé sans mot de passe : jamais de session du personnel par cette voie.
    const [credentials] = await db(app).select({ passwordHash: schema.staffCredentials.passwordHash, enabled: schema.staffCredentials.totpEnabledAt }).from(schema.staffCredentials).where(eq(schema.staffCredentials.userId, otp.user.id));
    expect(credentials!.passwordHash).toBeNull();
    expect(credentials!.enabled).not.toBeNull();

    // Connexion suivante : vérification du code (le même secret), puis code de secours consommé.
    const again = await loginByOtp(app, phone, {}, { card: false });
    const verifyStart = await post('/v1/auth/mfa/start', again).expect(200);
    expect(verifyStart.body.status).toBe('mfa_required');
    const verified = await request(server()).post('/v1/auth/mfa/verify').send({ mfaToken: verifyStart.body.mfaToken, code: totpCode(enrolled.secret, Date.now() + 30_000) }).expect(200);
    expect((await get(`/v1/org/${A.id}`, verified.body).expect(200)).body.mfa).toBe(true);
    const third = await loginByOtp(app, phone, {}, { card: false });
    const backupStart = await post('/v1/auth/mfa/start', third).expect(200);
    await request(server()).post('/v1/auth/mfa/backup').send({ mfaToken: backupStart.body.mfaToken, backupCode: enrolled.backupCodes[0] }).expect(200);
    owner = { phone, userId: otp.user.id, membershipId, tokens: verified.body as TokensView, secret: enrolled.secret };

    // Un membre du personnel connecté par code SMS reprend son TOTP du personnel, sans retrouver ses rôles du personnel.
    const staff = await createStaffAndLogin(app, ['admin']);
    const [staffUser] = await db(app).select({ phone: schema.users.phone }).from(schema.users).where(eq(schema.users.id, staff.userId));
    const staffOtp = await loginByOtp(app, staffUser!.phone, {}, { card: false });
    const staffStart = await post('/v1/auth/mfa/start', staffOtp).expect(200);
    expect(staffStart.body.status).toBe('mfa_required');
    const staffMember = await request(server()).post('/v1/auth/mfa/verify').send({ mfaToken: staffStart.body.mfaToken, code: totpCode(staff.secret, Date.now() + 30_000) }).expect(200);
    expect(staffMember.body.user.roles).not.toContain('admin');
    expect((await get('/v1/admin/api-keys', staffMember.body)).status).toBe(403);
    const staffRefresh = await request(server()).post('/v1/auth/refresh').send({ refreshToken: staffMember.body.refreshToken }).expect(200);
    expect(staffRefresh.body.user.roles).not.toContain('admin');
    await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    // Un membre du personnel sans second facteur l'inscrit par sa connexion du personnel, jamais par le code SMS.
    const newcomerPhone = testPhone();
    const newcomer = await app.get(StaffAuthService).createStaff({ email: testEmail('staff'), phone: newcomerPhone, firstName: 'Test', lastName: 'Nouveau', roles: ['readonly'], password: 'MotDePasse-Test-1234', language: 'fr' });
    trackUser(newcomer.id);
    const newcomerOtp = await loginByOtp(app, newcomerPhone, {}, { card: false });
    expect((await post('/v1/auth/mfa/start', newcomerOtp)).body.code).toBe('MFA_STAFF_ENROLLMENT_REQUIRED');
  });

  it('invitations par texto et par courriel : lien envoyé après la validation, jeton jamais rendu ; liste et révocation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    const bySms = await post(`/v1/org/${A.id}/invitations`, owner.tokens, { roleId: dispatcherRoleId, phone }).expect(201);
    expect(bySms.body).toMatchObject({ channel: 'sms' });
    expect(bySms.body.token).toBeUndefined();
    const [sms] = await queuedFor('organization.invitation', 'invitationId', bySms.body.id as string);
    expect(sms).toMatchObject({ organizationId: A.id, channel: 'sms', recipientAddress: phone });
    expect((sms!.data as { url: string }).url).toMatch(/\/rejoindre\?token=inv_/);
    expect(await app.get(NotificationDeliveryService).deliver(sms!.id)).toBe('sent');
    const delivered = [...app.get<MockSmsProvider>(SMS_PROVIDER).sent].reverse().find((m) => m.to === phone);
    expect(delivered?.body).toMatch(/My Hub A.*\/rejoindre\?token=inv_/s);

    const email = testEmail('invite');
    const byEmail = await post(`/v1/org/${A.id}/invitations`, owner.tokens, { roleId: dispatcherRoleId, email, scope: 'subtree' }).expect(201);
    expect(byEmail.body).toMatchObject({ channel: 'email' });
    const [mail] = await queuedFor('organization.invitation', 'invitationId', byEmail.body.id as string);
    expect(mail).toMatchObject({ organizationId: A.id, channel: 'email', recipientAddress: email });

    const list = await get(`/v1/org/${A.id}/invitations`, owner.tokens).expect(200);
    expect(list.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: bySms.body.id, status: 'pending', phone, roleId: dispatcherRoleId }),
      expect.objectContaining({ id: byEmail.body.id, status: 'pending', email, scope: 'subtree' }),
    ]));
    expect(JSON.stringify(list.body)).not.toContain('inv_');
    expect((await get(`/v1/org/${B.id}/invitations`, memberB).expect(200)).body.map((i: { id: string }) => i.id)).not.toContain(bySms.body.id);

    await request(server()).delete(`/v1/org/${A.id}/invitations/${byEmail.body.id}`).set(bearer(owner.tokens)).expect(204);
    expect((await request(server()).delete(`/v1/org/${A.id}/invitations/${byEmail.body.id}`).set(bearer(owner.tokens))).body.code).toBe('INVITATION_CLOSED');
    expect((await request(server()).delete(`/v1/org/${B.id}/invitations/${bySms.body.id}`).set(bearer(memberB))).status).toBe(404);
    const token = new URL((mail!.data as { url: string }).url).searchParams.get('token')!;
    const stranger = await loginByOtp(app, testPhone(), {}, { card: false });
    expect((await post('/v1/invitations/accept', stranger, { token })).body.code).toBe('INVITATION_NOT_FOUND');
    expect((await get(`/v1/org/${A.id}/invitations`, owner.tokens).expect(200)).body.find((i: { id: string }) => i.id === byEmail.body.id).status).toBe('revoked');
  });

  it('sous-organisations (dans le sous-arbre seulement, modules du parent), tableau de bord, catalogue vu de l\'organisation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const code = `nord-${tag()}`;
    const created = await post(`/v1/org/${A.id}/organizations`, owner.tokens, { code, name: 'Succursale Nord', type: 'sub_org' });
    expect(created.status).toBe(201);
    orgPaths.set(created.body.id, created.body.path);
    expect(created.body).toMatchObject({ parentId: A.id, path: `${A.path}${created.body.id}/`, type: 'sub_org' });
    const tree = await get(`/v1/org/${A.id}/organizations`, owner.tokens).expect(200);
    expect(tree.body.map((o: { id: string }) => o.id)).toEqual([A.id, created.body.id]);
    expect((await post(`/v1/org/${A.id}/organizations`, owner.tokens, { code, name: 'Doublon', type: 'sub_org' })).body.code).toBe('ORGANIZATION_CODE_TAKEN');
    const outside = await post(`/v1/org/${A.id}/organizations`, owner.tokens, { code: `x-${tag()}`, name: 'Ailleurs', type: 'sub_org', parentId: B.id });
    expect(outside.status).toBe(404);
    expect((await get(`/v1/org/${B.id}/organizations`, memberB).expect(200)).body.map((o: { id: string }) => o.id)).toEqual([B.id]);
    const [entry] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, created.body.id), eq(schema.auditLog.action, 'organization.created')));
    expect(entry).toMatchObject({ organizationId: created.body.id, actorUserId: owner.userId });

    // Jamais plus que son parent : une formule restreinte est reprise par la sous-organisation.
    await db(app).insert(schema.organizationFeatures).values([{ organizationId: A.id, module: 'organization', enabled: true }, { organizationId: A.id, module: 'rides', enabled: true }, { organizationId: A.id, module: 'drivers', enabled: false }]);
    app.get(AccessService).invalidate();
    try {
      const limited = await post(`/v1/org/${A.id}/organizations`, owner.tokens, { code: `sud-${tag()}`, name: 'Succursale Sud', type: 'sub_org' }).expect(201);
      orgPaths.set(limited.body.id, limited.body.path);
      const features = await db(app).select({ module: schema.organizationFeatures.module, enabled: schema.organizationFeatures.enabled }).from(schema.organizationFeatures).where(eq(schema.organizationFeatures.organizationId, limited.body.id));
      expect(features.sort((a, b) => a.module.localeCompare(b.module))).toEqual([{ module: 'drivers', enabled: false }, { module: 'organization', enabled: true }, { module: 'rides', enabled: true }]);
    } finally {
      await db(app).delete(schema.organizationFeatures).where(eq(schema.organizationFeatures.organizationId, A.id));
      app.get(AccessService).invalidate();
    }

    const overview = await get(`/v1/org/${A.id}/overview`, owner.tokens).expect(200);
    expect(overview.body).toMatchObject({ subOrganizations: 2, ridesToday: 0, driversActive: 0, statementsPending: { count: 0, netCents: 0 } });
    expect(overview.body.members).toBeGreaterThanOrEqual(1);
    const catalog = await get(`/v1/org/${A.id}/permissions`, owner.tokens).expect(200);
    const codes = catalog.body.map((p: { code: string }) => p.code);
    expect(codes).toContain('roles.manage');
    expect(codes).not.toContain('support.access');
    expect(catalog.body.every((p: { platformOnly: boolean }) => !p.platformOnly)).toBe(true);
    expect(catalog.body.find((p: { code: string }) => p.code === 'roles.manage')).toMatchObject({ sensitive: true, held: true });
  });

  it('accès du support : demande, approbation, accès pendant la durée seulement, refus après révocation et expiration, tout journalisé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const support = await createStaffAndLogin(app, ['admin']);
    const readonly = await createStaffAndLogin(app, ['readonly']);
    const reason = 'Vérifier un relevé contesté par la flotte';
    expect((await post(`/v1/admin/organizations/${A.id}/support-access`, readonly.tokens, { reason })).body.code).toBe('FORBIDDEN_ROLE');
    expect((await post(`/v1/admin/organizations/${root.id}/support-access`, support.tokens, { reason })).body.code).toBe('SUPPORT_ACCESS_NOT_NEEDED');
    const requested = await post(`/v1/admin/organizations/${A.id}/support-access`, support.tokens, { reason, durationMinutes: 30 }).expect(201);
    expect(requested.body).toMatchObject({ organizationId: A.id, status: 'requested', active: false, durationMinutes: 30, requestedByUserId: support.userId });
    const grantId = requested.body.id as string;
    const [alert] = await queuedFor('organization.support_access_requested', 'grantId', grantId);
    expect(alert).toMatchObject({ organizationId: A.id, channel: 'sms', recipientUserId: owner.userId });

    // Avant l'approbation : rien.
    expect((await get(`/v1/org/${A.id}/rides`, support.tokens)).body.code).toBe('NOT_A_MEMBER');
    const pending = await get(`/v1/org/${A.id}/support-access`, owner.tokens).expect(200);
    expect(pending.body.map((g: { id: string }) => g.id)).toContain(grantId);
    expect((await get(`/v1/org/${B.id}/support-access`, memberB).expect(200)).body.map((g: { id: string }) => g.id)).not.toContain(grantId);
    // Une demande d'une autre organisation est introuvable depuis A ; l'administrateur de B n'a pas members.manage.
    const otherGrant = await post(`/v1/admin/organizations/${B.id}/support-access`, support.tokens, { reason }).expect(201);
    expect((await post(`/v1/org/${A.id}/support-access/${otherGrant.body.id}/approve`, owner.tokens)).body.code).toBe('SUPPORT_GRANT_NOT_FOUND');
    expect((await post(`/v1/org/${B.id}/support-access/${otherGrant.body.id}/approve`, memberB)).body.code).toBe('FORBIDDEN_ROLE');

    const approved = await post(`/v1/org/${A.id}/support-access/${grantId}/approve`, owner.tokens).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', active: true, approvedByUserId: owner.userId });
    expect(new Date(approved.body.endsAt).getTime() - new Date(approved.body.startsAt).getTime()).toBe(30 * 60_000);
    expect((await post(`/v1/org/${A.id}/support-access/${grantId}/approve`, owner.tokens)).body.code).toBe('SUPPORT_GRANT_CLOSED');

    // Pendant l'accès : routes de A seulement, permissions de la plateforme limitées à celles d'une organisation cliente.
    await get(`/v1/org/${A.id}/rides`, support.tokens).expect(200);
    const home = await get(`/v1/org/${A.id}`, support.tokens).expect(200);
    expect(home.body.supportAccess).toMatchObject({ grantId, reason });
    expect(home.body.permissions).toContain('members.manage');
    expect(home.body.permissions).not.toContain('support.access');
    expect(home.body.permissions).not.toContain('staff.manage');
    expect((await get(`/v1/org/${B.id}/rides`, support.tokens)).body.code).toBe('NOT_A_MEMBER');
    expect((await post(`/v1/org/${A.id}/support-access/${grantId}/revoke`, support.tokens)).body.code).toBe('SUPPORT_ACCESS_FORBIDDEN');
    expect((await post(`/v1/org/${A.id}/ownership/transfer`, support.tokens, { membershipId: owner.membershipId })).body.code).toBe('OWNER_REQUIRED');
    const used = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, grantId), eq(schema.auditLog.action, 'support_access.used')));
    expect(used.length).toBeGreaterThanOrEqual(4);
    expect(used.every((u) => u.organizationId === A.id && u.actorUserId === support.userId && (u.after as { reason: string }).reason === reason)).toBe(true);
    const platformList = await get(`/v1/admin/support-access?organizationId=${A.id}`, support.tokens).expect(200);
    expect(platformList.body.find((g: { id: string }) => g.id === grantId)).toMatchObject({ active: true, organizationName: 'My Hub A' });

    // Révocation : plus aucun accès, tout de suite.
    const revoked = await post(`/v1/org/${A.id}/support-access/${grantId}/revoke`, owner.tokens).expect(200);
    expect(revoked.body).toMatchObject({ status: 'revoked', active: false });
    expect((await get(`/v1/org/${A.id}/rides`, support.tokens)).body.code).toBe('NOT_A_MEMBER');

    // Expiration : un accès échu ne laisse plus passer, et se lit « expiré ».
    const second = await post(`/v1/admin/organizations/${A.id}/support-access`, support.tokens, { reason, durationMinutes: 15 }).expect(201);
    await post(`/v1/org/${A.id}/support-access/${second.body.id}/approve`, owner.tokens).expect(200);
    await get(`/v1/org/${A.id}/drivers`, support.tokens).expect(200);
    await db(app).update(schema.supportAccessGrants).set({ startsAt: new Date(Date.now() - 20 * 60_000), endsAt: new Date(Date.now() - 5 * 60_000) }).where(eq(schema.supportAccessGrants.id, second.body.id));
    expect((await get(`/v1/org/${A.id}/drivers`, support.tokens)).body.code).toBe('NOT_A_MEMBER');
    expect((await get(`/v1/org/${A.id}/support-access`, owner.tokens).expect(200)).body.find((g: { id: string }) => g.id === second.body.id).status).toBe('expired');

    // Fin anticipée par le demandeur seulement.
    const third = await post(`/v1/admin/organizations/${A.id}/support-access`, support.tokens, { reason }).expect(201);
    const other = await createStaffAndLogin(app, ['admin']);
    expect((await post(`/v1/admin/support-access/${third.body.id}/end`, other.tokens)).body.code).toBe('SUPPORT_GRANT_NOT_YOURS');
    expect((await post(`/v1/admin/support-access/${third.body.id}/end`, support.tokens).expect(200)).body.status).toBe('revoked');

    // Journal de l'organisation : demandes, décisions et chaque usage.
    const audit = await get(`/v1/org/${A.id}/audit?entity=support_access_grants&limit=200`, owner.tokens).expect(200);
    const actions = audit.body.items.map((i: { action: string }) => i.action);
    expect(actions).toEqual(expect.arrayContaining(['support_access.requested', 'support_access.approved', 'support_access.used', 'support_access.revoked', 'support_access.ended']));
    expect(audit.body.items.every((i: { organizationId: string }) => i.organizationId === A.id)).toBe(true);
  });

  it('dernier propriétaire : ni suspendu, ni retiré, ni changé de rôle (409 LAST_OWNER) ; transfert de propriété journalisé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const path = (id: string) => `/v1/org/${A.id}/memberships/${id}`;
    expect((await request(server()).patch(path(owner.membershipId)).set(bearer(owner.tokens)).send({ status: 'suspended' })).body.code).toBe('LAST_OWNER');
    expect((await request(server()).patch(path(owner.membershipId)).set(bearer(owner.tokens)).send({ roleId: dispatcherRoleId })).body.code).toBe('LAST_OWNER');
    expect((await request(server()).delete(path(owner.membershipId)).set(bearer(owner.tokens))).body.code).toBe('LAST_OWNER');
    // La plateforme est tenue à la même règle.
    const admin = await createStaffAndLogin(app, ['admin']);
    expect((await request(server()).delete(`/v1/admin/memberships/${owner.membershipId}`).set(bearer(admin.tokens))).body.code).toBe('LAST_OWNER');

    const successor = await loginByOtp(app, testPhone(), {}, { card: false });
    const successorMembership = await addMembership(successor.user.id, A.id, dispatcherRoleId);
    expect((await post(`/v1/org/${A.id}/ownership/transfer`, owner.tokens, { membershipId: owner.membershipId })).body.code).toBe('ALREADY_OWNER');
    const transferred = await post(`/v1/org/${A.id}/ownership/transfer`, owner.tokens, { membershipId: successorMembership }).expect(200);
    expect(transferred.body).toMatchObject({ id: successorMembership, roleCode: 'org_owner' });
    const members = await get(`/v1/org/${A.id}/members`, successor).expect(200);
    expect(members.body.find((m: { id: string }) => m.id === owner.membershipId)).toMatchObject({ roleCode: 'org_admin' });
    // L'ancien propriétaire, désormais administrateur, ne gère plus les membres.
    expect((await post(`/v1/org/${A.id}/ownership/transfer`, owner.tokens, { membershipId: owner.membershipId })).body.code).toBe('FORBIDDEN_ROLE');
    const [entry] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, successorMembership), eq(schema.auditLog.action, 'organization.ownership_transferred')));
    expect(entry).toMatchObject({ organizationId: A.id, actorUserId: owner.userId });
    // Le nouveau propriétaire est à son tour le dernier : la plateforme ne peut pas le retirer.
    expect((await request(server()).delete(`/v1/admin/memberships/${successorMembership}`).set(bearer(admin.tokens))).body.code).toBe('LAST_OWNER');
    // L'ancien propriétaire peut maintenant être retiré.
    await request(server()).delete(`/v1/admin/memberships/${owner.membershipId}`).set(bearer(admin.tokens)).expect(204);
  });

  it('parcours du critère : un administrateur N1 crée une sous-organisation, un rôle limité et invite un agent, qui ne voit que ce que son rôle permet', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const company = await createOrg('Compagnie', root, 'taxi_company');
    const admin = await loginByOtp(app, testPhone(), {}, { card: false });
    await addMembership(admin.user.id, company.id, ownerRoleId, 'subtree');

    // Connexion par code SMS : le sélecteur d'organisation, puis la fiche (double authentification proposée).
    expect((await get('/v1/me/organizations', admin).expect(200)).body.map((m: { organizationId: string }) => m.organizationId)).toEqual([company.id]);
    expect((await get(`/v1/org/${company.id}`, admin).expect(200)).body.mfaPermissions).toContain('roles.manage');

    // 1. Sous-organisation.
    const sub = await post(`/v1/org/${company.id}/organizations`, admin, { code: `laval-${tag()}`, name: 'Succursale Laval', type: 'sub_org' }).expect(201);
    orgPaths.set(sub.body.id, sub.body.path);

    // 2. Rôle limité : la double authentification est demandée, puis le rôle est créé dans la sous-organisation.
    const role = { code: `repartiteur_lecture_${tag()}`, name: 'Répartiteur lecture seule', level: 2, permissions: ['dashboard.read', 'rides.read', 'drivers.read', 'vehicles.read'] };
    expect((await post(`/v1/org/${sub.body.id}/roles`, admin, role)).body.details).toMatchObject({ mfaRequired: true });
    const { tokens: adminMfa } = await enrollMemberMfa(admin);
    const createdRole = await post(`/v1/org/${sub.body.id}/roles`, adminMfa, role).expect(201);
    createdRoles.push(createdRole.body.id);
    expect(createdRole.body).toMatchObject({ organizationId: sub.body.id, permissions: [...role.permissions].sort() });

    // 3. Invitation d'un agent par texto ; le lien arrive par le fournisseur de textos.
    const agentPhone = testPhone();
    const invitation = await post(`/v1/org/${sub.body.id}/invitations`, adminMfa, { roleId: createdRole.body.id, phone: agentPhone }).expect(201);
    expect(invitation.body.token).toBeUndefined();
    const [queued] = await queuedFor('organization.invitation', 'invitationId', invitation.body.id as string);
    expect(await app.get(NotificationDeliveryService).deliver(queued!.id)).toBe('sent');
    const sms = [...app.get<MockSmsProvider>(SMS_PROVIDER).sent].reverse().find((m) => m.to === agentPhone);
    const token = decodeURIComponent(/\/rejoindre\?token=([^\s]+)/.exec(sms!.body)![1]!);

    // 4. L'agent se connecte par code SMS et accepte.
    const agent = await loginByOtp(app, agentPhone, {}, { card: false });
    const accepted = await post('/v1/invitations/accept', agent, { token }).expect(200);
    expect(accepted.body).toMatchObject({ organizationId: sub.body.id, roleId: createdRole.body.id, status: 'active' });
    expect((await get('/v1/me/organizations', agent).expect(200)).body.map((m: { organizationId: string }) => m.organizationId)).toEqual([sub.body.id]);
    expect((await get(`/v1/org/${sub.body.id}`, agent).expect(200)).body.permissions).toEqual([...role.permissions].sort());

    // 5. Il ne voit que ce que son rôle permet, dans sa sous-organisation seulement.
    const client = await loginByOtp(app, testPhone(), {}, { card: false });
    const subRide = await ride(client, sub.body.id);
    const companyRide = await ride(client, company.id);
    expect((await get(`/v1/org/${sub.body.id}/rides?view=recent`, agent).expect(200)).body.items.map((r: { id: string }) => r.id)).toEqual([subRide]);
    await get(`/v1/org/${sub.body.id}/overview`, agent).expect(200);
    expect((await get(`/v1/org/${sub.body.id}/members`, agent)).body.code).toBe('FORBIDDEN_ROLE');
    expect((await post(`/v1/org/${sub.body.id}/invitations`, agent, { roleId: createdRole.body.id, phone: testPhone() })).body.code).toBe('FORBIDDEN_ROLE');
    expect((await get(`/v1/org/${sub.body.id}/audit`, agent)).body.code).toBe('FORBIDDEN_ROLE');
    expect((await get(`/v1/org/${company.id}/rides`, agent)).body.code).toBe('NOT_A_MEMBER');
    // L'administrateur N1 voit tout son sous-arbre.
    const all = (await get(`/v1/org/${company.id}/rides?view=recent`, adminMfa).expect(200)).body.items.map((r: { id: string }) => r.id);
    expect(all.sort()).toEqual([subRide, companyRide].sort());
    const journal = (await get(`/v1/org/${company.id}/audit?limit=200`, adminMfa).expect(200)).body.items.map((i: { action: string }) => i.action);
    expect(journal).toEqual(expect.arrayContaining(['organization.created', 'role.created', 'invitation.created', 'invitation.accepted']));
  });
});
