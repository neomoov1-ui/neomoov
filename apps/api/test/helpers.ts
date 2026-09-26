import { schema } from '@neomoov/db';
import type { StaffRole, TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { UsersService } from '../src/modules/users/users.service.js';

/**
 * Configuration de test : le .env de la racine (base Supabase de développement), fournisseurs simulés, sans Redis.
 * La répartition automatique est désactivée par défaut (`DISPATCH_MODE=manual`, aucun battement) : les tests des
 * courses attribuent eux-mêmes ; le test de la répartition la réactive explicitement.
 */
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
      DISPATCH_MODE: 'manual',
      DISPATCH_TICK_MS: '0',
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
  // `TEST_LOG_LEVEL=error` affiche les erreurs des traitements asynchrones (répartition), sinon muettes.
  const app = await createApp(env, pino({ level: process.env['TEST_LOG_LEVEL'] ?? 'silent' }));
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

/** Le test d'autorisation appelle chaque route : la limite de requêtes par adresse (300 par minute) est remise à zéro entre ses scénarios. */
export async function resetHttpLimits(app: NestExpressApplication): Promise<void> {
  const limits = app.get(RateLimitService);
  await Promise.all(['127.0.0.1', '::1', '::ffff:127.0.0.1', '1'].map((ip) => limits.reset(`ip:${ip}`)));
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

/**
 * Inscription ou connexion complète par code SMS. Une carte simulée est enregistrée par défaut (étape 7 : une course
 * prépayée par carte exige une carte) ; `{ card: false }` laisse le compte sans carte.
 */
export async function loginByOtp(app: NestExpressApplication, phone = testPhone(), extra: Record<string, unknown> = {}, options: { card?: boolean } = {}): Promise<TokensView> {
  const code = await requestOtp(app, phone);
  const res = await request(app.getHttpServer())
    .post('/v1/auth/otp/verify')
    .send({ phone, code, acceptTerms: true, privacyPolicyVersion: await currentPolicyVersion(app), ...extra });
  if (res.status !== 200) throw new Error(`Connexion par code refusée : ${res.status} ${JSON.stringify(res.body)}`);
  const tokens = res.body as TokensView;
  trackUser(tokens.user.id);
  if (options.card !== false) await addTestCard(app, tokens.user.id);
  return tokens;
}

/** Carte simulée (visa 4242) enregistrée comme carte par défaut, comme le ferait la feuille de paiement Stripe. */
export async function addTestCard(app: NestExpressApplication, userId: string): Promise<string | null> {
  const payments = app.get(PaymentsService);
  try {
    const intent = await payments.setupIntent(userId);
    return (await payments.confirmSetupIntent(userId, { setupIntentId: intent.setupIntentId, makeDefault: true })).id;
  } catch (error) {
    if ((error as { code?: string }).code === 'CLIENT_PROFILE_REQUIRED') return null;
    throw error;
  }
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

export interface TestDriver {
  tokens: TokensView;
  userId: string;
  driverId: string;
  vehicleId: string;
  phone: string;
}

export interface CreateDriverOptions {
  /** Accepte le paiement par terminal (les tests de la répartition s'isolent des autres fichiers par ce mode). */
  acceptsTerminal?: boolean;
  acceptsScheduled?: boolean;
  /** Note moyenne de départ (5,00 par défaut). */
  rating?: number;
  firstName?: string;
}

/**
 * Crée un chauffeur actif complet (compte, rôle, fiche, véhicule actif, documents approuvés) et le connecte ; le
 * jeton porte le rôle `driver`.
 */
export async function createDriver(app: NestExpressApplication, category: 'neo_premium' | 'neo_prestige' | 'neo_xl' = 'neo_premium', options: CreateDriverOptions = {}): Promise<TestDriver> {
  const phone = testPhone();
  const first = await loginByOtp(app, phone);
  const database = db(app);
  await app.get(UsersService).grantRole(first.user.id, 'driver');
  if (options.firstName) await database.update(schema.users).set({ firstName: options.firstName }).where(eq(schema.users.id, first.user.id));
  const [numberRow] = await database.execute<{ n: string }>(sql`SELECT next_driver_public_number() AS n`);
  const [driver] = await database
    .insert(schema.drivers)
    .values({
      userId: first.user.id, publicNumber: numberRow!.n, status: 'active', qualification: 'saaq_authorized', acceptsCash: true, acceptsInterac: true, acceptsTerminal: options.acceptsTerminal ?? false,
      acceptsScheduled: options.acceptsScheduled ?? true, ratingAverage: (options.rating ?? 5).toFixed(2), ratingCount: options.rating !== undefined ? 10 : 0, activatedAt: new Date(), trainingCertifiedAt: new Date(),
    })
    .returning({ id: schema.drivers.id });
  const plate = `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const [vehicle] = await database
    .insert(schema.vehicles)
    .values({ driverId: driver!.id, category, make: 'Tesla', model: 'Model 3', year: 2024, colour: 'blanche', plate, seats: 4, status: 'active' })
    .returning({ id: schema.vehicles.id });
  await database.update(schema.drivers).set({ currentVehicleId: vehicle!.id }).where(eq(schema.drivers.id, driver!.id));
  await database.insert(schema.driverDocuments).values(
    (['licence', 'insurance', 'registration'] as const).map((type) => ({ driverId: driver!.id, type, fileKey: `test/${driver!.id}/${type}`, status: 'approved' as const, verifiedAt: new Date(), expiresOn: '2030-01-01' })),
  );
  const tokens = await loginByOtp(app, phone);
  return { tokens, userId: first.user.id, driverId: driver!.id, vehicleId: vehicle!.id, phone };
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
  const drivers = await database.select({ id: schema.drivers.id }).from(schema.drivers).where(inArray(schema.drivers.userId, ids));
  const rideConditions = [inArray(schema.rides.createdByUserId, ids)];
  if (clients.length) rideConditions.push(inArray(schema.rides.clientId, clients.map((c) => c.id)));
  if (drivers.length) rideConditions.push(inArray(schema.rides.driverId, drivers.map((d) => d.id)));
  const rides = await database.select({ id: schema.rides.id }).from(schema.rides).where(or(...rideConditions));
  // Usages de promotions (étape 8) : rendus au budget des promotions avant la suppression des courses et des clients.
  const useConditions = [
    ...(rides.length ? [sql`ride_id IN ${rides.map((r) => r.id)}`] : []),
    ...(clients.length ? [sql`client_id IN ${clients.map((c) => c.id)}`] : []),
  ];
  if (useConditions.length) {
    await database.execute(sql`WITH removed AS (DELETE FROM promotion_uses WHERE ${sql.join(useConditions, sql` OR `)} RETURNING promotion_id, discount_cents)
      UPDATE promotions p SET spent_cents = GREATEST(0, p.spent_cents - r.total) FROM (SELECT promotion_id, sum(discount_cents)::int AS total FROM removed GROUP BY promotion_id) r WHERE p.id = r.promotion_id`);
  }
  if (rides.length) {
    const rideIds = rides.map((r) => r.id);
    await database.delete(schema.incidents).where(inArray(schema.incidents.rideId, rideIds));
    await database.delete(schema.packConsumptions).where(inArray(schema.packConsumptions.rideId, rideIds));
    await database.delete(schema.creditUses).where(inArray(schema.creditUses.rideId, rideIds));
    await database.execute(sql`DELETE FROM refunds WHERE payment_id IN (SELECT id FROM payments WHERE ride_id IN ${rideIds})`);
    await database.delete(schema.payments).where(inArray(schema.payments.rideId, rideIds));
    // `ride_events` est en ajout seul (déclencheur) : le nettoyage des courses de test le suspend le temps d'une transaction.
    await database.transaction(async (tx) => {
      await tx.execute(sql`ALTER TABLE ride_events DISABLE TRIGGER ride_events_append_only`);
      await tx.delete(schema.rides).where(inArray(schema.rides.id, rideIds));
      await tx.execute(sql`ALTER TABLE ride_events ENABLE TRIGGER ride_events_append_only`);
    });
  }
  if (drivers.length) {
    const driverIds = drivers.map((d) => d.id);
    await database.execute(sql`DELETE FROM driver_locations WHERE driver_id IN ${driverIds}`);
    // Un chauffeur de test en ligne reçoit aussi les offres des courses d'autres fichiers qui tournent en même temps :
    // ces offres (et attributions planifiées) bloqueraient la suppression de tout le lot d'utilisateurs.
    await database.execute(sql`DELETE FROM ride_offers WHERE driver_id IN ${driverIds}`);
    await database.execute(sql`DELETE FROM scheduled_assignments WHERE driver_id IN ${driverIds}`);
    await database.delete(schema.packPurchases).where(inArray(schema.packPurchases.driverId, driverIds));
    await database.delete(schema.weeklyStatements).where(inArray(schema.weeklyStatements.driverId, driverIds));
    await database.delete(schema.sanctions).where(inArray(schema.sanctions.driverId, driverIds));
    await database.delete(schema.staffNotes).where(inArray(schema.staffNotes.entityId, driverIds));
  }
  if (clients.length) await database.delete(schema.quotes).where(inArray(schema.quotes.clientId, clients.map((c) => c.id)));
  // Agents IA (étape 13) : incidents ouverts par un agent au nom d'un client de test (sans course) ; les conversations
  // suivent la suppression des comptes (clé étrangère en cascade).
  await database.delete(schema.incidents).where(and(inArray(schema.incidents.reportedByUserId, ids), isNull(schema.incidents.rideId)));
  await database.delete(schema.competitorBenchmarks).where(inArray(schema.competitorBenchmarks.recordedByUserId, ids));
  await database.delete(schema.apiKeys).where(inArray(schema.apiKeys.createdByUserId, ids));
  await database.delete(schema.dataRequests).where(inArray(schema.dataRequests.userId, ids));
  await database.execute(sql`DELETE FROM credit_uses WHERE credit_id IN (SELECT id FROM credits WHERE user_id IN ${ids})`);
  await database.delete(schema.referrals).where(or(inArray(schema.referrals.referrerUserId, ids), inArray(schema.referrals.referredUserId, ids)));
  await database.delete(schema.credits).where(inArray(schema.credits.userId, ids));
  await database.delete(schema.users).where(inArray(schema.users.id, ids));
  createdUserIds.clear();
}

export const bearer = (tokens: Pick<TokensView, 'accessToken'>) => ({ Authorization: `Bearer ${tokens.accessToken}` });
