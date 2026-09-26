import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '../src/common/settings.service.js';
import { driverEligible } from '../src/modules/rides/eligibility.js';
import { PackLifecycleService } from '../src/modules/rides/pack-lifecycle.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const key = () => `test-${Math.random().toString(36).slice(2, 14)}`;
const HOUR = 3_600_000;
const DAY = 86_400_000;

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 5_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('packs et promotions (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  const promotionCodes: string[] = [];
  let hour = 3;

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (promotionCodes.length) await db(app).delete(schema.promotions).where(inArray(schema.promotions.code, promotionCodes));
    }
    await app?.close();
  });

  const lifecycle = () => app!.get(PackLifecycleService);
  const purchases = (driverId: string) => db(app!).select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driverId));
  const notifications = (userId: string, template: string) =>
    db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template)));

  /** Devis puis course planifiée payée au chauffeur (heures distinctes pour ne jamais se chevaucher). */
  async function scheduledRide(client: TokensView, options: Record<string, unknown> = {}) {
    hour += 2;
    const requestedAt = inHours(hour);
    const quotes = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt, options }).expect(201);
    const quote = quotes.body.quotes[0] as { id: string; maxConsentedCents: number; promotionCode: string | null; promotionDiscountCents: number; fareCents: number };
    const created = await request(server())
      .post('/v1/rides')
      .set(bearer(client))
      .set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents })
      .expect(201);
    return { rideId: created.body.id as string, quote };
  }

  /** Course terminée par ce chauffeur, écrite directement (la consommation est appelée par le test). */
  async function completedRide(client: TokensView, driver: TestDriver): Promise<string> {
    const { rideId } = await scheduledRide(client);
    await db(app!).update(schema.rides).set({ state: 'completed', driverId: driver.driverId }).where(eq(schema.rides.id, rideId));
    return rideId;
  }

  async function activate(driver: TestDriver, packCode: string, autoRenew: boolean) {
    await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode, autoRenew }).expect(200);
    const [row] = (await purchases(driver.driverId)).filter((p) => p.packCode === packCode && p.status === 'active');
    return row!;
  }

  it('consommation à la fin de course (reports d\'abord, une seule fois), alerte au seuil, épuisement et changement de pack programmé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app);
    const operator = await createStaffAndLogin(app, ['operator']);
    const pack = await activate(driver, 'essential', true);
    // Changement vers Pro à l'épuisement ; une course reportée d'un pack précédent est consommée en premier.
    await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'pro' }).expect(200);
    await db(app).update(schema.packPurchases).set({ ridesRemaining: 4, carriedOverRemaining: 1 }).where(eq(schema.packPurchases.id, pack.id));

    // Parcours complet : l'événement de fin de course déclenche la consommation.
    const { rideId } = await scheduledRide(client);
    await request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(operator.tokens)).send({ driverId: driver.driverId }).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(driver.tokens)).expect(200);
    await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 4200, measuredDurationSeconds: 700 }).expect(200);
    const consumption = await until(() => db(app!).select().from(schema.packConsumptions).where(eq(schema.packConsumptions.rideId, rideId)), (rows) => rows.length > 0);
    expect(consumption).toHaveLength(1);
    expect(consumption[0]).toMatchObject({ packPurchaseId: pack.id, fromCarriedOver: true });
    let [row] = (await purchases(driver.driverId)).filter((p) => p.id === pack.id);
    expect(row).toMatchObject({ ridesRemaining: 4, carriedOverRemaining: 0, status: 'active' });
    // Rejouée (plusieurs processus reçoivent le même événement) : aucune seconde consommation.
    expect((await lifecycle().consume(rideId)).consumedFromId).toBeNull();
    expect(await db(app).select().from(schema.packConsumptions).where(eq(schema.packConsumptions.rideId, rideId))).toHaveLength(1);

    // Quatre courses restantes : la suivante laisse 3 courses, seuil de l'alerte `pack.low`.
    const second = await lifecycle().consume(await completedRide(client, driver));
    expect(second).toMatchObject({ consumedFromId: pack.id, remaining: 3, renewedId: null });
    const low = await notifications(driver.userId, 'pack.low');
    expect(low).toHaveLength(1);
    expect(low[0]!.data).toMatchObject({ packCode: 'essential', remaining: 3 });
    const home = await request(server()).get('/v1/driver/home').set(bearer(driver.tokens)).expect(200);
    expect(home.body.alerts.map((a: { code: string }) => a.code)).toContain('pack_low');

    // Dernière course : pack épuisé, Pro activé aussitôt (facturé au relevé), l'ancien ne se renouvelle plus.
    await db(app).update(schema.packPurchases).set({ ridesRemaining: 1 }).where(eq(schema.packPurchases.id, pack.id));
    const last = await lifecycle().consume(await completedRide(client, driver));
    expect(last.remaining).toBe(0);
    expect(last.renewedId).not.toBeNull();
    const after = await purchases(driver.driverId);
    [row] = after.filter((p) => p.id === pack.id);
    expect(row).toMatchObject({ status: 'exhausted', ridesRemaining: 0, autoRenew: false, nextPackCode: null });
    expect(after.find((p) => p.id === last.renewedId)).toMatchObject({ packCode: 'pro', status: 'active', ridesRemaining: 50, autoRenew: true, billing: 'to_bill', pricePaidCents: 9900 });
    expect((await notifications(driver.userId, 'pack.renewed'))[0]!.data).toMatchObject({ packCode: 'pro', previousPackCode: 'essential', priceCents: 9900 });
    const view = await request(server()).get('/v1/driver/packs').set(bearer(driver.tokens)).expect(200);
    expect(view.body.active).toMatchObject({ code: 'pro', ridesRemaining: 50, autoRenew: true });
    // Une course non terminée ne consomme rien.
    const { rideId: pending } = await scheduledRide(client);
    await db(app).update(schema.rides).set({ driverId: driver.driverId }).where(eq(schema.rides.id, pending));
    expect((await lifecycle().consume(pending)).consumedFromId).toBeNull();
  });

  it('expiration sans renouvellement : motif « pack expiré » au passage en ligne et hors des offres, report dans les 7 jours à l\'activation suivante', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const pack = await activate(driver, 'essential', false);
    await db(app).update(schema.packPurchases).set({ ridesRemaining: 5, expiresAt: new Date(Date.now() - HOUR) }).where(eq(schema.packPurchases.id, pack.id));
    expect(await lifecycle().blocker(driver.driverId)).toBe('pack_expired');

    const report = await lifecycle().maintenance(new Date(), [driver.driverId]);
    expect(report).toMatchObject({ drivers: 1, expired: 1, renewed: 0, rolledOver: 0 });
    expect((await purchases(driver.driverId))[0]).toMatchObject({ status: 'expired', ridesRemaining: 5, rolloverDone: false });
    expect((await notifications(driver.userId, 'pack.expired'))[0]!.data).toMatchObject({ packCode: 'essential', unusedRides: 5 });
    // Passe rejouée : rien de plus.
    expect(await lifecycle().maintenance(new Date(), [driver.driverId])).toMatchObject({ expired: 0, renewed: 0 });

    // Pack exigé : l'offre ignore ce chauffeur et le passage en ligne donne le motif précis.
    const eligible = async () => (await db(app!).execute(sql`SELECT d.id FROM drivers d WHERE d.id = ${driver.driverId} AND ${driverEligible({ requiredDocuments: [], requireActivePack: true })}`)).length === 1;
    expect(await eligible()).toBe(false);
    const settings = app.get(SettingsService);
    const original = settings.get.bind(settings);
    const spy = vi.spyOn(settings, 'get').mockImplementation(async <T,>(k: string, fallback: T) => (k === 'drivers.require_active_pack' ? (true as T) : original(k, fallback)));
    try {
      const refused = await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates });
      expect(refused.body.details.reasons).toEqual(['pack_expired']);

      // Activation dans le délai : les 5 courses non utilisées sont reportées une seule fois sur le nouveau pack.
      const view = await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'pro', autoRenew: false }).expect(200);
      expect(view.body.active).toMatchObject({ code: 'pro', ridesRemaining: 55 });
      const rows = await purchases(driver.driverId);
      expect(rows.find((p) => p.id === pack.id)).toMatchObject({ ridesRemaining: 0, rolloverDone: true });
      expect(rows.find((p) => p.packCode === 'pro')).toMatchObject({ ridesRemaining: 50, carriedOverRemaining: 5 });
      expect(await eligible()).toBe(true);
      await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates }).expect(200);
      await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'offline' }).expect(200);
    } finally {
      spy.mockRestore();
    }

    // Sans aucun pack : motif « pack à activer » ; épuisé sans renouvellement : « pack épuisé ».
    const bare = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    expect(await lifecycle().blocker(bare.driverId)).toBe('pack_required');
    const used = await activate(bare, 'essential', false);
    await db(app).update(schema.packPurchases).set({ ridesRemaining: 0, status: 'exhausted' }).where(eq(schema.packPurchases.id, used.id));
    expect(await lifecycle().blocker(bare.driverId)).toBe('pack_exhausted');
  });

  it('renouvellement automatique à l\'échéance avec report, Illimité renouvelé, Découverte jamais renouvelé, report clos après 7 jours', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const pack = await activate(driver, 'essential', true);
    await db(app).update(schema.packPurchases).set({ ridesRemaining: 2, expiresAt: new Date(Date.now() - HOUR) }).where(eq(schema.packPurchases.id, pack.id));
    expect(await lifecycle().blocker(driver.driverId)).toBeNull();
    expect(await lifecycle().maintenance(new Date(), [driver.driverId])).toMatchObject({ expired: 1, renewed: 1, rolledOver: 2 });
    const rows = await purchases(driver.driverId);
    expect(rows.find((p) => p.id === pack.id)).toMatchObject({ status: 'expired', ridesRemaining: 0, rolloverDone: true, autoRenew: false });
    expect(rows.find((p) => p.id !== pack.id)).toMatchObject({ packCode: 'essential', status: 'active', ridesRemaining: 25, carriedOverRemaining: 2, autoRenew: true, billing: 'to_bill' });
    expect(await notifications(driver.userId, 'pack.expired')).toHaveLength(0);

    const unlimited = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const u = await activate(unlimited, 'unlimited', true);
    await db(app).update(schema.packPurchases).set({ expiresAt: new Date(Date.now() - HOUR) }).where(eq(schema.packPurchases.id, u.id));
    expect(await lifecycle().maintenance(new Date(), [unlimited.driverId])).toMatchObject({ expired: 1, renewed: 1, rolledOver: 0 });
    const uRows = await purchases(unlimited.driverId);
    expect(uRows.find((p) => p.id !== u.id)).toMatchObject({ packCode: 'unlimited', status: 'active', ridesRemaining: null, autoRenew: true });

    const discovery = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const d = await activate(discovery, 'discovery', true);
    await db(app).update(schema.packPurchases).set({ expiresAt: new Date(Date.now() - HOUR) }).where(eq(schema.packPurchases.id, d.id));
    expect(await lifecycle().maintenance(new Date(), [discovery.driverId])).toMatchObject({ expired: 1, renewed: 0 });
    expect((await purchases(discovery.driverId))[0]).toMatchObject({ status: 'expired', autoRenew: false });
    expect((await notifications(discovery.userId, 'pack.renewal_failed'))[0]!.data).toMatchObject({ packCode: 'discovery', previousPackCode: 'discovery' });
    expect(await lifecycle().blocker(discovery.driverId)).toBe('pack_expired');

    // Au-delà de 7 jours sans nouveau pack, le report est clos : une activation ultérieure ne reçoit rien.
    const late = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const l = await activate(late, 'essential', false);
    await db(app).update(schema.packPurchases).set({ ridesRemaining: 7, expiresAt: new Date(Date.now() - 8 * DAY) }).where(eq(schema.packPurchases.id, l.id));
    await lifecycle().maintenance(new Date(), [late.driverId]);
    expect((await purchases(late.driverId))[0]).toMatchObject({ status: 'expired', ridesRemaining: 7, rolloverDone: true });
    const view = await request(server()).post('/v1/driver/packs/activate').set(bearer(late.tokens)).send({ packCode: 'essential', autoRenew: false }).expect(200);
    expect(view.body.active).toMatchObject({ ridesRemaining: 25 });
  });

  it('Découverte offert aux locataires R-LuxeEV (indicateur du profil)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    // Rang d'inscription hors des premiers chauffeurs : seul l'indicateur rend Découverte gratuit.
    const settings = app.get(SettingsService);
    const original = settings.number.bind(settings);
    const spy = vi.spyOn(settings, 'number').mockImplementation(async (k: string, fallback: number) => (k === 'packs.discovery_free_first_drivers' ? 0 : original(k, fallback)));
    try {
      const before = await request(server()).get('/v1/driver/packs').set(bearer(driver.tokens)).expect(200);
      expect(before.body.catalog[0]).toMatchObject({ code: 'discovery', priceForMeCents: 2900 });
      await db(app).update(schema.drivers).set({ isRLuxeEvTenant: true }).where(eq(schema.drivers.id, driver.driverId));
      const after = await request(server()).get('/v1/driver/packs').set(bearer(driver.tokens)).expect(200);
      expect(after.body.catalog[0]).toMatchObject({ code: 'discovery', priceForMeCents: 0, available: true });
      const activated = await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'discovery', autoRenew: false }).expect(200);
      expect(activated.body.history[0]).toMatchObject({ pricePaidCents: 0, billing: 'free' });
    } finally {
      spy.mockRestore();
    }
  });

  it('promotions : troisième course offerte appliquée d\'office, réservée à la création et rendue à l\'annulation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    // Premier trajet : aucune promotion automatique.
    const first = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(30) }).expect(201);
    expect(first.body.quotes[0].promotionCode).toBeNull();
    const [clientRow] = await db(app).select().from(schema.clients).where(eq(schema.clients.userId, client.user.id));
    await db(app).update(schema.clients).set({ rideCount: 2 }).where(eq(schema.clients.id, clientRow!.id));
    const { rideId, quote } = await scheduledRide(client);
    expect(quote.promotionCode).toBe('BIENVENUE3');
    expect(quote.promotionDiscountCents).toBe(quote.fareCents);
    const uses = () => db(app!).select().from(schema.promotionUses).where(eq(schema.promotionUses.rideId, rideId));
    expect(await uses()).toHaveLength(1);
    expect((await uses())[0]).toMatchObject({ clientId: clientRow!.id, discountCents: quote.fareCents, driverCompensationCents: quote.fareCents });
    const [ride] = await db(app).select({ promotionId: schema.rides.promotionId }).from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(ride!.promotionId).not.toBeNull();
    // Déjà réservée pour ce client : un second devis n'en bénéficie plus.
    const again = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(40) }).expect(201);
    expect(again.body.quotes[0].promotionCode).toBeNull();
    await request(server()).post(`/v1/rides/${rideId}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200);
    expect(await until(uses, (rows) => rows.length === 0)).toHaveLength(0);
    const back = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(40) }).expect(201);
    expect(back.body.quotes[0].promotionCode).toBe('BIENVENUE3');
  });

  it('promotions : code saisi, validation avec motif stable, limite par client, budget', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const code = `T8${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    promotionCodes.push(code);
    const [promotion] = await db(app)
      .insert(schema.promotions)
      .values({ code, name: 'Test 10 %', type: 'percent', value: 1000, conditions: {}, perClientLimit: 1, budgetCents: 100_000, validFrom: new Date(Date.now() - DAY) })
      .returning();
    const client = await loginByOtp(app);

    const unknown = await request(server()).post('/v1/promotions/validate').set(bearer(client)).send({ code: 'NEXISTEPAS' }).expect(200);
    expect(unknown.body).toMatchObject({ valid: false, reason: 'unknown_code', discountCents: null });
    const general = await request(server()).post('/v1/promotions/validate').set(bearer(client)).send({ code: code.toLowerCase() }).expect(200);
    expect(general.body).toMatchObject({ code, valid: true, reason: null, name: 'Test 10 %' });
    expect((await request(server()).post('/v1/promotions/validate').send({ code })).status).toBe(401);
    const badQuote = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(30), options: { promoCode: 'NEXISTEPAS' } });
    expect(badQuote.status).toBe(400);
    expect(badQuote.body.code).toBe('PROMO_CODE_UNKNOWN');

    const { rideId, quote } = await scheduledRide(client, { promoCode: code });
    expect(quote.promotionCode).toBe(code);
    expect(quote.promotionDiscountCents).toBe(Math.round(quote.fareCents * 0.1));
    const [spent] = await db(app).select({ spentCents: schema.promotions.spentCents }).from(schema.promotions).where(eq(schema.promotions.id, promotion!.id));
    expect(spent!.spentCents).toBe(quote.promotionDiscountCents);

    // Limite par client atteinte (usage réservé) : refus au devis et à la validation, avec le motif.
    const limited = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(50), options: { promoCode: code } });
    expect(limited.status).toBe(400);
    expect(limited.body).toMatchObject({ code: 'PROMOTION_NOT_APPLICABLE', details: { code, reason: 'client_limit' } });
    expect((await request(server()).post('/v1/promotions/validate').set(bearer(client)).send({ code })).body).toMatchObject({ valid: false, reason: 'client_limit' });

    // Annulation : usage et budget rendus, le code redevient utilisable ; validation sur un devis précis.
    await request(server()).post(`/v1/rides/${rideId}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200);
    const released = await until(
      async () => (await db(app!).select({ spentCents: schema.promotions.spentCents }).from(schema.promotions).where(eq(schema.promotions.id, promotion!.id)))[0]!.spentCents,
      (value) => value === 0,
    );
    expect(released).toBe(0);
    const fresh = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(50) }).expect(201);
    const onQuote = await request(server()).post('/v1/promotions/validate').set(bearer(client)).send({ code, quoteId: fresh.body.quotes[0].id }).expect(200);
    expect(onQuote.body).toMatchObject({ valid: true, discountCents: Math.round(fresh.body.quotes[0].fareCents * 0.1) });
    const stranger = await loginByOtp(app);
    expect((await request(server()).post('/v1/promotions/validate').set(bearer(stranger)).send({ code, quoteId: fresh.body.quotes[0].id })).status).toBe(404);

    // Budget épuisé.
    await db(app).update(schema.promotions).set({ spentCents: 100_000 }).where(eq(schema.promotions.id, promotion!.id));
    const exhausted = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(50), options: { promoCode: code } });
    expect(exhausted.body).toMatchObject({ code: 'PROMOTION_NOT_APPLICABLE', details: { reason: 'budget_exhausted' } });
    await db(app).update(schema.promotions).set({ spentCents: 0 }).where(eq(schema.promotions.id, promotion!.id));
  });
});
