import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLoadFixtures, LOAD_AREAS, removeLoadFixtures } from '../src/scripts/load-fixtures/fixtures.js';
import { markedIds } from '../src/scripts/seed-e2e/marked-accounts.js';
import type { SeedMarker } from '../src/scripts/seed-e2e/plan.js';
import { bearer, db, startTestApp } from './helpers.js';

/**
 * Comptes des tests de charge (étape 15, tâche 3) : jetons acceptés par l'API, chauffeur éligible au passage en ligne,
 * client qui obtient un devis dans la zone isolée, retrait complet. Marqueur propre à ce fichier.
 */
describe('comptes des tests de charge (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const run = Math.random().toString(36).slice(2, 5).toUpperCase();
  // Préfixes `+199950` à `+199954` : jamais ceux du jeu (55), des comptes de charge (56) ni du test du jeu (57 à 59).
  const marker: SeedMarker = { key: `load-test-${run.toLowerCase()}`, phonePrefix: `+19995${Math.floor(Math.random() * 5)}`, emailDomain: `load-${run.toLowerCase()}.test.neomoov.local`, plateTag: `L${run}`, rideTag: `L${run}` };

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await removeLoadFixtures(app, marker);
    await app?.close();
  });

  it('crée des comptes utilisables par k6 et les retire entièrement', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const server = app.getHttpServer();
    const fixtures = await createLoadFixtures(app, { drivers: 2, clients: 2, area: 'isolated', marker });
    expect(fixtures.drivers).toHaveLength(2);
    expect(fixtures.clients).toHaveLength(2);
    expect(fixtures.areaCenter).toEqual(LOAD_AREAS.isolated.center);
    expect(new Date(fixtures.tokensExpireAt).getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);

    const driver = fixtures.drivers[0]!;
    const online = await request(server).post('/v1/driver/status').set(bearer({ accessToken: driver.token })).send({ status: 'online', coordinates: { lat: driver.lat, lng: driver.lng } });
    expect(online.status).toBe(200);
    expect(online.body).toMatchObject({ status: 'online', vehicleId: driver.vehicleId, category: 'neo_premium' });
    await request(server).post('/v1/driver/status').set(bearer({ accessToken: driver.token })).send({ status: 'offline' }).expect(200);

    const quote = await request(server)
      .post('/v1/quotes')
      .set(bearer({ accessToken: fixtures.clients[0]!.token }))
      .send({ category: 'neo_premium', origin: { address: 'Départ d\'essai', coordinates: LOAD_AREAS.isolated.center }, destination: { address: 'Arrivée d\'essai', coordinates: { lat: 45.705, lng: -73.39 } }, requestedAt: new Date(Date.now() + 3 * 3_600_000).toISOString() });
    expect(quote.status).toBe(201);

    // Relancé : l'essai précédent est retiré d'abord, les comptes repartent de zéro.
    const again = await createLoadFixtures(app, { drivers: 1, clients: 1, area: 'city', marker });
    expect((await markedIds(db(app), marker)).userIds).toHaveLength(2);
    expect(again.drivers[0]!.driverId).not.toBe(driver.driverId);

    const removed = await removeLoadFixtures(app, marker);
    expect(removed).toMatchObject({ users: 2, drivers: 1, clients: 1 });
    expect(await markedIds(db(app), marker)).toEqual({ userIds: [], clientIds: [], driverIds: [], rideIds: [] });
  });
});
