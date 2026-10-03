import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { localDate } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainEventsService } from '../src/common/domain-events.js';
import { SettingsService } from '../src/common/settings.service.js';
import { DispatchService } from '../src/modules/rides/dispatch.service.js';
import { recordPlatformFee } from '../src/modules/rides/platform-fee.js';
import { StatementsService } from '../src/modules/settlement/statements.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Redevance Neomoov des chauffeurs (décision du fondateur du 3 octobre 2026) : taux par chauffeur de 5 à 10 % (10 % par
 * défaut), une ligne par course terminée écrite avec la fin de course, retenue sur le versement (carte) ou ajoutée à la
 * dette (paiement direct) au relevé ; chauffeurs sans pack servis après ceux qui en ont un.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const DAY_MS = 86_400_000;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const key = () => `pf-${Math.random().toString(36).slice(2, 14)}`;
const feeOf = (fareCents: number, bps: number) => Math.floor((fareCents * bps + 5_000) / 10_000);
type Tokens = Awaited<ReturnType<typeof loginByOtp>>;
interface OfferSent { offerId: string; rideId: string; driverId: string; wave: number }

describe('redevance Neomoov des chauffeurs (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let operator: StaffSession;
  let finance: StaffSession;
  let offBus: (() => void) | null = null;
  const sent: OfferSent[] = [];
  const scenarioRides: string[] = [];
  const scenarioDrivers: string[] = [];
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp({ DISPATCH_MODE: 'auto', DISPATCH_TICK_MS: '0', FEATURE_IMMEDIATE_RIDES: 'on', DATABASE_POOL_MAX: '5' });
    if (!app) return;
    offBus = app.get(DomainEventsService).on('offer.sent', (p) => {
      sent.push({ offerId: p.offerId, rideId: p.rideId, driverId: p.driverId, wave: p.wave });
    });
    operator = await createStaffAndLogin(app, ['operator']);
    finance = await createStaffAndLogin(app, ['finance']);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    offBus?.();
    if (app) {
      const database = db(app);
      if (scenarioRides.length) {
        await database.update(schema.rideDispatches).set({ status: 'cancelled', nextActionAt: null }).where(inArray(schema.rideDispatches.rideId, scenarioRides));
        await database.update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(inArray(schema.rideOffers.rideId, scenarioRides), eq(schema.rideOffers.state, 'sent')));
      }
      if (scenarioDrivers.length) {
        await database.delete(schema.driverPresence).where(inArray(schema.driverPresence.driverId, scenarioDrivers));
        await database.update(schema.drivers).set({ acceptsTerminal: false }).where(inArray(schema.drivers.id, scenarioDrivers));
      }
      await cleanupTestData(app);
    }
    await app?.close();
  });

  const rideRow = async (id: string) => (await db(app!).select().from(schema.rides).where(eq(schema.rides.id, id)))[0]!;
  const feesOf = (rideId: string) => db(app!).select().from(schema.platformFees).where(eq(schema.platformFees.rideId, rideId));
  const book = async (client: Tokens, payment: { paymentChoice: 'prepaid' | 'pay_driver_after'; paymentMethod: string }) => {
    const requestedAt = inHours(3);
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const res = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key()).send({ quoteId: quote.id, type: 'scheduled', requestedAt, ...payment, maxConsentedCents: quote.maxConsentedCents });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    scenarioRides.push(res.body.id as string);
    return res.body.id as string;
  };
  const complete = (rideId: string, driver: TestDriver) =>
    request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 });
  /** Attribution par l'opérateur puis déroulé complet par le chauffeur. */
  const drive = async (rideId: string, driver: TestDriver) => {
    await request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(operator.tokens)).send({ driverId: driver.driverId }).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(driver.tokens)).expect(200);
    const res = await complete(rideId, driver);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  };
  const setRate = (driverId: string, rateBps: unknown, session: StaffSession = finance) =>
    request(server()).put(`/v1/admin/drivers/${driverId}/platform-fee`).set(bearer(session.tokens)).send({ rateBps });

  it('carte et paiement direct : redevance écrite une fois à la fin de course, taux réglé dans My Hub, relevé, revenus, finances', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    expect((await request(server()).get(`/v1/admin/drivers/${driver.driverId}`).set(bearer(finance.tokens)).expect(200)).body.driver.platformFeeBps).toBe(1000);

    // Course payée par carte : 10 % du tarif du chauffeur, arrondi au cent, canal « platform ».
    const cardRide = await book(client, { paymentChoice: 'prepaid', paymentMethod: 'card_app' });
    await drive(cardRide, driver);
    const card = await rideRow(cardRide);
    const [cardFee] = await feesOf(cardRide);
    expect(cardFee).toMatchObject({ driverId: driver.driverId, baseCents: card.fareCents, rateBps: 1000, amountCents: feeOf(card.fareCents!, 1000), paymentChannel: 'platform' });
    expect(cardFee!.amountCents).toBeGreaterThan(0);

    // Idempotence : fin de course rejouée, écriture rejouée : toujours une seule ligne, montant inchangé.
    await complete(cardRide, driver).expect(200);
    expect(await recordPlatformFee(db(app), card)).toBe(false);
    expect(await feesOf(cardRide)).toHaveLength(1);

    // Réglage du taux : bornes 5 à 10 % (schéma), permission des finances, ancien et nouveau taux journalisés.
    for (const bad of [499, 1001, 750.5, '750']) {
      const res = await setRate(driver.driverId, bad);
      expect(res.status, `taux ${String(bad)}`).toBe(400);
    }
    expect((await setRate(driver.driverId, 750, operator)).status).toBe(403);
    const changed = await setRate(driver.driverId, 750).expect(200);
    expect(changed.body.driver.platformFeeBps).toBe(750);
    const audit = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, driver.driverId), eq(schema.auditLog.action, 'admin.driver_platform_fee')));
    expect(audit.map((a) => [a.before, a.after])).toEqual([[{ platformFeeBps: 1000 }, { platformFeeBps: 750 }]]);
    // La course déjà terminée garde son taux.
    expect((await feesOf(cardRide))[0]!.rateBps).toBe(1000);

    // Course payée directement au chauffeur : nouveau taux, canal « direct ».
    const cashRide = await book(client, { paymentChoice: 'pay_driver_after', paymentMethod: 'cash' });
    await drive(cashRide, driver);
    const cash = await rideRow(cashRide);
    const [cashFee] = await feesOf(cashRide);
    expect(cashFee).toMatchObject({ rateBps: 750, baseCents: cash.fareCents, amountCents: feeOf(cash.fareCents!, 750), paymentChannel: 'direct' });

    // Relevé de la semaine : une ligne « Redevance Neomoov (x %) » par course, débit dans les deux cas.
    const today = localDate(new Date(), 'America/Toronto');
    const monday = new Date(Date.parse(`${today.date}T12:00:00Z`) - ((today.weekday + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
    const preview = await app.get(StatementsService).generate({ periodStart: monday, driverId: driver.driverId, preview: true });
    const lines = preview.statements[0]!.lines;
    const feeLines = lines.filter((l) => l.kind === 'platform_fee');
    expect(feeLines.map((l) => [l.rideId, l.amountCents, l.label.split(' · ')[0]]).sort()).toEqual([
      [cardRide, -cardFee!.amountCents, 'Redevance Neomoov (10 %)'],
      [cashRide, -cashFee!.amountCents, 'Redevance Neomoov (7,5 %)'],
    ].sort());
    const withoutFees = lines.filter((l) => l.kind !== 'platform_fee').reduce((sum, l) => sum + l.amountCents, 0);
    expect(preview.statements[0]!.netCents).toBe(withoutFees - cardFee!.amountCents - cashFee!.amountCents);

    // Garantie modèle validée (chauffeur en faute) : le tarif est repris et la redevance de la course remise.
    await db(app).update(schema.rides).set({ guaranteeOutcome: 'validated', driverFareProtected: false }).where(eq(schema.rides.id, cardRide));
    const guaranteed = (await app.get(StatementsService).generate({ periodStart: monday, driverId: driver.driverId, preview: true })).statements[0]!.lines;
    expect(guaranteed.filter((l) => l.rideId === cardRide && l.kind === 'adjustment_positive').map((l) => l.amountCents)).toEqual([cardFee!.amountCents]);
    await db(app).update(schema.rides).set({ guaranteeOutcome: null }).where(eq(schema.rides.id, cardRide));

    // Revenus du chauffeur : redevance par course et total net.
    const earnings = (await request(server()).get(`/v1/driver/earnings?period=week&date=${today.date}`).set(bearer(driver.tokens)).expect(200)).body as {
      totals: { totalCents: number; platformFeeCents: number; netCents: number };
      items: Array<{ rideId: string; platformFeeCents: number; platformFeeBps: number | null }>;
    };
    expect(earnings.totals.platformFeeCents).toBe(cardFee!.amountCents + cashFee!.amountCents);
    expect(earnings.totals.netCents).toBe(earnings.totals.totalCents - earnings.totals.platformFeeCents);
    expect(earnings.items.find((i) => i.rideId === cashRide)).toMatchObject({ platformFeeCents: cashFee!.amountCents, platformFeeBps: 750 });

    // Finances : total de la période, par mode de paiement et par taux.
    const summary = (await request(server()).get(`/v1/admin/platform-fees?from=${today.date}&to=${today.date}`).set(bearer(finance.tokens)).expect(200)).body as {
      rides: number; totalCents: number; platform: { totalCents: number }; direct: { totalCents: number }; byRate: Array<{ rateBps: number; rides: number; totalCents: number }>;
    };
    expect(summary.rides).toBeGreaterThanOrEqual(2);
    expect(summary.totalCents).toBe(summary.platform.totalCents + summary.direct.totalCents);
    expect(summary.direct.totalCents).toBeGreaterThanOrEqual(cashFee!.amountCents);
    expect(summary.byRate.find((r) => r.rateBps === 750)?.totalCents).toBeGreaterThanOrEqual(cashFee!.amountCents);
    expect((await request(server()).get(`/v1/admin/platform-fees?from=${today.date}&to=2020-01-01`).set(bearer(finance.tokens))).status).toBe(400);
    expect((await request(server()).get(`/v1/admin/platform-fees?from=${today.date}&to=${today.date}`).set(bearer(driver.tokens))).status).toBe(403);
  });

  it('nouveau chauffeur : taux du réglage global, borné', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const settings = app.get(SettingsService);
    await db(app).update(schema.settings).set({ value: 800 }).where(and(eq(schema.settings.key, 'drivers.platform_fee_default_bps'), eq(schema.settings.scope, 'global')));
    settings.invalidate();
    try {
      const applicant = await loginByOtp(app);
      await request(server()).post('/v1/driver/apply').set(bearer(applicant)).send({ firstName: 'Redevance', lastName: 'Essai', qualification: 'saaq_authorized' }).expect(201);
      const [row] = await db(app).select({ rate: schema.drivers.platformFeeBps }).from(schema.drivers).where(eq(schema.drivers.userId, applicant.user.id));
      expect(row!.rate).toBe(800);
    } finally {
      await db(app).update(schema.settings).set({ value: 1000 }).where(and(eq(schema.settings.key, 'drivers.platform_fee_default_bps'), eq(schema.settings.scope, 'global')));
      settings.invalidate();
    }
  });

  /** Chauffeur de scénario qui accepte le terminal (les autres chauffeurs de la base ne sont pas sollicités). */
  async function scenarioDriver(withPack: boolean, acceptsScheduled: boolean): Promise<TestDriver> {
    const d = await createDriver(app!, 'neo_premium', { acceptsTerminal: true, acceptsScheduled });
    scenarioDrivers.push(d.driverId);
    if (withPack) {
      await db(app!).insert(schema.packPurchases).values({
        driverId: d.driverId, packCode: 'essential', pricePaidCents: 0, ridesIncluded: 20, ridesRemaining: 20, activatedAt: new Date(), expiresAt: new Date(Date.now() + 28 * DAY_MS),
        status: 'active', autoRenew: false, billing: 'free',
      });
    }
    return d;
  }
  async function requestRide(tokens: Tokens, requestedAt?: Date): Promise<string> {
    const quote = (await request(server()).post('/v1/quotes').set(bearer(tokens)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, ...(requestedAt ? { requestedAt: requestedAt.toISOString() } : {}) }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const res = await request(server()).post('/v1/rides').set(bearer(tokens)).set('Idempotency-Key', key()).send({
      quoteId: quote.id, type: requestedAt ? 'scheduled' : 'immediate', ...(requestedAt ? { requestedAt: requestedAt.toISOString() } : {}), paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    scenarioRides.push(res.body.id as string);
    return res.body.id as string;
  }
  async function offersFor(rideId: string, count: number, timeoutMs = 10_000): Promise<OfferSent[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const offers = sent.filter((o) => o.rideId === rideId);
      if (offers.length >= count || Date.now() > deadline) return offers;
      await pause(20);
    }
  }

  it('réservation planifiée : les chauffeurs avec pack d\'abord, ceux sans pack après le délai, jamais exclus', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const withPack = await scenarioDriver(true, true);
    const withoutPack = await scenarioDriver(false, true);
    const client = await loginByOtp(app);
    const rideId = await requestRide(client, later(4 * 3600));
    const first = await offersFor(rideId, 1);
    expect(first.map((o) => o.driverId)).toEqual([withPack.driverId]);
    await pause(300);
    expect(sent.filter((o) => o.rideId === rideId)).toHaveLength(1);
    // Fin du délai réservé aux chauffeurs avec pack (120 s) : le chauffeur sans pack reçoit l'offre, celle du premier reste ouverte.
    await app.get(DispatchService).tick(later(121));
    const all = await offersFor(rideId, 2);
    expect(all.map((o) => [o.driverId, o.wave])).toEqual([[withPack.driverId, 1], [withoutPack.driverId, 2]]);
    const [stillOpen] = await db(app).select({ state: schema.rideOffers.state }).from(schema.rideOffers).where(eq(schema.rideOffers.id, all[0]!.offerId));
    expect(stillOpen!.state).toBe('sent');
    // Le chauffeur sans pack peut accepter : il est servi, seulement après.
    await request(server()).post(`/v1/driver/offers/${all[1]!.offerId}/accept`).set(bearer(withoutPack.tokens)).expect(200);
    expect((await rideRow(rideId)).driverId).toBe(withoutPack.driverId);
  });

  it('course immédiate : le chauffeur avec pack plus loin est sollicité avant le chauffeur sans pack plus proche', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const near = await scenarioDriver(false, false);
    const far = await scenarioDriver(true, false);
    await request(server()).post('/v1/driver/status').set(bearer(near.tokens)).send({ status: 'online', coordinates: { lat: 45.5232, lng: -73.5822 } }).expect(200);
    await request(server()).post('/v1/driver/status').set(bearer(far.tokens)).send({ status: 'online', coordinates: { lat: 45.5265, lng: -73.5865 } }).expect(200);
    const client = await loginByOtp(app);
    const rideId = await requestRide(client);
    const [first] = await offersFor(rideId, 1);
    expect(first!.driverId).toBe(far.driverId);
    // Refus : le chauffeur sans pack, plus proche, est sollicité ensuite (jamais exclu).
    await request(server()).post(`/v1/driver/offers/${first!.offerId}/decline`).set(bearer(far.tokens)).expect(200);
    await app.get(DispatchService).tick(later(1));
    const offers = await offersFor(rideId, 2);
    expect(offers.map((o) => o.driverId)).toEqual([far.driverId, near.driverId]);
  });
});
