import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totpCode } from '../src/common/crypto.js';
import { bearer, cleanupTestData, createStaffAndLogin, loginByOtp, startTestApp, testEmail, testPhone, trackUser } from './helpers.js';
import { StaffAuthService } from '../src/modules/auth/staff-auth.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

describe('personnel de My Hub : mot de passe, second facteur obligatoire, verrouillage (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('impose l\'inscription du second facteur à la première connexion et donne les rôles du personnel', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const staff = await createStaffAndLogin(app, ['admin']);
    expect(staff.backupCodes).toHaveLength(10);
    expect(staff.backupCodes[0]).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(staff.tokens.user.roles).toContain('admin');
    expect(staff.tokens.user.mfaEnabled).toBe(true);
    await request(server()).get('/v1/admin/api-keys').set(bearer(staff.tokens)).expect(200);

    // Deuxième connexion : le second facteur est demandé, un code ne sert qu'une fois.
    const login = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    expect(login.body.status).toBe('mfa_required');
    const code = totpCode(staff.secret);
    const verified = await request(server()).post('/v1/auth/staff/mfa/verify').send({ mfaToken: login.body.mfaToken, code }).expect(200);
    expect(verified.body.user.roles).toContain('admin');
    const login2 = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    const replay = await request(server()).post('/v1/auth/staff/mfa/verify').send({ mfaToken: login2.body.mfaToken, code });
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('MFA_CODE_INVALID');

    // Code de secours : accepté une fois.
    const login3 = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    await request(server()).post('/v1/auth/staff/mfa/backup').send({ mfaToken: login3.body.mfaToken, backupCode: staff.backupCodes[0] }).expect(200);
    const login4 = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    const reused = await request(server()).post('/v1/auth/staff/mfa/backup').send({ mfaToken: login4.body.mfaToken, backupCode: staff.backupCodes[0] });
    expect(reused.status).toBe(400);

    // Le rafraîchissement conserve les rôles du personnel (session ouverte avec second facteur).
    const refreshed = await request(server()).post('/v1/auth/refresh').send({ refreshToken: verified.body.refreshToken }).expect(200);
    expect(refreshed.body.user.roles).toContain('admin');
    await request(server()).get('/v1/admin/api-keys').set(bearer(refreshed.body)).expect(200);
  });

  it('un membre du personnel connecté par code SMS n\'a pas ses rôles du personnel', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const staff = await createStaffAndLogin(app, ['operator']);
    const user = await app.get(UsersService).findById(staff.userId);
    const byOtp = await loginByOtp(app, user!.phone);
    expect(byOtp.user.roles).not.toContain('operator');
    const forbidden = await request(server()).get('/v1/admin/audit').set(bearer(byOtp));
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe('FORBIDDEN_ROLE');
    const refreshed = await request(server()).post('/v1/auth/refresh').send({ refreshToken: byOtp.refreshToken }).expect(200);
    expect(refreshed.body.user.roles).not.toContain('operator');
  });

  it('verrouille le compte après cinq mots de passe faux et ne révèle pas les courriels inconnus', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const staff = await createStaffAndLogin(app, ['finance']);
    for (let i = 0; i < 5; i += 1) {
      const res = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: 'faux-mot-de-passe' });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    expect(locked.body.details.retryAfter).toBeGreaterThan(0);
    const unknown = await request(server()).post('/v1/auth/staff/login').send({ email: testEmail('inconnu'), password: 'quelconque-123' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
    // Un client (sans identifiants du personnel) ne peut pas se connecter par mot de passe.
    const client = await loginByOtp(app);
    await request(server()).patch('/v1/me').set(bearer(client)).send({ email: testEmail('client') }).expect(200);
    const me = await request(server()).get('/v1/me').set(bearer(client)).expect(200);
    const asStaff = await request(server()).post('/v1/auth/staff/login').send({ email: me.body.email, password: 'MotDePasse-Test-1234' });
    expect(asStaff.status).toBe(401);
  });

  it('verrouille aussi le second facteur après cinq codes faux', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const staff = await createStaffAndLogin(app, ['operator']);
    const login = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    for (let i = 0; i < 5; i += 1) {
      const res = await request(server()).post('/v1/auth/staff/mfa/verify').send({ mfaToken: login.body.mfaToken, code: '000000' });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('MFA_CODE_INVALID');
    }
    const locked = await request(server()).post('/v1/auth/staff/mfa/verify').send({ mfaToken: login.body.mfaToken, code: totpCode(staff.secret) });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    // Un mot de passe correct ne déverrouille pas non plus.
    const again = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password });
    expect(again.status).toBe(423);
  });

  it('des codes faux envoyés en parallèle comptent chacun et verrouillent le compte', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Revue 17.B : le compteur d'échecs était recalculé depuis une ligne lue plus tôt ; huit essais simultanés n'en
    // comptaient qu'un et le verrouillage ne se déclenchait pas (second facteur devinable par lots).
    const staff = await createStaffAndLogin(app, ['operator']);
    const login = await request(server()).post('/v1/auth/staff/login').send({ email: staff.email, password: staff.password }).expect(200);
    const wrong = totpCode(staff.secret) === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 8 }, () => request(server()).post('/v1/auth/staff/mfa/verify').send({ mfaToken: login.body.mfaToken, code: wrong })));
    const locked = await request(server()).post('/v1/auth/staff/mfa/verify').send({ mfaToken: login.body.mfaToken, code: totpCode(staff.secret) });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('rôles : readonly lit, n\'écrit pas ; admin administre le personnel', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const readonly = await createStaffAndLogin(app, ['readonly']);
    await request(server()).get('/v1/admin/audit').set(bearer(readonly.tokens)).expect(200);
    const write = await request(server()).post('/v1/admin/api-keys').set(bearer(readonly.tokens)).send({ name: 'test', scopes: ['agents:read'] });
    expect(write.status).toBe(403);

    const admin = await createStaffAndLogin(app, ['admin']);
    const created = await request(server())
      .post('/v1/admin/staff')
      .set(bearer(admin.tokens))
      .send({ phone: testPhone(), email: testEmail('ops'), firstName: 'Ops', lastName: 'Test', roles: ['operator'], password: 'Un-autre-mot-de-passe-1' })
      .expect(201);
    expect(created.body.roles).toEqual(['operator']);
    trackUser(created.body.id);
    await request(server()).post(`/v1/admin/staff/${created.body.id}/password`).set(bearer(admin.tokens)).send({ password: 'Nouveau-mot-de-passe-123' }).expect(204);
    const login = await request(server()).post('/v1/auth/staff/login').send({ email: created.body.email, password: 'Nouveau-mot-de-passe-123' }).expect(200);
    expect(login.body.status).toBe('mfa_enrollment_required');
    await request(server()).post(`/v1/admin/staff/${created.body.id}/mfa/reset`).set(bearer(admin.tokens)).expect(204);
    // Même courriel : le compte existant est mis à jour (rôle ajouté, mot de passe remplacé), pas dupliqué.
    const updated = await request(server())
      .post('/v1/admin/staff')
      .set(bearer(admin.tokens))
      .send({ phone: testPhone(), email: created.body.email, firstName: 'Ops', lastName: 'Test', roles: ['finance'], password: 'Encore-un-autre-mot-de-passe-1' })
      .expect(201);
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.roles).toEqual(expect.arrayContaining(['operator', 'finance']));
    // Courriel d'un compte et téléphone d'un autre : refusé.
    const readonlyUser = await app.get(UsersService).findById(readonly.userId);
    const conflict = await request(server())
      .post('/v1/admin/staff')
      .set(bearer(admin.tokens))
      .send({ phone: readonlyUser!.phone, email: created.body.email, firstName: 'Ops', lastName: 'Test', roles: ['operator'], password: 'Un-autre-mot-de-passe-1' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.code).toBe('EMAIL_TAKEN');
    expect(app.get(StaffAuthService)).toBeDefined();
  });
});
