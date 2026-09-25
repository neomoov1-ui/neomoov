import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { benchmarkTimeWindow } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockMapsProvider } from '../src/adapters/mock/index.js';
import { MAPS_PROVIDER } from '../src/adapters/types.js';
import { bearer, cleanupTestData, createStaffAndLogin, db, loginByOtp, startTestApp } from './helpers.js';

// Points dans les zones de départ : Plateau, centre-ville, aéroport (YUL) ; Toronto est hors zone.
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.500, lng: -73.567 } };
const YUL = { address: 'Aéroport international Montréal-Trudeau, Dorval', coordinates: { lat: 45.468, lng: -73.742 } };
const TORONTO = { address: '100 Queen St W, Toronto', coordinates: { lat: 43.653, lng: -79.383 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

describe('devis, lieux et tarification (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('renvoie les trois catégories avec le détail, persiste chaque devis et le relit', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    expect(res.body.estimated).toBe(false);
    expect(res.body.distanceMeters).toBeGreaterThan(1000);
    expect(res.body.quotes.map((q: { category: string }) => q.category)).toEqual(['neo_premium', 'neo_prestige', 'neo_xl']);
    for (const q of res.body.quotes as Array<Record<string, unknown>>) {
      expect(q['id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(q['flatRateCode']).toBeNull();
      expect(q['estimated']).toBe(false);
      expect(q['eta']).toEqual({ seconds: null, status: 'on_availability' });
      const lines = q['lines'] as Array<{ code: string; amountCents: number }>;
      expect(lines.map((l) => l.code)).toEqual(expect.arrayContaining(['base_fare', 'distance', 'duration', 'service_fee', 'regulatory_fee', 'gst', 'qst']));
      expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(q['amountDueCents']);
      expect(q['totalCents']).toBe((q['subtotalCents'] as number) + (q['gstCents'] as number) + (q['qstCents'] as number));
      expect(q['maxConsentedCents']).toBe((q['totalCents'] as number) + 2000);
      expect(new Date(q['validUntil'] as string).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    }
    const first = res.body.quotes[0];
    const read = await request(server()).get(`/v1/quotes/${first.id}`).set(bearer(client)).expect(200);
    expect(read.body.totalCents).toBe(first.totalCents);
    expect(read.body.fingerprint).toBe(first.fingerprint);
    expect(read.body.origin.coordinates.lat).toBeCloseTo(PLATEAU.coordinates.lat, 4);
    const other = await loginByOtp(app);
    const forbidden = await request(server()).get(`/v1/quotes/${first.id}`).set(bearer(other));
    expect(forbidden.status).toBe(403);
    const [row] = await db(app).select({ version: schema.quotes.pricingRulesVersion, zone: schema.quotes.originZoneCode }).from(schema.quotes).where(eq(schema.quotes.id, first.id));
    expect(row!.version).toHaveLength(16);
    expect(row!.zone).toBe('plateau');
  });

  it('applique le préavis de 2 heures (D32) et refuse un trajet hors zone', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const soon = await request(server()).post('/v1/quotes').set(bearer(client)).send({ origin: PLATEAU, destination: CENTRE, requestedAt: new Date(Date.now() + 1_800_000).toISOString() });
    expect(soon.status).toBe(400);
    expect(soon.body.code).toBe('LEAD_TIME_TOO_SHORT');
    expect(soon.body.details.minLeadSeconds).toBe(7200);
    const immediate = await request(server()).post('/v1/quotes').set(bearer(client)).send({ origin: PLATEAU, destination: CENTRE });
    expect(immediate.body.code).toBe('LEAD_TIME_TOO_SHORT');
    const late = await request(server()).post('/v1/quotes').set(bearer(client)).send({ origin: PLATEAU, destination: CENTRE, requestedAt: new Date(Date.now() + 40 * 86_400_000).toISOString() });
    expect(late.body.code).toBe('LEAD_TIME_TOO_LONG');
    const away = await request(server()).post('/v1/quotes').set(bearer(client)).send({ origin: TORONTO, destination: { ...TORONTO, address: 'Union Station, Toronto' }, requestedAt: inThreeHours() });
    expect(away.status).toBe(400);
    expect(away.body.code).toBe('OUT_OF_SERVICE_AREA');
  });

  it('forfait centre-ville et aéroport dans les deux sens, options ignorées', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const go = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: CENTRE, destination: YUL, requestedAt: inThreeHours(), options: { childSeat: true } }).expect(201);
    expect(go.body.quotes).toHaveLength(1);
    expect(go.body.quotes[0]).toMatchObject({ category: 'neo_premium', flatRateCode: 'yul-centre-premium', totalCents: 5500, tollsCents: 0 });
    expect(go.body.quotes[0].lines[0]).toMatchObject({ code: 'flat_rate', label: 'Forfait' });
    expect(go.body.quotes[0].ignoredOptions).toContain('childSeat');
    const back = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_xl', origin: YUL, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    expect(back.body.quotes[0]).toMatchObject({ flatRateCode: 'yul-centre-xl', totalCents: 7500 });
    expect(back.body.quotes[0].lines.find((l: { code: string }) => l.code === 'airport')).toBeUndefined();
  });

  it('promotions : troisième course offerte jusqu\'à 10 km, code de lancement plafonné, code inconnu', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    await db(app).update(schema.clients).set({ rideCount: 2 }).where(eq(schema.clients.userId, client.user.id));
    const free = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours(), options: { promoCode: 'bienvenue3' } }).expect(201);
    const q = free.body.quotes[0];
    expect(q.promotionCode).toBe('BIENVENUE3');
    expect(q.promotionDiscountCents).toBe(q.fareCents);
    expect(q).toMatchObject({ serviceFeeCents: 0, regulatoryFeeCents: 0, gstCents: 0, qstCents: 0, totalCents: 0, amountDueCents: 0 });
    expect(q.lines.find((l: { code: string }) => l.code === 'promotion').amountCents).toBe(-q.fareCents);
    const tooFar = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: YUL, requestedAt: inThreeHours(), options: { promoCode: 'BIENVENUE3' } });
    expect(tooFar.status).toBe(400);
    expect(tooFar.body.code).toBe('PROMOTION_NOT_APPLICABLE');
    const launch = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_prestige', origin: PLATEAU, destination: YUL, requestedAt: inThreeHours(), options: { promoCode: 'LANCEMENT30' } }).expect(201);
    expect(launch.body.quotes[0].promotionDiscountCents).toBe(1500);
    const unknown = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours(), options: { promoCode: 'RIEN' } });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe('PROMO_CODE_UNKNOWN');
  });

  it('mode dégradé : itinéraire estimé en interne quand l\'API Routes échoue, et le client en est informé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const maps = app.get<MockMapsProvider>(MAPS_PROVIDER);
    maps.failRoutes = true;
    try {
      const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
      expect(res.body.estimated).toBe(true);
      expect(res.body.quotes[0].estimated).toBe(true);
      expect(res.body.quotes[0].totalCents).toBeGreaterThan(0);
      const [row] = await db(app).select({ estimated: schema.quotes.estimated }).from(schema.quotes).where(eq(schema.quotes.id, res.body.quotes[0].id));
      expect(row!.estimated).toBe(true);
    } finally {
      maps.failRoutes = false;
    }
  });

  it('vérification concurrentielle (D33) : remise d\'alignement sur les frais de service et événement d\'audit', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['admin']);
    const client = await loginByOtp(app);
    const requestedAt = inThreeHours();
    const timeWindow = benchmarkTimeWindow(new Date(requestedAt), 'America/Toronto');
    const recorded = await request(server())
      .post('/v1/admin/pricing/benchmarks')
      .set(bearer(admin.tokens))
      .send({ category: 'neo_premium', originZoneCode: 'plateau', destinationZoneCode: 'centre-ville', timeWindow, uberPriceCents: 500, lyftPriceCents: 600 })
      .expect(201);
    try {
      const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201);
      const q = res.body.quotes[0];
      expect(q.alignmentDiscountCents).toBe(200);
      expect(q.serviceFeeCents).toBe(0);
      expect(q.lines.find((l: { code: string }) => l.code === 'benchmark_alignment').amountCents).toBe(-200);
      expect(q.lines.find((l: { code: string }) => l.code === 'service_fee').amountCents).toBe(200);
      expect((q.lines as Array<{ amountCents: number }>).reduce((sum, l) => sum + l.amountCents, 0)).toBe(q.amountDueCents);
      expect(res.body.benchmark).toBeUndefined();
      expect(res.body.pricingRulesVersion).toBeUndefined();
      const events = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'pricing.benchmark_exceeded'), eq(schema.auditLog.actorUserId, client.user.id)));
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]!.after).toMatchObject({ category: 'neo_premium', referenceCents: 500 });
      const list = await request(server()).get('/v1/admin/pricing/benchmarks').set(bearer(admin.tokens)).expect(200);
      expect(list.body.some((b: { id: string }) => b.id === recorded.body.id)).toBe(true);
      const badZone = await request(server()).post('/v1/admin/pricing/benchmarks').set(bearer(admin.tokens)).send({ category: 'neo_premium', originZoneCode: 'nulle-part', destinationZoneCode: 'yul', timeWindow, uberPriceCents: 500 });
      expect(badZone.status).toBe(400);
    } finally {
      await request(server()).delete(`/v1/admin/pricing/benchmarks/${recorded.body.id}`).set(bearer(admin.tokens)).expect(204);
    }
  });

  it('temps d\'arrivée estimé à partir des chauffeurs en ligne de la catégorie', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const [driver] = await db(app).select({ id: schema.drivers.id, status: schema.drivers.status }).from(schema.drivers).limit(1);
    if (!driver) return skip('aucun chauffeur de démonstration en base');
    await db(app).update(schema.drivers).set({ status: 'active' }).where(eq(schema.drivers.id, driver.id));
    await db(app).execute(sql`INSERT INTO driver_presence (driver_id, position, category, is_available) VALUES (${driver.id}, ST_SetSRID(ST_MakePoint(-73.59, 45.52), 4326)::geography, 'neo_premium', true)
      ON CONFLICT (driver_id) DO UPDATE SET position = EXCLUDED.position, category = EXCLUDED.category, is_available = true`);
    try {
      const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
      const premium = res.body.quotes.find((q: { category: string }) => q.category === 'neo_premium');
      expect(premium.eta.status).toBe('estimated');
      expect(premium.eta.seconds).toBeGreaterThan(0);
      const xl = res.body.quotes.find((q: { category: string }) => q.category === 'neo_xl');
      expect(xl.eta.status).toBe('on_availability');
    } finally {
      await db(app).execute(sql`DELETE FROM driver_presence WHERE driver_id = ${driver.id}`);
      await db(app).update(schema.drivers).set({ status: driver.status }).where(eq(schema.drivers.id, driver.id));
    }
  });

  it('simulation My Hub : l\'exemple de contrôle (8 km, 18 min) donne 24,55 $ de tarif et 31,56 $ affichés', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const operator = await createStaffAndLogin(app, ['operator']);
    const res = await request(server())
      .post('/v1/admin/pricing/simulate')
      .set(bearer(operator.tokens))
      .send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: '2026-10-06T14:00:00Z', distanceMeters: 8000, durationSeconds: 1080, ignoreLeadTime: true })
      .expect(200);
    expect(res.body.quotes[0]).toMatchObject({ fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274, totalCents: 3156, maxConsentedCents: 5156 });
    expect(res.body.pricingRulesVersion).toHaveLength(16);
    expect(res.body.benchmark[0]).toEqual({ category: 'neo_premium', referenceCents: null, exceeded: false });
    const count = await db(app).select({ n: sql<number>`count(*)::int` }).from(schema.quotes).where(eq(schema.quotes.fingerprint, res.body.quotes[0].fingerprint));
    expect(count[0]!.n).toBe(0);
    const withTolls = await request(server()).post('/v1/admin/pricing/simulate').set(bearer(operator.tokens)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: '2026-10-06T14:00:00Z', distanceMeters: 8000, durationSeconds: 1080, tollsCents: 350, ignoreLeadTime: true }).expect(200);
    expect(withTolls.body.quotes[0].tollsCents).toBe(350);
    expect(withTolls.body.quotes[0].fareCents).toBe(2455);
    const partial = await request(server()).post('/v1/admin/pricing/simulate').set(bearer(operator.tokens)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, distanceMeters: 8000, ignoreLeadTime: true });
    expect(partial.status).toBe(400);
    // Heure fixée en journée (14 h UTC) : la majoration de nuit (23 h à 5 h, heure de Montréal) ne doit pas dépendre de l'heure du test.
    const farAheadAt = new Date(Date.now() + 45 * 86_400_000);
    farAheadAt.setUTCHours(14, 0, 0, 0);
    const farAhead = await request(server()).post('/v1/admin/pricing/simulate').set(bearer(operator.tokens)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: farAheadAt.toISOString(), distanceMeters: 8000, durationSeconds: 1080, ignoreLeadTime: true }).expect(200);
    expect(farAhead.body.quotes[0].fareCents).toBe(2455);
    const rules = await request(server()).get('/v1/admin/pricing/rules').set(bearer(operator.tokens)).expect(200);
    expect(rules.body.rules.categories).toHaveLength(3);
    const zones = await request(server()).get('/v1/admin/pricing/zones').set(bearer(operator.tokens)).expect(200);
    expect(zones.body.map((z: { code: string }) => z.code)).toEqual(expect.arrayContaining(['plateau', 'yul', 'centre-ville']));
  });

  it('lieux : autocomplétion et détails (adaptateur simulé)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const suggestions = await request(server()).get('/v1/places/autocomplete?input=aéroport&lat=45.5&lng=-73.56').set(bearer(client)).expect(200);
    expect(suggestions.body[0]).toEqual({ placeId: 'mock-yul', description: 'Aéroport international Montréal-Trudeau, Dorval, QC' });
    const details = await request(server()).get('/v1/places/details?placeId=mock-yul').set(bearer(client)).expect(200);
    expect(details.body).toMatchObject({ placeId: 'mock-yul', coordinates: { lat: 45.4706, lng: -73.7408 } });
    const short = await request(server()).get('/v1/places/autocomplete?input=a').set(bearer(client));
    expect(short.status).toBe(400);
  });

  it('latence locale : 20 devis d\'une catégorie, mesure du 95e centile (structure prête pour l\'adaptateur réel)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const durations: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const started = performance.now();
      await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)]!;
    console.log(`Latence POST /v1/quotes (adaptateur simulé, base distante) : médiane ${Math.round(durations[9]!)} ms, p95 ${Math.round(p95)} ms`);
    expect(p95).toBeLessThan(3000);
  });
});
