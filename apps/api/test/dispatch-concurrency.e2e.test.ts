import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEventsService } from '../src/common/domain-events.js';
import { bearer, cleanupTestData, createDriver, db, loginByOtp, startTestApp, type TestDriver } from './helpers.js';

/**
 * Défaut révélé par le test de charge (étape 15) : des courses immédiates demandées au même instant passaient ensemble
 * la vérification « sans offre en attente ailleurs » et sollicitaient le même chauffeur ; il n'en acceptait qu'une,
 * l'autre attendait l'expiration de l'offre. Isolement : chauffeurs et courses au nord-est de l'aire de service, loin des
 * positions des autres fichiers, chauffeurs sans terminal (les tests de répartition s'isolent par le terminal).
 */
const AREA = { lat: 45.69, lng: -73.405 };

describe('répartition : demandes simultanées (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const rideIds: string[] = [];
  const drivers: TestDriver[] = [];
  const offers: Array<{ rideId: string; driverId: string }> = [];
  let offBus: (() => void) | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp({ DISPATCH_MODE: 'auto', DISPATCH_TICK_MS: '0', FEATURE_IMMEDIATE_RIDES: 'on', DATABASE_POOL_MAX: '6' });
    if (app) {
      offBus = app.get(DomainEventsService).on('offer.sent', (p) => {
        offers.push({ rideId: p.rideId, driverId: p.driverId });
      });
    }
  });
  afterAll(async () => {
    offBus?.();
    if (app) {
      const database = db(app);
      if (rideIds.length) {
        await database.update(schema.rideDispatches).set({ status: 'cancelled', nextActionAt: null }).where(inArray(schema.rideDispatches.rideId, rideIds));
        await database.update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(inArray(schema.rideOffers.rideId, rideIds), eq(schema.rideOffers.state, 'sent')));
      }
      if (drivers.length) await database.delete(schema.driverPresence).where(inArray(schema.driverPresence.driverId, drivers.map((d) => d.driverId)));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  it('trois courses au même instant : chaque chauffeur reçoit une seule offre et chaque course la sienne', { timeout: 180_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // Comptes d'abord (aucune requête ouverte pendant leur création), puis chauffeurs en ligne au même endroit.
    for (let i = 0; i < 3; i += 1) drivers.push(await createDriver(app));
    const clients = [await loginByOtp(app), await loginByOtp(app), await loginByOtp(app)];
    for (const [i, d] of drivers.entries()) {
      await request(server()).post('/v1/driver/status').set(bearer(d.tokens)).send({ status: 'online', coordinates: { lat: AREA.lat + i * 0.0005, lng: AREA.lng } }).expect(200);
    }
    const quotes: Array<{ id: string; maxConsentedCents: number }> = [];
    for (const c of clients) {
      const res = await request(server())
        .post('/v1/quotes')
        .set(bearer(c))
        .send({ category: 'neo_premium', origin: { address: 'Départ simultané', coordinates: AREA }, destination: { address: 'Arrivée simultanée', coordinates: { lat: AREA.lat + 0.02, lng: AREA.lng + 0.01 } } })
        .expect(201);
      quotes.push(res.body.quotes[0] as { id: string; maxConsentedCents: number });
    }
    const created = await Promise.all(
      clients.map((c, i) =>
        request(server())
          .post('/v1/rides')
          .set(bearer(c))
          .set('Idempotency-Key', `simultane-${Date.now()}-${i}`)
          .send({ quoteId: quotes[i]!.id, type: 'immediate', paymentMethod: 'card_app', paymentChoice: 'prepaid', maxConsentedCents: quotes[i]!.maxConsentedCents }),
      ),
    );
    for (const res of created) {
      expect(res.status).toBe(201);
      rideIds.push(res.body.id as string);
    }
    const mine = () => offers.filter((o) => rideIds.includes(o.rideId));
    for (let waited = 0; waited < 15_000 && new Set(mine().map((o) => o.rideId)).size < 3; waited += 200) await new Promise((resolve) => setTimeout(resolve, 200));

    const pending = await db(app).select({ rideId: schema.rideOffers.rideId, driverId: schema.rideOffers.driverId }).from(schema.rideOffers).where(and(inArray(schema.rideOffers.rideId, rideIds), eq(schema.rideOffers.state, 'sent')));
    const perDriver = new Map<string, number>();
    for (const o of pending) perDriver.set(o.driverId, (perDriver.get(o.driverId) ?? 0) + 1);
    expect([...perDriver.values()].every((n) => n === 1)).toBe(true);
    expect(new Set(pending.map((o) => o.rideId)).size).toBe(3);
    expect(new Set(pending.map((o) => o.driverId))).toEqual(new Set(drivers.map((d) => d.driverId)));
  });
});
