import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SettingsService } from '../src/common/settings.service.js';
import { CreditsEventsService } from '../src/modules/credits/credits-events.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testPhone, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const DAY_MS = 86_400_000;
/** Codes générés : 6 caractères sans 0, O, 1, I ni L. « INCONNU0 » ne peut donc appartenir à personne. */
const CODE_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const UNKNOWN_CODE = 'INCONNU0';
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `grw-${Math.random().toString(36).slice(2, 14)}`;
type Tokens = { accessToken: string; user: { id: string } };
interface ReferralBody {
  code: string;
  link: string;
  kind: 'client' | 'driver';
  referrerRewardCents: number;
  referredRewardCents: number;
  thresholdRides: number;
  stats: { invited: number; completed: number; earnedCents: number };
  referredBy: { code: string; status: string } | null;
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('crédits et parrainage : consommation à la fin de course, parrainage client et chauffeur (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let settings: SettingsService;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (app) settings = app.get(SettingsService);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const creditsOf = (userId: string) => db(app!).select().from(schema.credits).where(eq(schema.credits.userId, userId));
  const usesOf = (rideId: string) => db(app!).select().from(schema.creditUses).where(eq(schema.creditUses.rideId, rideId));
  const referralOf = async (referredUserId: string, kind: 'client' | 'driver') =>
    (await db(app!).select().from(schema.referrals).where(and(eq(schema.referrals.referredUserId, referredUserId), eq(schema.referrals.kind, kind))))[0];
  const referralView = async (tokens: Tokens, kind?: 'client' | 'driver') =>
    (await request(server()).get('/v1/me/referral').query(kind ? { kind } : {}).set(bearer(tokens)).expect(200)).body as ReferralBody;
  const applyCode = (tokens: Tokens, code: string) => request(server()).post('/v1/me/referral/apply').set(bearer(tokens)).send({ code });
  const expectExpiryAround = (expiresAt: Date | null, days: number) => {
    expect(expiresAt).not.toBeNull();
    expect(Math.abs(expiresAt!.getTime() - (Date.now() + days * DAY_MS))).toBeLessThan(10 * 60_000);
  };

  async function quote(client: Tokens) {
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    return res.body.quotes[0] as { id: string; maxConsentedCents: number; totalCents: number };
  }

  /** Course complète : devis, réservation planifiée prépayée, attribution par l'opérateur, déroulé par le chauffeur. */
  async function completeRide(client: Tokens, admin: Tokens, driver: Pick<TestDriver, 'driverId' | 'tokens'>): Promise<{ id: string; finalPriceCents: number }> {
    const q = await quote(client);
    const ride = (
      await request(server())
        .post('/v1/rides')
        .set(bearer(client))
        .set('Idempotency-Key', key())
        .send({ quoteId: q.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: q.maxConsentedCents })
        .expect(201)
    ).body as { id: string };
    await request(server()).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(admin)).send({ driverId: driver.driverId }).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(driver.tokens)).expect(200);
    const done = (await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200)).body as { finalPriceCents: number };
    return { id: ride.id, finalPriceCents: done.finalPriceCents };
  }

  it('crédits : liste (utilisables d\'abord, plus récents en tête), consommation à la fin de course par expiration la plus proche, une seule fois même rejouée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const now = Date.now();
    const insert = async (values: { amountCents: number; remainingCents: number; expiresAt: Date | null; createdAt: Date; reference: string }) =>
      (await db(app!).insert(schema.credits).values({ userId: client.user.id, origin: 'goodwill', ...values }).returning())[0]!;
    // Ordre de création inverse de l'ordre d'expiration : la consommation suit l'expiration, pas l'ancienneté.
    const forever = await insert({ amountCents: 20_000, remainingCents: 20_000, expiresAt: null, createdAt: new Date(now - 10 * DAY_MS), reference: 'sans-expiration' });
    const later = await insert({ amountCents: 1_000, remainingCents: 1_000, expiresAt: new Date(now + 100 * DAY_MS), createdAt: new Date(now - 8 * DAY_MS), reference: 'dans-100-jours' });
    const spent = await insert({ amountCents: 400, remainingCents: 0, expiresAt: new Date(now + 50 * DAY_MS), createdAt: new Date(now - 3 * DAY_MS), reference: 'epuise' });
    const soon = await insert({ amountCents: 500, remainingCents: 500, expiresAt: new Date(now + 10 * DAY_MS), createdAt: new Date(now - 2 * DAY_MS), reference: 'dans-10-jours' });
    const expired = await insert({ amountCents: 700, remainingCents: 700, expiresAt: new Date(now - DAY_MS), createdAt: new Date(now - DAY_MS), reference: 'expire' });

    const listed = (await request(server()).get('/v1/me/credits').set(bearer(client)).expect(200)).body as { availableCents: number; credits: Array<{ id: string; origin: string; remainingCents: number; expiresAt: string | null }> };
    expect(listed.availableCents).toBe(21_500);
    expect(listed.credits.map((c) => c.id)).toEqual([soon.id, later.id, forever.id, expired.id, spent.id]);
    expect(listed.credits[2]).toMatchObject({ origin: 'goodwill', remainingCents: 20_000, expiresAt: null });

    const ride = await completeRide(client, admin.tokens, driver);
    const [stored] = await db(app).select({ applied: schema.rides.creditsAppliedCents }).from(schema.rides).where(eq(schema.rides.id, ride.id));
    const applied = stored!.applied;
    expect(applied).toBeGreaterThan(0);
    expect(applied).toBeLessThanOrEqual(Math.min(21_500, ride.finalPriceCents));
    const uses = await until(() => usesOf(ride.id), (rows) => rows.reduce((s, r) => s + r.amountCents, 0) === applied, 'consommation des crédits à la fin de course');

    // Prélèvement attendu : le plus proche de l'expiration d'abord, sans expiration en dernier ; jamais l'expiré ni l'épuisé.
    let left = applied;
    const expected = new Map<string, number>();
    for (const credit of [soon, later, forever]) {
      const take = Math.min(credit.remainingCents, left);
      if (take > 0) expected.set(credit.id, take);
      left -= take;
    }
    expect(new Map(uses.map((u) => [u.creditId, u.amountCents]))).toEqual(expected);
    const remaining = async () => new Map((await creditsOf(client.user.id)).map((c) => [c.id, c.remainingCents]));
    const afterFirst = await remaining();
    for (const credit of [soon, later, forever]) expect(afterFirst.get(credit.id)).toBe(credit.remainingCents - (expected.get(credit.id) ?? 0));
    expect(afterFirst.get(expired.id)).toBe(700);
    expect(afterFirst.get(spent.id)).toBe(0);

    // Événement rejoué, deux fois de suite puis deux fois en même temps : aucun second prélèvement.
    const events = app.get(CreditsEventsService);
    const replay = await events.onRideCompleted(ride.id);
    expect(replay.credits).toMatchObject({ replayed: true, consumedCents: 0 });
    await events.onRideCompleted(ride.id);
    await Promise.all([events.onRideCompleted(ride.id), events.onRideCompleted(ride.id)]);
    expect(await remaining()).toEqual(afterFirst);
    expect(await usesOf(ride.id)).toHaveLength(uses.length);
    const after = (await request(server()).get('/v1/me/credits').set(bearer(client)).expect(200)).body as { availableCents: number };
    expect(after.availableCents).toBe(21_500 - applied);

    // Remboursement en crédit : il expire lui aussi après `credits.validity_days`.
    await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(admin.tokens)).send({ amountCents: 100, reason: 'Geste commercial', mode: 'credit' }).expect(201);
    const refundCredit = (await creditsOf(client.user.id)).find((c) => c.origin === 'refund');
    expect(refundCredit).toMatchObject({ amountCents: 100, remainingCents: 100 });
    expectExpiryAround(refundCredit!.expiresAt, await settings.number('credits.validity_days', 365));
  });

  it('parrainage client : code et lien, refus (inconnu, propre code, après une course, hors délai, second parrain, croisé), crédits des deux après la première course, une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [referrerCents, referredCents, windowDays, validityDays, base] = await Promise.all([
      settings.number('referral.client_referrer_cents', 1_000), settings.number('referral.client_referred_cents', 1_000), settings.number('referral.apply_window_days', 30),
      settings.number('credits.validity_days', 365), settings.string('referral.link_base_url', 'https://neomoov.net/parrainage'),
    ]);
    const referrer = await loginByOtp(app);
    const view = await referralView(referrer);
    expect(view.code).toMatch(CODE_PATTERN);
    expect(view).toMatchObject({
      link: `${base.replace(/\/+$/, '')}/${view.code}`, kind: 'client', referrerRewardCents: referrerCents, referredRewardCents: referredCents, thresholdRides: 1,
      stats: { invited: 0, completed: 0, earnedCents: 0 }, referredBy: null,
    });
    expect((await referralView(referrer)).code).toBe(view.code);
    const [stored] = await db(app).select({ code: schema.users.referralCode }).from(schema.users).where(eq(schema.users.id, referrer.user.id));
    expect(stored!.code).toBe(view.code);

    const referee = await loginByOtp(app);
    const unknown = await applyCode(referee, UNKNOWN_CODE);
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('REFERRAL_CODE_UNKNOWN');
    const own = await applyCode(referrer, view.code);
    expect(own.status).toBe(400);
    expect(own.body.code).toBe('REFERRAL_OWN_CODE');

    const veteran = await loginByOtp(app);
    await db(app).update(schema.clients).set({ rideCount: 1 }).where(eq(schema.clients.userId, veteran.user.id));
    const late = await applyCode(veteran, view.code);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('REFERRAL_AFTER_FIRST_RIDE');
    const old = await loginByOtp(app);
    await db(app).update(schema.users).set({ createdAt: new Date(Date.now() - (windowDays + 1) * DAY_MS) }).where(eq(schema.users.id, old.user.id));
    const closed = await applyCode(old, view.code);
    expect(closed.status).toBe(409);
    expect(closed.body.code).toBe('REFERRAL_WINDOW_CLOSED');

    // Saisie en minuscules : le code est normalisé.
    const applied = (await applyCode(referee, view.code.toLowerCase()).expect(201)).body as ReferralBody;
    expect(applied).toMatchObject({ kind: 'client', referredBy: { code: view.code, status: 'pending' } });
    expect(await referralOf(referee.user.id, 'client')).toMatchObject({ referrerUserId: referrer.user.id, code: view.code, kind: 'client', thresholdRides: 1, status: 'pending' });
    const other = await loginByOtp(app);
    const second = await applyCode(referee, (await referralView(other)).code);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('REFERRAL_ALREADY_APPLIED');
    const crossed = await applyCode(referrer, (await referralView(referee)).code);
    expect(crossed.status).toBe(409);
    expect(crossed.body.code).toBe('REFERRAL_RECIPROCAL');
    expect((await referralView(referrer)).stats).toEqual({ invited: 1, completed: 0, earnedCents: 0 });

    // Première course terminée du filleul : un crédit pour chacun, marqué du code, expirant après `credits.validity_days`.
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const admin = await createStaffAndLogin(app, ['operator']);
    const ride = await completeRide(referee, admin.tokens, driver);
    const done = await until(() => referralOf(referee.user.id, 'client'), (r) => r?.status === 'completed', 'récompense du parrainage client');
    expect(done).toMatchObject({ referrerCreditCents: referrerCents, referredCreditCents: referredCents });
    expect(done!.completedAt).not.toBeNull();
    const events = app.get(CreditsEventsService);
    const replay = await events.onRideCompleted(ride.id);
    expect(replay.referrals).toEqual({ client: false, driver: false });
    await Promise.all([events.onRideCompleted(ride.id), events.onRideCompleted(ride.id)]);

    const referrerCredits = (await creditsOf(referrer.user.id)).filter((c) => c.origin === 'referral');
    const refereeCredits = (await creditsOf(referee.user.id)).filter((c) => c.origin === 'referral');
    expect(referrerCredits).toHaveLength(1);
    expect(refereeCredits).toHaveLength(1);
    expect(referrerCredits[0]).toMatchObject({ amountCents: referrerCents, remainingCents: referrerCents, reference: view.code });
    expect(refereeCredits[0]).toMatchObject({ amountCents: referredCents, remainingCents: referredCents, reference: view.code });
    expectExpiryAround(referrerCredits[0]!.expiresAt, validityDays);
    expectExpiryAround(refereeCredits[0]!.expiresAt, validityDays);

    expect((await referralView(referrer)).stats).toEqual({ invited: 1, completed: 1, earnedCents: referrerCents });
    expect((await referralView(referee)).referredBy).toEqual({ code: view.code, status: 'completed' });
    const wallet = (await request(server()).get('/v1/me/credits').set(bearer(referee)).expect(200)).body as { availableCents: number; credits: Array<{ origin: string }> };
    expect(wallet.availableCents).toBe(referredCents);
    expect(wallet.credits.map((c) => c.origin)).toEqual(['referral']);
  });

  it('parrainage chauffeur : code d\'un chauffeur exigé à la candidature, crédit de pack au parrain quand le filleul atteint le seuil de courses, une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [sponsorCents, threshold, validityDays] = await Promise.all([
      settings.number('referral.driver_referrer_cents', 5_000), settings.number('referral.driver_threshold_rides', 50), settings.number('credits.validity_days', 365),
    ]);
    const sponsor = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const sponsorView = await referralView(sponsor.tokens);
    expect(sponsorView).toMatchObject({ kind: 'driver', referrerRewardCents: sponsorCents, referredRewardCents: 0, thresholdRides: threshold, stats: { invited: 0, completed: 0, earnedCents: 0 } });
    expect(sponsorView.code).toMatch(CODE_PATTERN);
    // Le même code sert au parrainage client : le type se choisit par le paramètre `kind`.
    expect(await referralView(sponsor.tokens, 'client')).toMatchObject({ code: sponsorView.code, kind: 'client', thresholdRides: 1 });

    const plainClient = await loginByOtp(app);
    const notDriver = await request(server()).get('/v1/me/referral').query({ kind: 'driver' }).set(bearer(plainClient));
    expect(notDriver.status).toBe(403);
    expect(notDriver.body.code).toBe('DRIVER_PROFILE_REQUIRED');
    const clientCode = (await referralView(plainClient)).code;

    const phone = testPhone();
    const candidate = await loginByOtp(app, phone);
    const applyBody = { firstName: 'Moussa', lastName: 'Traoré', qualification: 'saaq_authorized' };
    const unknown = await request(server()).post('/v1/driver/apply').set(bearer(candidate)).send({ ...applyBody, referralCode: UNKNOWN_CODE });
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('REFERRAL_CODE_UNKNOWN');
    const fromClient = await request(server()).post('/v1/driver/apply').set(bearer(candidate)).send({ ...applyBody, referralCode: clientCode });
    expect(fromClient.status).toBe(400);
    expect(fromClient.body.code).toBe('REFERRAL_NOT_A_DRIVER');
    const applied = (await request(server()).post('/v1/driver/apply').set(bearer(candidate)).send({ ...applyBody, referralCode: sponsorView.code.toLowerCase() }).expect(201)).body as { id: string };
    expect(await referralOf(candidate.user.id, 'driver')).toMatchObject({ referrerUserId: sponsor.userId, code: sponsorView.code, kind: 'driver', thresholdRides: threshold, status: 'pending' });

    // Dossier validé (comme `createDriver`) et compteur placé à deux courses du seuil : pas besoin de 50 courses.
    const database = db(app);
    await database
      .update(schema.drivers)
      .set({ status: 'active', acceptsCash: true, acceptsInterac: true, acceptsScheduled: false, ratingAverage: '5.00', activatedAt: new Date(), trainingCertifiedAt: new Date(), rideCount: threshold - 2 })
      .where(eq(schema.drivers.id, applied.id));
    const [vehicle] = await database
      .insert(schema.vehicles)
      .values({ driverId: applied.id, category: 'neo_premium', make: 'Tesla', model: 'Model 3', year: 2024, colour: 'blanche', plate: `T${Math.random().toString(36).slice(2, 8).toUpperCase()}`, seats: 4, status: 'active' })
      .returning({ id: schema.vehicles.id });
    await database.update(schema.drivers).set({ currentVehicleId: vehicle!.id }).where(eq(schema.drivers.id, applied.id));
    await database.insert(schema.driverDocuments).values(
      (['licence', 'insurance', 'registration'] as const).map((type) => ({ driverId: applied.id, type, fileKey: `test/${applied.id}/${type}`, status: 'approved' as const, verifiedAt: new Date(), expiresOn: '2030-01-01' })),
    );
    // Nouveau jeton : il porte le rôle `driver` accordé par la candidature.
    const referred = { driverId: applied.id, tokens: await loginByOtp(app, phone) };
    const client = await loginByOtp(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const events = app.get(CreditsEventsService);
    const sponsorCredits = async () => (await creditsOf(sponsor.userId)).filter((c) => c.origin === 'driver_pack');

    const first = await completeRide(client, admin.tokens, referred);
    await events.onRideCompleted(first.id);
    const [count] = await database.select({ n: schema.drivers.rideCount }).from(schema.drivers).where(eq(schema.drivers.id, applied.id));
    expect(count!.n).toBe(threshold - 1);
    expect((await referralOf(candidate.user.id, 'driver'))!.status).toBe('pending');
    expect(await sponsorCredits()).toHaveLength(0);

    const second = await completeRide(client, admin.tokens, referred);
    const done = await until(() => referralOf(candidate.user.id, 'driver'), (r) => r?.status === 'completed', 'récompense du parrainage chauffeur');
    expect(done).toMatchObject({ referrerCreditCents: sponsorCents, referredCreditCents: 0 });
    await events.onRideCompleted(second.id);
    await Promise.all([events.onRideCompleted(second.id), events.onRideCompleted(second.id)]);
    const credits = await sponsorCredits();
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ amountCents: sponsorCents, remainingCents: sponsorCents, reference: sponsorView.code, note: 'Crédit de pack' });
    expectExpiryAround(credits[0]!.expiresAt, validityDays);
    expect((await creditsOf(candidate.user.id)).filter((c) => c.origin === 'driver_pack' || c.origin === 'referral')).toHaveLength(0);
    // Crédit de pack : listé, mais jamais déduit d'une course que le parrain réserverait comme client.
    const wallet = await request(app.getHttpServer()).get('/v1/me/credits').set(bearer(sponsor.tokens)).expect(200);
    expect(wallet.body.availableCents).toBe(0);
    expect(wallet.body.credits.map((c: { origin: string }) => c.origin)).toEqual(['driver_pack']);
    expect((await referralView(sponsor.tokens)).stats).toEqual({ invited: 1, completed: 1, earnedCents: sponsorCents });
    const [check] = await database.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM referrals WHERE referred_user_id = ${candidate.user.id}::uuid`);
    expect(Number(check!.n)).toBe(1);
  });
});
