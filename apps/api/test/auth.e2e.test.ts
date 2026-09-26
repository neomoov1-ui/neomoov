import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, cleanupTestData, currentPolicyVersion, db, lastOtpCode, loginByOtp, requestOtp, resetIpLimits, startTestApp, testPhone } from './helpers.js';

describe('authentification par code SMS, Apple, Google, jetons (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('un client crée son compte et obtient ses jetons en moins de 60 secondes', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const startedAt = Date.now();
    const phone = testPhone();
    const tokens = await loginByOtp(app, phone, { device: { platform: 'ios', pushToken: 'ExponentPushToken[test-abcdef]', appVersion: '1.0.0' } });
    expect(Date.now() - startedAt).toBeLessThan(60_000);
    expect(tokens.created).toBe(true);
    expect(tokens.tokenType).toBe('Bearer');
    expect(tokens.expiresIn).toBe(900);
    expect(tokens.refreshToken).toMatch(/^rt_/);
    expect(tokens.user.phone).toBe(phone);
    expect(tokens.user.roles).toEqual(['client']);
    expect(tokens.user.privacyPolicyAccepted).toBe(true);
    const me = await request(server()).get('/v1/me').set(bearer(tokens)).expect(200);
    expect(me.body.id).toBe(tokens.user.id);
    const devices = await request(server()).get('/v1/me/devices').set(bearer(tokens)).expect(200);
    expect(devices.body).toHaveLength(1);
    expect(devices.body[0].platform).toBe('ios');
    const [client] = await db(app).select().from(schema.clients).where(eq(schema.clients.userId, tokens.user.id));
    expect(client).toBeDefined();
  });

  it('refuse la création sans acceptation des conditions ou avec une politique périmée, puis reconnecte un compte existant', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    let code = await requestOtp(app, phone);
    const noTerms = await request(server()).post('/v1/auth/otp/verify').send({ phone, code, privacyPolicyVersion: await currentPolicyVersion(app) });
    expect(noTerms.status).toBe(400);
    expect(noTerms.body.code).toBe('TERMS_NOT_ACCEPTED');
    // Le code est consommé par la vérification réussie du chiffre, même si la création a été refusée : nouveau code.
    code = await requestOtp(app, phone);
    const outdated = await request(server()).post('/v1/auth/otp/verify').send({ phone, code, acceptTerms: true, privacyPolicyVersion: '0.1' });
    expect(outdated.status).toBe(400);
    expect(outdated.body.code).toBe('PRIVACY_POLICY_VERSION_OUTDATED');
    expect(outdated.body.details.currentVersion).toBe(await currentPolicyVersion(app));
    const created = await loginByOtp(app, phone);
    expect(created.created).toBe(true);
    const again = await loginByOtp(app, phone);
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(created.user.id);
  });

  it('limite les codes : délai entre deux envois, cinq tentatives, code expiré ensuite', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    await requestOtp(app, phone);
    const tooSoon = await request(server()).post('/v1/auth/otp/request').send({ phone });
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.code).toBe('OTP_TOO_SOON');
    expect(tooSoon.body.details.retryAfter).toBeGreaterThan(0);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const res = await request(server()).post('/v1/auth/otp/verify').send({ phone, code: '000000', acceptTerms: true });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
      expect(res.body.details.attemptsLeft).toBe(5 - attempt);
    }
    const fifth = await request(server()).post('/v1/auth/otp/verify').send({ phone, code: '000000', acceptTerms: true });
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_LOCKED');
    const realCode = lastOtpCode(app, phone);
    const locked = await request(server()).post('/v1/auth/otp/verify').send({ phone, code: realCode, acceptTerms: true });
    expect(locked.status).toBe(400);
    expect(locked.body.code).toBe('OTP_EXPIRED');
    const invalidPhone = await request(server()).post('/v1/auth/otp/request').send({ phone: '5145550142' });
    expect(invalidPhone.status).toBe(400);
    expect(invalidPhone.body.code).toBe('VALIDATION_ERROR');
  });

  it("des vérifications simultanées ne contournent ni les cinq tentatives ni l'usage unique du code", async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Revue 17.B : le compteur de tentatives était lu puis réécrit (attempts = n + 1), donc des essais en parallèle
    // n'en comptaient qu'un ; et un bon code était consommé sans condition, donc rejouable en parallèle.
    const phone = testPhone();
    const code = await requestOtp(app, phone);
    const wrong = code === '000000' ? '111111' : '000000';
    const guesses = await Promise.all(Array.from({ length: 12 }, () => request(server()).post('/v1/auth/otp/verify').send({ phone, code: wrong, acceptTerms: true })));
    expect(guesses.filter((r) => r.body.code === 'OTP_INVALID').length).toBeLessThanOrEqual(4);
    const [row] = await db(app).select({ attempts: schema.otpCodes.attempts, consumedAt: schema.otpCodes.consumedAt }).from(schema.otpCodes).where(eq(schema.otpCodes.phone, phone)).orderBy(desc(schema.otpCodes.createdAt)).limit(1);
    expect(row!.attempts).toBeGreaterThanOrEqual(5);
    expect(row!.consumedAt).not.toBeNull();
    const late = await request(server()).post('/v1/auth/otp/verify').send({ phone, code, acceptTerms: true, privacyPolicyVersion: await currentPolicyVersion(app) });
    expect(late.body.code).toBe('OTP_EXPIRED');

    const existing = testPhone();
    await loginByOtp(app, existing);
    const again = await requestOtp(app, existing);
    const both = await Promise.all([1, 2].map(() => request(server()).post('/v1/auth/otp/verify').send({ phone: existing, code: again })));
    expect(both.filter((r) => r.status === 200)).toHaveLength(1);
    expect(both.find((r) => r.status !== 200)?.body.code).toBe('OTP_EXPIRED');
  });

  it('fait tourner le jeton de rafraîchissement et révoque la famille si un jeton est réutilisé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const first = await loginByOtp(app);
    const second = await request(server()).post('/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    expect(second.body.accessToken).not.toBe(first.accessToken);
    // L'ancien jeton d'accès est révoqué avec sa session.
    const oldAccess = await request(server()).get('/v1/me').set(bearer(first));
    expect(oldAccess.status).toBe(401);
    expect(oldAccess.body.code).toBe('SESSION_REVOKED');
    await request(server()).get('/v1/me').set(bearer(second.body)).expect(200);
    // Réutilisation du premier jeton (volé) : toute la famille tombe, y compris le jeton légitime.
    const reused = await request(server()).post('/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('REFRESH_TOKEN_REUSED');
    const legit = await request(server()).post('/v1/auth/refresh').send({ refreshToken: second.body.refreshToken });
    expect(legit.status).toBe(401);
    const revokedAccess = await request(server()).get('/v1/me').set(bearer(second.body));
    expect(revokedAccess.status).toBe(401);
    const sessions = await db(app).select().from(schema.sessions).where(eq(schema.sessions.userId, first.user.id));
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
    const unknown = await request(server()).post('/v1/auth/refresh').send({ refreshToken: 'rt_inconnu_inconnu_inconnu_inconnu' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('déconnecte : la session courante, ou toutes', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    const a = await loginByOtp(app, phone);
    const b = await loginByOtp(app, phone);
    await request(server()).post('/v1/auth/logout').set(bearer(a)).send({ refreshToken: a.refreshToken }).expect(204);
    expect((await request(server()).get('/v1/me').set(bearer(a))).status).toBe(401);
    await request(server()).get('/v1/me').set(bearer(b)).expect(200);
    expect((await request(server()).post('/v1/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(401);
    const c = await loginByOtp(app, phone);
    await request(server()).post('/v1/auth/logout').set(bearer(c)).send({ allDevices: true }).expect(204);
    expect((await request(server()).get('/v1/me').set(bearer(b))).status).toBe(401);
    expect((await request(server()).post('/v1/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(401);
  });

  it('refuse un compte bloqué', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const phone = testPhone();
    const tokens = await loginByOtp(app, phone);
    await db(app).update(schema.users).set({ status: 'blocked' }).where(eq(schema.users.id, tokens.user.id));
    const code = await requestOtp(app, phone);
    const res = await request(server()).post('/v1/auth/otp/verify').send({ phone, code });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_BLOCKED');
  });

  it('connexion Apple et Google : liaison à un téléphone vérifié, puis connexion directe', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const subject = `apple-${Math.random().toString(36).slice(2, 10)}`;
    const email = `${subject}@privaterelay.appleid.com`;
    const first = await request(server()).post('/v1/auth/apple').send({ identityToken: `mock-apple:${subject}:${email}` }).expect(200);
    expect(first.body.status).toBe('phone_required');
    expect(first.body.email).toBe(email);
    const phone = testPhone();
    const tokens = await loginByOtp(app, phone, { linkToken: first.body.linkToken });
    expect(tokens.created).toBe(true);
    expect(tokens.user.linkedProviders).toEqual(['apple']);
    expect(tokens.user.email).toBe(email);
    const direct = await request(server()).post('/v1/auth/apple').send({ identityToken: `mock-apple:${subject}:${email}` }).expect(200);
    expect(direct.body.tokenType).toBe('Bearer');
    expect(direct.body.user.id).toBe(tokens.user.id);
    // Google sur le même compte, lié depuis une session existante par code SMS.
    const googleSubject = `google-${Math.random().toString(36).slice(2, 10)}`;
    const google = await request(server()).post('/v1/auth/google').send({ identityToken: `mock-google:${googleSubject}` }).expect(200);
    expect(google.body.status).toBe('phone_required');
    const linked = await loginByOtp(app, phone, { linkToken: google.body.linkToken });
    expect(linked.user.linkedProviders).toEqual(['apple', 'google']);
    // Un identifiant Google déjà lié ne peut pas être rattaché à un second compte.
    const other = await request(server()).post('/v1/auth/google').send({ identityToken: `mock-google:${googleSubject}` }).expect(200);
    expect(other.body.user.id).toBe(tokens.user.id);
    const bad = await request(server()).post('/v1/auth/apple').send({ identityToken: 'pas-un-jeton-valide-du-tout' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_IDENTITY_TOKEN');
    await resetIpLimits(app);
  });

  it('renvoie les erreurs au format unique avec identifiant de corrélation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(server()).get('/v1/me').set('x-correlation-id', 'corr-auth-test-01');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED', correlationId: 'corr-auth-test-01' });
    expect(typeof res.body.message).toBe('string');
  });
});
