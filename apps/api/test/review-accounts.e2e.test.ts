import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockSmsProvider } from '../src/adapters/mock/index.js';
import { SMS_PROVIDER } from '../src/adapters/types.js';
import { loadEnv } from '../src/config/env.js';
import { cleanupTestData, currentPolicyVersion, resetIpLimits, startTestApp, testPhone, trackUser } from './helpers.js';

/** Comptes d'examen des magasins (Apple, Google) : code fixe pour les numéros déclarés, aucun texto ; les autres numéros inchangés. */
describe('comptes d\'examen des magasins', () => {
  const reviewPhone = testPhone();
  let app: NestExpressApplication | null = null;

  beforeAll(async () => {
    app = await startTestApp({ REVIEW_PHONES: `+15145550199, ${reviewPhone}`, REVIEW_OTP_CODE: '482915' });
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('configuration : code obligatoire, six chiffres, pas trivial, numéros au format E.164', () => {
    const base = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://x' };
    expect(() => loadEnv({ ...base, REVIEW_PHONES: '+15145550199' }, { dotenv: false })).toThrow(/REVIEW_OTP_CODE/);
    expect(() => loadEnv({ ...base, REVIEW_PHONES: '+15145550199', REVIEW_OTP_CODE: '111111' }, { dotenv: false })).toThrow(/deviner/);
    expect(() => loadEnv({ ...base, REVIEW_PHONES: '5145550199', REVIEW_OTP_CODE: '482915' }, { dotenv: false })).toThrow(/E\.164/);
    expect(loadEnv({ ...base, REVIEW_PHONES: '+15145550199', REVIEW_OTP_CODE: '482915' }, { dotenv: false }).REVIEW_OTP_CODE).toBe('482915');
  });

  it('numéro déclaré : aucun texto, connexion avec le code fixe ; autre numéro : texto habituel, code fixe refusé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
    await resetIpLimits(app);
    await request(server).post('/v1/auth/otp/request').send({ phone: reviewPhone }).expect(200);
    expect(sms.sent.filter((m) => m.to === reviewPhone)).toHaveLength(0);
    const ok = await request(server).post('/v1/auth/otp/verify').send({ phone: reviewPhone, code: '482915', acceptTerms: true, privacyPolicyVersion: await currentPolicyVersion(app) }).expect(200);
    trackUser(ok.body.user.id);

    const other = testPhone();
    await request(server).post('/v1/auth/otp/request').send({ phone: other }).expect(200);
    expect(sms.sent.filter((m) => m.to === other)).toHaveLength(1);
    const refused = await request(server).post('/v1/auth/otp/verify').send({ phone: other, code: '482915', acceptTerms: true, privacyPolicyVersion: await currentPolicyVersion(app) });
    expect(refused.status).toBe(400);
  });
});
