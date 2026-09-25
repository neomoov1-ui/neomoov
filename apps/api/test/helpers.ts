import { schema } from '@neomoov/db';
import type { StaffRole, TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray, sql } from 'drizzle-orm';
import { pino } from 'pino';
import request from 'supertest';
import type { MockSmsProvider } from '../src/adapters/mock/index.js';
import { SMS_PROVIDER } from '../src/adapters/types.js';
import { createApp } from '../src/bootstrap.js';
import { totpCode } from '../src/common/crypto.js';
import { RateLimitService } from '../src/common/rate-limit.service.js';
import { loadDotenvFromRoot, loadEnv, type AppEnv } from '../src/config/env.js';
import { DB, type Database } from '../src/infra/db.module.js';
import { StaffAuthService } from '../src/modules/auth/staff-auth.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

/** Configuration de test : le .env de la racine (base Supabase de développement), fournisseurs simulés, sans Redis. */
export function testEnv(overrides: Record<string, string> = {}): AppEnv | null {
  loadDotenvFromRoot();
  const databaseUrl = process.env['TEST_DATABASE_URL'] || process.env['DATABASE_URL'];
  if (!databaseUrl) return null;
  return loadEnv(
    {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: '',
      PAYMENT_PROVIDER: 'mock', MAPS_PROVIDER: 'mock', SMS_PROVIDER: 'mock', EMAIL_PROVIDER: 'mock', PUSH_PROVIDER: 'mock',
      WHATSAPP_PROVIDER: 'mock', VOICE_PROVIDER: 'mock', LLM_PROVIDER: 'mock', SEV_PROVIDER: 'mock', STORAGE_PROVIDER: 'mock', SOCIAL_LOGIN_PROVIDER: 'mock',
      ...overrides,
    },
    { dotenv: false },
  );
}

export async function startTestApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication | null> {
  const env = testEnv(overrides);
  if (!env) return null;
  const app = await createApp(env, pino({ level: 'silent' }));
  await app.init();
  return app;
}

/** Données de test reconnaissables : téléphones +1999…, courriels @test.neomoov.local. */
export const TEST_PHONE_PREFIX = '+1999';
export const TEST_EMAIL_DOMAIN = 'test.neomoov.local';

export function testPhone(): string {
  return `${TEST_PHONE_PREFIX}${Math.floor(Math.random() * 1e7).toString().padStart(7, '0')}`;
}

export function testEmail(prefix = 'user'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@${TEST_EMAIL_DOMAIN}`;
}

export function db(app: NestExpressApplication): Database['db'] {
  return app.get<Database>(DB).db;
}

/** Dernier code SMS envoyé à ce numéro par le fournisseur simulé. */
export function lastOtpCode(app: NestExpressApplication, phone: string): string {
  const sms = app.get<MockSmsProvider>(SMS_PROVIDER);
  const message = [...sms.sent].reverse().find((m) => m.to === phone);
  const match = /\b(\d{6})\b/.exec(message?.body ?? '');
  if (!match) throw new Error(`Aucun code SMS pour ${phone}`);
  return match[1]!;
}

/** Les tests demandent beaucoup de codes depuis la même adresse : la limite par adresse est remise à zéro avant chaque demande. */
export async function resetIpLimits(app: NestExpressApplication): Promise<void> {
  const limits = app.get(RateLimitService);
  await Promise.all(['127.0.0.1', '::1', '1'].map((ip) => limits.reset(`otp:ip:${ip}`)));
}

export async function currentPolicyVersion(app: NestExpressApplication): Promise<string> {
  return app.get(UsersService).currentPrivacyPolicyVersion();
}

/** Comptes et numéros créés par ce fichier de test (chaque fichier a son processus) : seuls ceux-là sont retirés à la fin. */
const createdUserIds = new Set<string>();
const usedPhones = new Set<string>();
export function trackUser(id: string): void {
  createdUserIds.add(id);
}

/** Demande un code pour ce numéro ; le délai entre deux envois et la limite par numéro sont neutralisés pour le test. */
export async function requestOtp(app: NestExpressApplication, phone: string): Promise<string> {
  usedPhones.add(phone);
  await resetIpLimits(app);
  await app.get(RateLimitService).reset(`otp:phone:${phone}`);
  await db(app).update(schema.otpCodes).set({ createdAt: sql`created_at - interval '5 minutes'` }).where(eq(schema.otpCodes.phone, phone));
  await request(app.getHttpServer()).post('/v1/auth/otp/request').send({ phone }).expect(200);
  return lastOtpCode(app, phone);
}

/** Inscription ou connexion complète par code SMS. */
export async function loginByOtp(app: NestExpressApplication, phone = testPhone(), extra: Record<string, unknown> = {}): Promise<TokensView> {
  const code = await requestOtp(app, phone);
  const res = await request(app.getHttpServer())
    .post('/v1/auth/otp/verify')
    .send({ phone, code, acceptTerms: true, privacyPolicyVersion: await currentPolicyVersion(app), ...extra });
  if (res.status !== 200) throw new Error(`Connexion par code refusée : ${res.status} ${JSON.stringify(res.body)}`);
  const tokens = res.body as TokensView;
  trackUser(tokens.user.id);
  return tokens;
}

export interface StaffSession {
  tokens: TokensView;
  backupCodes: string[];
  secret: string;
  email: string;
  password: string;
  userId: string;
}

/** Crée un membre du personnel, fait sa première connexion (inscription du second facteur) et renvoie sa session. */
export async function createStaffAndLogin(app: NestExpressApplication, roles: StaffRole[] = ['admin']): Promise<StaffSession> {
  const server = app.getHttpServer();
  const email = testEmail('staff');
  const password = 'MotDePasse-Test-1234';
  const user = await app.get(StaffAuthService).createStaff({ email, phone: testPhone(), firstName: 'Test', lastName: 'Personnel', roles, password, language: 'fr' });
  trackUser(user.id);
  const login = await request(server).post('/v1/auth/staff/login').send({ email, password });
  if (login.status !== 200 || login.body.status !== 'mfa_enrollment_required') throw new Error(`Connexion du personnel inattendue : ${login.status} ${JSON.stringify(login.body)}`);
  const enroll = await request(server).post('/v1/auth/staff/mfa/enroll').send({ mfaToken: login.body.mfaToken }).expect(200);
  const confirm = await request(server).post('/v1/auth/staff/mfa/confirm').send({ mfaToken: login.body.mfaToken, code: totpCode(enroll.body.secret) });
  if (confirm.status !== 200) throw new Error(`Confirmation du second facteur refusée : ${confirm.status} ${JSON.stringify(confirm.body)}`);
  const { backupCodes, ...tokens } = confirm.body as TokensView & { backupCodes: string[] };
  return { tokens, backupCodes, secret: enroll.body.secret as string, email, password, userId: user.id };
}

/**
 * Retire les comptes créés par ce fichier de test (les enfants suivent en cascade ; le journal d'audit, en ajout seul,
 * reste). Jamais par motif de téléphone : les fichiers tournent en parallèle sur la même base.
 */
export async function cleanupTestData(app: NestExpressApplication): Promise<void> {
  const database = db(app);
  const phones = [...usedPhones];
  if (phones.length) await database.delete(schema.otpCodes).where(inArray(schema.otpCodes.phone, phones));
  usedPhones.clear();
  const ids = [...createdUserIds];
  if (!ids.length) return;
  const clients = await database.select({ id: schema.clients.id }).from(schema.clients).where(inArray(schema.clients.userId, ids));
  if (clients.length) await database.delete(schema.quotes).where(inArray(schema.quotes.clientId, clients.map((c) => c.id)));
  await database.delete(schema.competitorBenchmarks).where(inArray(schema.competitorBenchmarks.recordedByUserId, ids));
  await database.delete(schema.apiKeys).where(inArray(schema.apiKeys.createdByUserId, ids));
  await database.delete(schema.dataRequests).where(inArray(schema.dataRequests.userId, ids));
  await database.delete(schema.users).where(inArray(schema.users.id, ids));
  createdUserIds.clear();
}

export const bearer = (tokens: Pick<TokensView, 'accessToken'>) => ({ Authorization: `Bearer ${tokens.accessToken}` });
