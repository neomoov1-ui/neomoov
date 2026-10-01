import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { PILOT_INFORMATION_VERSION } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainEventsService } from '../src/common/domain-events.js';
import { SettingsService } from '../src/common/settings.service.js';
import { DispatchService } from '../src/modules/rides/dispatch.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Neomoov Pilote (étape 24) : réglages et consentement (Loi 25, art. 12.1), score sur les offres, acceptation automatique
 * par le chemin de l'acceptation manuelle, annulation de grâce sans pénalité, garde-fou de l'animal d'assistance, mode
 * multi-applications, rapport des exclusions de zones et alerte. Répartition en mode manuel : l'offre est créée par le
 * service de répartition existant (`DispatchService.start`). Isolement : courses payées au chauffeur par terminal, que
 * seuls les chauffeurs de ce fichier acceptent ; chacun est retiré (terminal refusé) à la fin de son scénario.
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
/** Ouest de l'île, loin des positions des autres fichiers : course immédiate du mode multi-applications. */
const WEST = { address: 'Départ Pilote ouest', coordinates: { lat: 45.452, lng: -73.81 } };
const WEST_DROP = { address: 'Arrivée Pilote ouest', coordinates: { lat: 45.47, lng: -73.79 } };
const HOUR = 3_600_000;
const key = () => `pilot-${Math.random().toString(36).slice(2, 14)}`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Tokens = Awaited<ReturnType<typeof loginByOtp>>;

describe('Neomoov Pilote (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  const server = () => app!.getHttpServer();
  const reassigned: string[] = [];
  let offBus: (() => void) | null = null;
  let watchedBefore: { value: unknown } | null = null;
  const rideIds: string[] = [];
  const driverIds: string[] = [];

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on' });
    if (!app) return;
    offBus = app.get(DomainEventsService).on('ride.reassign_requested', (p) => {
      reassigned.push(p.rideId);
    });
    const [row] = await db(app).select({ value: schema.settings.value }).from(schema.settings).where(and(eq(schema.settings.key, 'pilot.watched_zones'), eq(schema.settings.scope, 'global')));
    watchedBefore = row ?? null;
    admin = await createStaffAndLogin(app, ['admin']);
  });

  afterAll(async () => {
    offBus?.();
    if (app) {
      const database = db(app);
      if (watchedBefore) await database.update(schema.settings).set({ value: watchedBefore.value as object }).where(and(eq(schema.settings.key, 'pilot.watched_zones'), eq(schema.settings.scope, 'global')));
      else await database.delete(schema.settings).where(and(eq(schema.settings.key, 'pilot.watched_zones'), eq(schema.settings.scope, 'global')));
      app.get(SettingsService).invalidate();
      if (rideIds.length) {
        await database.update(schema.rideDispatches).set({ status: 'cancelled', nextActionAt: null }).where(inArray(schema.rideDispatches.rideId, rideIds));
        await database.update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(inArray(schema.rideOffers.rideId, rideIds), eq(schema.rideOffers.state, 'sent')));
      }
      if (driverIds.length) await database.delete(schema.driverPresence).where(inArray(schema.driverPresence.driverId, driverIds));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  /** Chauffeur actif qui accepte le terminal (seuls ceux de ce fichier reçoivent ces courses). */
  async function driver(): Promise<TestDriver> {
    const created = await createDriver(app!, 'neo_premium', { acceptsTerminal: true });
    driverIds.push(created.driverId);
    return created;
  }

  /** Fin d'un scénario : ses chauffeurs ne reçoivent plus les courses des suivants. */
  async function retire(...drivers: TestDriver[]): Promise<void> {
    const ids = drivers.map((d) => d.driverId);
    await db(app!).update(schema.drivers).set({ acceptsTerminal: false }).where(inArray(schema.drivers.id, ids));
    await db(app!).update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(inArray(schema.rideOffers.driverId, ids), eq(schema.rideOffers.state, 'sent')));
  }

  const pilot = (d: TestDriver, body: Record<string, unknown>) => request(server()).put('/v1/driver/pilot').set(bearer(d.tokens)).send(body);
  const enable = (d: TestDriver, criteria: Record<string, unknown> = {}) => pilot(d, { enabled: true, consentVersion: PILOT_INFORMATION_VERSION, criteria }).expect(200);

  /** Devis puis course payée au chauffeur par terminal ; planifiée (heure demandée) ou immédiate. */
  async function ride(client: Tokens, options: { at?: Date; origin?: typeof PLATEAU; destination?: typeof CENTRE; preferences?: Record<string, unknown> } = {}): Promise<string> {
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({
      category: 'neo_premium', origin: options.origin ?? PLATEAU, destination: options.destination ?? CENTRE, ...(options.at ? { requestedAt: options.at.toISOString() } : {}),
    }).expect(201)).body.quotes[0] as { id: string; maxConsentedCents: number };
    const res = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key()).send({
      quoteId: quote.id, type: options.at ? 'scheduled' : 'immediate', ...(options.at ? { requestedAt: options.at.toISOString() } : {}),
      paymentMethod: 'terminal', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents, ...(options.preferences ? { preferences: options.preferences } : {}),
    });
    if (res.status !== 201) throw new Error(`Course refusée : ${res.status} ${JSON.stringify(res.body)}`);
    rideIds.push(res.body.id as string);
    return res.body.id as string;
  }

  /** Répartition lancée par le service existant (mode manuel des tests), comme une relance de l'opérateur. */
  const dispatch = (rideId: string) => app!.get(DispatchService).start(rideId, { reason: 'operator' });

  async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string, timeoutMs = 15_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (ok(value)) return value;
      if (Date.now() > deadline) throw new Error(`Délai dépassé : ${what} (${JSON.stringify(value)})`);
      await pause(100);
    }
  }

  const rideRow = async (rideId: string) => (await db(app!).select({ state: schema.rides.state, driverId: schema.rides.driverId }).from(schema.rides).where(eq(schema.rides.id, rideId)))[0]!;
  const offerOf = async (rideId: string, driverId: string) => (await db(app!).select().from(schema.rideOffers).where(and(eq(schema.rideOffers.rideId, rideId), eq(schema.rideOffers.driverId, driverId))))[0];
  const decisionOf = async (rideId: string, driverId: string) => (await db(app!).select().from(schema.driverPilotDecisions).where(and(eq(schema.driverPilotDecisions.rideId, rideId), eq(schema.driverPilotDecisions.driverId, driverId))))[0];
  const notices = (userId: string, template: string, field: string, value: string) =>
    db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, userId), eq(schema.notifications.template, template), sql`${schema.notifications.data}->>${field} = ${value}`));
  const events = async (rideId: string) => db(app!).select({ type: schema.rideEvents.type, data: schema.rideEvents.data }).from(schema.rideEvents).where(eq(schema.rideEvents.rideId, rideId));

  it('réglages et consentement : texte d\'information versionné, activation refusée sans consentement à la version courante', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const d = await driver();
    const initial = await request(server()).get('/v1/driver/pilot').set(bearer(d.tokens)).expect(200);
    expect(initial.body).toMatchObject({ available: true, enabled: false, multiAppMode: false, consentCurrent: false, consentAt: null, graceSeconds: expect.any(Number) });
    expect(initial.body.information).toMatchObject({ version: PILOT_INFORMATION_VERSION, title: 'Neomoov Pilote : décision automatisée' });
    expect(initial.body.information.paragraphs.join(' ')).toContain('une autre plateforme');
    expect(initial.body.zones.map((z: { code: string }) => z.code)).toEqual(expect.arrayContaining(['plateau', 'centre-ville', 'yul']));
    const english = await request(server()).get('/v1/driver/pilot').set(bearer(d.tokens)).set('Accept-Language', 'en').expect(200);
    expect(english.body.information.title).toBe('Neomoov Pilot: automated decision');

    const refused = await pilot(d, { enabled: true });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('PILOT_CONSENT_REQUIRED');
    const outdated = await pilot(d, { consentVersion: '2025-01-01' });
    expect(outdated.status).toBe(409);
    expect(outdated.body.code).toBe('PILOT_CONSENT_OUTDATED');
    const unknownZone = await pilot(d, { criteria: { originZones: ['zone-inexistante'] } });
    expect(unknownZone.status).toBe(400);
    expect(unknownZone.body.code).toBe('PILOT_UNKNOWN_ZONE');
    expect((await pilot(d, { criteria: { minFareCents: -5 } })).status).toBe(400);

    const enabled = await enable(d, { minFareCents: 900, maxDurationMinutes: 90 });
    expect(enabled.body).toMatchObject({ enabled: true, consentCurrent: true, consentVersion: PILOT_INFORMATION_VERSION, criteria: { minFareCents: 900, maxDurationMinutes: 90, multiAppMode: false } });
    expect(enabled.body.consentAt).not.toBeNull();
    const off = await pilot(d, { enabled: false }).expect(200);
    expect(off.body).toMatchObject({ enabled: false, consentCurrent: true, criteria: { minFareCents: 900 } });
    const [audit] = await until(() => db(app!).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'pilot.consent_given'), eq(schema.auditLog.entityId, d.driverId))), (rows) => rows.length > 0, 'consentement journalisé');
    expect(audit?.after).toEqual({ version: PILOT_INFORMATION_VERSION });

    // Un client n'a pas accès à l'espace chauffeur.
    const client = await loginByOtp(app);
    expect((await request(server()).get('/v1/driver/pilot').set(bearer(client)).send()).status).toBe(403);
    await retire(d);
  });

  it('acceptation automatique : course attribuée par le chemin de l\'acceptation manuelle, décision enregistrée, avis envoyé ; puis annulation de grâce sans pénalité', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const a = await driver();
    await enable(a, { minFareCents: 500, originZones: ['plateau'], categories: ['neo_premium'] });
    const client = await loginByOtp(app);
    const rideId = await ride(client, { at: new Date(Date.now() + 3 * HOUR) });
    await dispatch(rideId);
    const assigned = await until(() => rideRow(rideId), (r) => r.driverId === a.driverId, 'course attribuée par Pilote');
    expect(assigned.state).toBe('assigned');
    const offer = (await offerOf(rideId, a.driverId))!;
    expect(offer.state).toBe('accepted');
    const decision = await until(() => decisionOf(rideId, a.driverId), (dec) => Boolean(dec?.autoAcceptedAt), 'décision enregistrée');
    expect(decision).toMatchObject({ decision: 'accept', score: 'green', offerId: offer.id, cancelledInGraceAt: null });
    expect(decision!.reasons).toEqual([{ code: 'criteria_met' }]);
    await until(() => notices(a.userId, 'pilot.auto_accepted', 'rideId', rideId), (rows) => rows.length === 1, 'avis Pilote');
    expect(await notices(a.userId, 'offer.new', 'offerId', offer.id)).toHaveLength(0);
    const types = (await events(rideId)).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['offer_sent', 'offer_accepted', 'pilot_auto_accepted']));

    const history = await request(server()).get('/v1/driver/pilot/decisions').set(bearer(a.tokens)).expect(200);
    expect(history.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
    expect(history.body.items[0]).toMatchObject({ rideId, decision: 'accept', score: 'green', ride: { type: 'scheduled' } });
    expect(history.body.items[0].graceEndsAt).not.toBeNull();

    // Hors délai : refus, les règles ordinaires s'appliquent.
    await db(app).update(schema.driverPilotDecisions).set({ autoAcceptedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.driverPilotDecisions.id, decision!.id));
    const late = await request(server()).post(`/v1/driver/rides/${rideId}/pilot-cancel`).set(bearer(a.tokens));
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('PILOT_GRACE_EXPIRED');
    // Dans le délai : sans frais, sans sanction, hors des compteurs de la Charte d'équité ; la course repart en répartition.
    await db(app).update(schema.driverPilotDecisions).set({ autoAcceptedAt: new Date() }).where(eq(schema.driverPilotDecisions.id, decision!.id));
    const cancelled = await request(server()).post(`/v1/driver/rides/${rideId}/pilot-cancel`).set(bearer(a.tokens)).expect(200);
    expect(cancelled.body).toMatchObject({ id: rideId, state: 'requested', driver: null });
    expect(reassigned).toContain(rideId);
    expect((await decisionOf(rideId, a.driverId))!.cancelledInGraceAt).not.toBeNull();
    const cancelEvent = (await events(rideId)).find((e) => e.type === 'driver_cancels');
    expect(cancelEvent?.data).toMatchObject({ reason: 'pilot_grace', source: 'driver', pilotGrace: true });
    expect((await events(rideId)).map((e) => e.type)).toContain('pilot_grace_cancelled');
    expect(await db(app).select().from(schema.sanctions).where(eq(schema.sanctions.driverId, a.driverId))).toHaveLength(0);
    expect(await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'ride.driver_cancellation_after_en_route'), eq(schema.auditLog.entityId, a.driverId)))).toHaveLength(0);
    const [rideAfter] = await db(app).select({ fee: schema.rides.cancellationFeeCents }).from(schema.rides).where(eq(schema.rides.id, rideId));
    expect(rideAfter!.fee).toBe(0);
    expect((await request(server()).post(`/v1/driver/rides/${rideId}/pilot-cancel`).set(bearer(a.tokens))).status).toBe(403);
    await retire(a);
  });

  it('critères qui échouent : rien n\'est accepté, score rouge sur l\'offre ; sans Pilote, score affiché quand même ; animal d\'assistance jamais rejeté', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const f = await driver();
    const n = await driver();
    await enable(f, { minFareCents: 100_000 });
    const client = await loginByOtp(app);
    const rideId = await ride(client, { at: new Date(Date.now() + 5 * HOUR) });
    await dispatch(rideId);
    const decision = await until(() => decisionOf(rideId, f.driverId), (dec) => Boolean(dec), 'décision enregistrée');
    expect(decision).toMatchObject({ decision: 'reject', score: 'red', autoAcceptedAt: null });
    await pause(500);
    expect((await rideRow(rideId)).driverId).toBeNull();
    const offer = (await offerOf(rideId, f.driverId))!;
    expect(offer.state).toBe('sent');
    expect(await notices(f.userId, 'offer.new', 'offerId', offer.id)).toHaveLength(1);
    const offers = await request(server()).get('/v1/driver/offers').set(bearer(f.tokens)).expect(200);
    const mine = (offers.body as Array<{ id: string; pilotScore: { decision: string; score: string; enabled: boolean; autoAccept: boolean; reasons: Array<{ code: string }> } }>).find((o) => o.id === offer.id)!;
    expect(mine.pilotScore).toMatchObject({ decision: 'reject', score: 'red', enabled: true, autoAccept: false });
    expect(mine.pilotScore.reasons.map((r) => r.code)).toContain('fare_below_min');
    // Chauffeur sans Pilote : le score est calculé avec des critères vides, rien n'est accepté pour lui.
    const other = await request(server()).get('/v1/driver/offers').set(bearer(n.tokens)).expect(200);
    const hers = (other.body as Array<{ rideId: string; pilotScore: { decision: string; enabled: boolean; autoAccept: boolean } }>).find((o) => o.rideId === rideId)!;
    expect(hers.pilotScore).toMatchObject({ decision: 'accept', enabled: false, autoAccept: false });
    expect(await decisionOf(rideId, n.driverId)).toBeUndefined();

    // Animal d'assistance : les mêmes critères ne le rejettent jamais (décision manuelle, score jaune).
    await retire(n);
    await db(app).update(schema.rideOffers).set({ state: 'withdrawn' }).where(and(eq(schema.rideOffers.rideId, rideId), eq(schema.rideOffers.state, 'sent')));
    const animalRide = await ride(client, { at: new Date(Date.now() + 8 * HOUR), preferences: { assistanceAnimal: true } });
    await dispatch(animalRide);
    const guarded = await until(() => decisionOf(animalRide, f.driverId), (dec) => Boolean(dec), 'décision avec animal d\'assistance');
    expect(guarded).toMatchObject({ decision: 'manual', score: 'yellow', autoAcceptedAt: null });
    expect((guarded!.reasons as Array<{ code: string; params?: unknown }>).map((r) => r.code)).toEqual(['fare_below_min', 'protected_request']);
    expect((guarded!.reasons as Array<{ code: string; params?: unknown }>).at(-1)).toEqual({ code: 'protected_request', params: { kinds: ['assistance_animal'] } });
    expect((await rideRow(animalRide)).driverId).toBeNull();
    await retire(f);
  });

  it('mode multi-applications : immédiate jamais acceptée (fenêtre de réponse allongée), planifiée acceptée ; agenda chaîné', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const m = await driver();
    await enable(m, { multiAppMode: true });
    expect((await request(server()).get('/v1/driver/pilot').set(bearer(m.tokens)).expect(200)).body).toMatchObject({ multiAppMode: true, multiAppFactor: expect.any(Number) });
    await request(server()).post('/v1/driver/status').set(bearer(m.tokens)).send({ status: 'online', coordinates: WEST.coordinates }).expect(200);
    const client = await loginByOtp(app);
    const immediate = await ride(client, { origin: WEST, destination: WEST_DROP });
    await dispatch(immediate);
    const manual = await until(() => decisionOf(immediate, m.driverId), (dec) => Boolean(dec), 'décision sur l\'immédiate');
    expect(manual).toMatchObject({ decision: 'manual', score: 'yellow', autoAcceptedAt: null });
    expect((manual!.reasons as Array<{ code: string }>).map((r) => r.code)).toContain('multi_app_immediate');
    const offer = (await offerOf(immediate, m.driverId))!;
    expect(offer.state).toBe('sent');
    expect(Math.round((offer.expiresAt.getTime() - offer.sentAt.getTime()) / 1000)).toBe(30);
    expect((await rideRow(immediate)).driverId).toBeNull();
    await request(server()).post(`/v1/driver/offers/${offer.id}/decline`).set(bearer(m.tokens)).expect(200);

    const scheduled = await ride(client, { at: new Date(Date.now() + 11 * HOUR) });
    await dispatch(scheduled);
    await until(() => rideRow(scheduled), (r) => r.driverId === m.driverId, 'planifiée acceptée par Pilote');
    expect((await decisionOf(scheduled, m.driverId))).toMatchObject({ decision: 'accept', score: 'green' });

    const agenda = await request(server()).get(`/v1/driver/agenda?lat=${WEST.coordinates.lat}&lng=${WEST.coordinates.lng}`).set(bearer(m.tokens)).expect(200);
    expect(agenda.body.from).toBe('position');
    const item = (agenda.body.items as Array<{ rideId: string; travelSeconds: number | null; leaveAt: string | null; status: string; conflict: boolean }>).find((i) => i.rideId === scheduled)!;
    expect(item).toMatchObject({ status: 'later', conflict: false });
    expect(item.travelSeconds).toBeGreaterThan(0);
    expect(new Date(item.leaveAt!).getTime()).toBeLessThan(Date.now() + 11 * HOUR);
    expect((await request(server()).get('/v1/driver/agenda').set(bearer(m.tokens)).expect(200)).body.from).toBe('presence');
    expect((await request(server()).get('/v1/driver/agenda?lat=45.5').set(bearer(m.tokens))).status).toBe(400);
    await request(server()).post('/v1/driver/status').set(bearer(m.tokens)).send({ status: 'offline' }).expect(200);
    await retire(m);
  });

  it('coûts et rentabilité nette : revenus des autres plateformes saisis à la main, sans logo', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const d = await driver();
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    expect((await request(server()).get(`/v1/driver/costs/${month}`).set(bearer(d.tokens)).expect(200)).body).toMatchObject({ month, vehicleCents: 0, updatedAt: null });
    const saved = await request(server()).put(`/v1/driver/costs/${month}`).set(bearer(d.tokens)).send({ vehicleCents: 50_000, energyCents: 8000, externalRevenueCents: 120_000 }).expect(200);
    expect(saved.body).toMatchObject({ month, vehicleCents: 50_000, energyCents: 8000, insuranceCents: 0, externalRevenueCents: 120_000 });
    expect((await request(server()).put('/v1/driver/costs/2026-13').set(bearer(d.tokens)).send({})).status).toBe(400);
    const result = await request(server()).get(`/v1/driver/profitability?month=${month}`).set(bearer(d.tokens)).expect(200);
    expect(result.body).toMatchObject({
      month, rides: 0, costsEntered: true, revenue: { neomoovCents: 0, externalCents: 120_000, totalCents: 120_000 },
      costs: { items: { vehicle: 50_000, energy: 8000, insurance: 0 }, packsCents: 0, totalCents: 58_000 }, netCents: 62_000, marginPercent: 51.7, neomoovSharePercent: 0,
    });
    expect((await request(server()).get('/v1/driver/profitability').set(bearer(d.tokens)).expect(200)).body.month).toBe(month);
    await retire(d);
  });

  it('exclusions de zones : rapport de la plateforme et alerte au personnel, une seule fois par zone surveillée', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await db(app).insert(schema.settings).values({ key: 'pilot.watched_zones', scope: 'global', value: ['yul'], description: 'Test Pilote' })
      .onConflictDoUpdate({ target: [schema.settings.key, schema.settings.scope], set: { value: ['yul'] } });
    app.get(SettingsService).invalidate();
    const d = await driver();
    await pilot(d, { criteria: { originZones: ['plateau', 'centre-ville'] } }).expect(200);
    await pilot(d, { criteria: { originZones: ['plateau', 'centre-ville'], minFareCents: 1000 } }).expect(200);
    const markers = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'alert.pilot_zone_exclusion'), eq(schema.auditLog.entityId, d.driverId)));
    expect(markers).toHaveLength(1);
    expect(markers[0]!.after).toMatchObject({ zone: 'yul', origin: true, destination: false });
    expect(await notices(admin.userId, 'alert.pilot_zone_exclusion', 'zone', 'yul')).not.toHaveLength(0);

    const report = await request(server()).get('/v1/admin/pilot/zone-exclusions').set(bearer(admin.tokens)).expect(200);
    expect(report.body.watchedZones).toEqual(['yul']);
    const mine = (report.body.drivers as Array<{ driverId: string; origin: string[]; destination: string[]; watched: string[]; enabled: boolean }>).find((x) => x.driverId === d.driverId)!;
    expect(mine).toMatchObject({ enabled: false, destination: [], watched: ['yul'] });
    expect(mine.origin).toEqual(expect.arrayContaining(['yul', 'vieux-montreal']));
    const yul = (report.body.zones as Array<{ code: string; watched: boolean; drivers: number; origin: number }>).find((z) => z.code === 'yul')!;
    expect(yul.watched).toBe(true);
    expect(yul.drivers).toBeGreaterThanOrEqual(1);
    expect(yul.origin).toBeGreaterThanOrEqual(1);
    expect((report.body.zones as Array<{ code: string }>).map((z) => z.code)).not.toContain('grand-montreal');
    expect((await request(server()).get('/v1/admin/pilot/zone-exclusions').set(bearer(d.tokens))).status).toBe(403);
    await retire(d);
  });
});
