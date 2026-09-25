import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MockStorageProvider } from '../src/adapters/mock/index.js';
import { STORAGE_PROVIDER } from '../src/adapters/types.js';
import { addDays, periodRange } from '../src/modules/drivers/driver-activity.service.js';
import { sniffDocumentType } from '../src/modules/drivers/driver-profile.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, currentPolicyVersion, db, loginByOtp, startTestApp, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `test-${Math.random().toString(36).slice(2, 14)}`;
const inOneYear = () => new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
// Signature JPEG suivie de quelques octets : suffit à la reconnaissance du type (le contenu n'est pas décodé).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const PDF = Buffer.from('%PDF-1.7\n% document de test\n');

describe('espace chauffeur (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  it('reconnaît les fichiers par leur signature et découpe les périodes de Montréal', () => {
    expect(sniffDocumentType(JPEG)).toEqual({ contentType: 'image/jpeg', extension: 'jpg' });
    expect(sniffDocumentType(PDF)).toEqual({ contentType: 'application/pdf', extension: 'pdf' });
    expect(sniffDocumentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.extension).toBe('png');
    expect(sniffDocumentType(Buffer.from('RIFF0000WEBPVP8 '))?.extension).toBe('webp');
    expect(sniffDocumentType(Buffer.from('MZ exécutable'))).toBeNull();
    expect(periodRange('day', '2026-09-25')).toEqual({ from: '2026-09-25', to: '2026-09-25' });
    // Le 25 septembre 2026 est un vendredi : semaine du lundi 21 au dimanche 27 (5.8).
    expect(periodRange('week', '2026-09-25')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(periodRange('week', '2026-09-27')).toEqual({ from: '2026-09-21', to: '2026-09-27' });
    expect(periodRange('month', '2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('parcours 10 : candidature, dossier, véhicule, documents, formation, versements, validation humaine, passage en ligne', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const account = await loginByOtp(app);
    expect((await request(server()).get('/v1/driver/home').set(bearer(account))).status).toBe(403);

    const applied = await request(server()).post('/v1/driver/apply').set(bearer(account)).send({ firstName: 'Awa', lastName: 'Diallo', qualification: 'registered', language: 'fr' }).expect(201);
    expect(applied.body).toMatchObject({ status: 'pending', firstName: 'Awa', qualification: 'registered', paymentModes: { card: true, cash: false }, payout: { linked: false, onboarded: false } });
    expect(applied.body.publicNumber).toMatch(/^CH-\d+/);
    const again = await request(server()).post('/v1/driver/apply').set(bearer(account)).send({ firstName: 'Autre', lastName: 'Nom', qualification: 'saaq_authorized' }).expect(201);
    expect(again.body.id).toBe(applied.body.id);
    // Le jeton renouvelé porte le rôle chauffeur.
    const refreshed = await request(server()).post('/v1/auth/refresh').send({ refreshToken: account.refreshToken }).expect(200);
    const driver = refreshed.body as { accessToken: string; user: { roles: string[] } };
    expect(driver.user.roles).toContain('driver');

    const start = await request(server()).get('/v1/driver/onboarding').set(bearer(driver)).expect(200);
    expect(start.body.next).toBe('profile');
    expect(start.body.steps.find((s: { code: string }) => s.code === 'activation').state).toBe('in_review');

    expect((await request(server()).patch('/v1/driver/profile').set(bearer(driver)).send({ gstNumber: '12345' })).status).toBe(400);
    const interac = await request(server()).patch('/v1/driver/profile').set(bearer(driver)).send({ acceptsInterac: true });
    expect(interac.body.code).toBe('INTERAC_EMAIL_REQUIRED');
    const zone = await request(server()).patch('/v1/driver/profile').set(bearer(driver)).send({ preferredZones: ['nulle-part'] });
    expect(zone.body.code).toBe('UNKNOWN_ZONE');
    const profile = await request(server())
      .patch('/v1/driver/profile')
      .set(bearer(driver))
      .send({ gstNumber: '123456789 RT0001', qstNumber: '1234567890 TQ0001', spokenLanguages: ['fr', 'en', 'wo'], experienceYears: 6, acceptsCash: true, acceptsInterac: true, interacEmail: 'Awa@Example.com', preferredZones: ['plateau'] })
      .expect(200);
    expect(profile.body).toMatchObject({ gstNumber: '123456789RT0001', qstNumber: '1234567890TQ0001', spokenLanguages: ['fr', 'en', 'wo'], experienceYears: 6, paymentModes: { cash: true, interac: true, interacEmail: 'awa@example.com' }, preferredZones: ['plateau'] });
    expect((await request(server()).get('/v1/driver/onboarding').set(bearer(driver)).expect(200)).body.next).toBe('vehicle');

    const models = await request(server()).get('/v1/driver/vehicle-models').set(bearer(driver)).expect(200);
    expect(models.body.map((m: { name: string }) => m.name)).toContain('Tesla Model Y');
    const refused = await request(server()).post('/v1/driver/vehicles').set(bearer(driver)).send({ make: 'Toyota', model: 'Corolla', year: 2024, colour: 'Gris', plate: 'ZZ1 234', seats: 5 });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ code: 'VEHICLE_NOT_ADMITTED', details: { refusal: 'model_not_listed' } });
    const plate = `V${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const vehicle = await request(server()).post('/v1/driver/vehicles').set(bearer(driver)).send({ make: 'Tesla', model: 'Model Y Long Range', year: 2023, colour: 'Blanc', plate, seats: 5, equipment: { childSeat: true } }).expect(201);
    expect(vehicle.body).toMatchObject({ category: 'neo_premium', status: 'pending', current: true, equipment: { childSeat: true, water: true } });
    expect((await request(server()).post('/v1/driver/vehicles').set(bearer(driver)).send({ make: 'Tesla', model: 'Model 3', year: 2023, colour: 'Noir', plate, seats: 5 })).status).toBe(409);

    const docs = await request(server()).get('/v1/driver/documents').set(bearer(driver)).expect(200);
    expect(docs.body.items.every((i: { state: string }) => i.state === 'missing')).toBe(true);
    const types = docs.body.items.map((i: { type: string }) => i.type) as string[];
    expect(types).toEqual(expect.arrayContaining(['profile_photo', 'licence', 'insurance', 'registration']));
    const bad = await request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', 'licence').field('expiresOn', inOneYear()).attach('file', Buffer.from('bonjour'), 'permis.txt');
    expect(bad.status).toBe(415);
    const noExpiry = await request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', 'licence').attach('file', JPEG, 'permis.jpg');
    expect(noExpiry.body.code).toBe('EXPIRY_REQUIRED');
    const expired = await request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', 'licence').field('expiresOn', '2020-01-01').attach('file', JPEG, 'permis.jpg');
    expect(expired.body.code).toBe('DOCUMENT_EXPIRED');
    expect((await request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', 'licence').field('expiresOn', inOneYear())).body.code).toBe('FILE_REQUIRED');
    const expiring = new Set(docs.body.items.filter((i: { expires: boolean }) => i.expires).map((i: { type: string }) => i.type));
    for (const type of types) {
      const upload = request(server()).post('/v1/driver/documents').set(bearer(driver)).field('type', type).field('number', `N-${type}`);
      if (expiring.has(type)) upload.field('expiresOn', inOneYear());
      const res = await upload.attach('file', type === 'background_check' ? PDF : JPEG, type === 'background_check' ? 'antecedents.pdf' : `${type}.jpg`).expect(201);
      expect(res.body).toMatchObject({ type, status: 'pending' });
    }
    const storage = app.get<MockStorageProvider>(STORAGE_PROVIDER);
    expect([...storage.objects.keys()].filter((k) => k.startsWith(`drivers/${applied.body.id}/`))).toHaveLength(types.length);
    const pending = await request(server()).get('/v1/driver/documents').set(bearer(driver)).expect(200);
    expect(pending.body.items.every((i: { state: string }) => i.state === 'pending')).toBe(true);

    // Formation : modules sans les réponses, quiz corrigé par l'API, attestation au dernier module réussi.
    const training = await request(server()).get('/v1/driver/training').set(bearer(driver)).expect(200);
    expect(JSON.stringify(training.body)).not.toContain('answerIndex');
    expect(training.body.modules.length).toBeGreaterThan(0);
    const [setting] = await db(app).select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, 'training.modules'));
    const modules = setting!.value as Array<{ code: string; questions: Array<{ id: string; answerIndex: number; choices: unknown[] }> }>;
    const wrong = Object.fromEntries(modules[0]!.questions.map((q) => [q.id, (q.answerIndex + 1) % q.choices.length]));
    const failed = await request(server()).post(`/v1/driver/training/${modules[0]!.code}/submit`).set(bearer(driver)).send({ answers: wrong }).expect(200);
    expect(failed.body).toMatchObject({ passed: false, scorePct: 0, certifiedAt: null });
    expect(failed.body.missed).toHaveLength(modules[0]!.questions.length);
    expect((await request(server()).post('/v1/driver/training/inconnu/submit').set(bearer(driver)).send({ answers: {} })).status).toBe(404);
    let certifiedAt: string | null = null;
    for (const m of modules) {
      const answers = Object.fromEntries(m.questions.map((q) => [q.id, q.answerIndex]));
      const res = await request(server()).post(`/v1/driver/training/${m.code}/submit`).set(bearer(driver)).send({ answers }).expect(200);
      expect(res.body.passed).toBe(true);
      certifiedAt = res.body.certifiedAt;
    }
    expect(certifiedAt).not.toBeNull();

    // Compte de versement (fournisseur simulé : inscription terminée dès le lien demandé).
    expect((await request(server()).get('/v1/driver/payout').set(bearer(driver)).expect(200)).body).toMatchObject({ linked: false, onboarded: false, provider: 'mock' });
    const link = await request(server()).post('/v1/driver/connect/onboarding-link').set(bearer(driver)).expect(201);
    expect(link.body.simulated).toBe(true);
    expect(link.body.url).toContain('simulated=1');
    expect((await request(server()).get('/v1/driver/payout').set(bearer(driver)).expect(200)).body).toMatchObject({ linked: true, onboarded: true });

    // Avant la validation humaine : passage en ligne refusé, raisons listées.
    const blocked = await request(server()).post('/v1/driver/status').set(bearer(driver)).send({ status: 'online', coordinates: PLATEAU.coordinates });
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.reasons).toEqual(expect.arrayContaining(['driver_status:pending', 'vehicle_status:pending', 'document_missing:licence']));
    expect(blocked.body.details.reasons).not.toContain('training_required');

    // Validation par l'équipe (My Hub, étape 12) simulée en base.
    const database = db(app);
    await database.update(schema.drivers).set({ status: 'active', activatedAt: new Date() }).where(eq(schema.drivers.id, applied.body.id));
    await database.update(schema.vehicles).set({ status: 'active' }).where(eq(schema.vehicles.id, vehicle.body.id));
    await database.update(schema.driverDocuments).set({ status: 'approved', verifiedAt: new Date() }).where(eq(schema.driverDocuments.driverId, applied.body.id));
    const online = await request(server()).post('/v1/driver/status').set(bearer(driver)).send({ status: 'online', coordinates: PLATEAU.coordinates }).expect(200);
    expect(online.body.status).toBe('online');
    const home = await request(server()).get('/v1/driver/home').set(bearer(driver)).expect(200);
    expect(home.body).toMatchObject({ presence: { status: 'online' }, blockers: [], onboarding: { complete: true, next: null }, profile: { firstName: 'Awa', status: 'active' }, features: { faceCheck: false } });
    expect(home.body.earnings.today).toEqual({ fareCents: 0, tipsCents: 0, totalCents: 0, rides: 0 });
    await request(server()).post('/v1/driver/status').set(bearer(driver)).send({ status: 'offline' }).expect(200);
  });

  it('sans formation ou avec la géolocalisation retirée, le passage en ligne est refusé avec la raison', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    await db(app).update(schema.drivers).set({ trainingCertifiedAt: null }).where(eq(schema.drivers.id, driver.driverId));
    const untrained = await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates });
    expect(untrained.body.details.reasons).toEqual(['training_required']);
    const home = await request(server()).get('/v1/driver/home').set(bearer(driver.tokens)).expect(200);
    expect(home.body.alerts.map((a: { code: string }) => a.code)).toContain('training_required');
    await db(app).update(schema.drivers).set({ trainingCertifiedAt: new Date() }).where(eq(schema.drivers.id, driver.driverId));
    const version = await currentPolicyVersion(app);
    await request(server()).post('/v1/me/consents').set(bearer(driver.tokens)).send({ purpose: 'geolocation', granted: true, version }).expect(200);
    await request(server()).post('/v1/me/consents').set(bearer(driver.tokens)).send({ purpose: 'geolocation', granted: false, version }).expect(200);
    const withdrawn = await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates });
    expect(withdrawn.body.details.reasons).toEqual(['geolocation_consent_withdrawn']);
    await request(server()).post('/v1/me/consents').set(bearer(driver.tokens)).send({ purpose: 'geolocation', granted: true, version }).expect(200);
    await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates }).expect(200);
    await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'offline' }).expect(200);
  });

  it('packs : activation immédiate facturée au relevé, changement programmé à l\'épuisement, Découverte une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const view = await request(server()).get('/v1/driver/packs').set(bearer(driver.tokens)).expect(200);
    expect(view.body.active).toBeNull();
    expect(view.body.catalog.map((c: { code: string }) => c.code)).toEqual(['discovery', 'essential', 'pro', 'elite', 'unlimited']);
    const discovery = view.body.catalog[0];
    const activated = await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'discovery' }).expect(200);
    expect(activated.body.active).toMatchObject({ code: 'discovery', ridesRemaining: 10, autoRenew: true });
    expect(activated.body.history[0]).toMatchObject({ pricePaidCents: discovery.priceForMeCents, billing: discovery.priceForMeCents === 0 ? 'free' : 'to_bill' });
    const changed = await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'pro' }).expect(200);
    expect(changed.body.history).toHaveLength(1);
    expect(changed.body.history[0].nextPackCode).toBe('pro');
    const purchaseId = changed.body.history[0].id as string;
    const updated = await request(server()).patch(`/v1/driver/packs/${purchaseId}`).set(bearer(driver.tokens)).send({ autoRenew: false, nextPackCode: null }).expect(200);
    expect(updated.body.active).toMatchObject({ autoRenew: false });
    expect(updated.body.history[0].nextPackCode).toBeNull();
    await db(app).update(schema.packPurchases).set({ status: 'exhausted', ridesRemaining: 0 }).where(eq(schema.packPurchases.id, purchaseId));
    const reuse = await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: 'discovery' });
    expect(reuse.status).toBe(409);
    expect(reuse.body.code).toBe('DISCOVERY_ALREADY_USED');
    const catalog = (await request(server()).get('/v1/driver/packs').set(bearer(driver.tokens)).expect(200)).body.catalog;
    expect(catalog[0].available).toBe(false);
    const other = await createDriver(app);
    expect((await request(server()).patch(`/v1/driver/packs/${purchaseId}`).set(bearer(other.tokens)).send({ autoRenew: true })).status).toBe(404);
  });

  it('fiche de course, paiement direct reçu, évaluation du client, incident, revenus, clients fidèles, tableau de conduite', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    await request(server()).patch('/v1/me').set(bearer(client)).send({ firstName: 'Léa' }).expect(200);
    await request(server()).put('/v1/me/preferences').set(bearer(client)).send({ conversation: 'silence', music: 'soft', temperature: 'cool', luggageHelp: true }).expect(200);
    const driver: TestDriver = await createDriver(app);
    const admin = await createStaffAndLogin(app, ['operator']);
    const quotes = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    const quote = quotes.body.quotes[0] as { id: string; maxConsentedCents: number; totalCents: number };
    const created = await request(server())
      .post('/v1/rides')
      .set(bearer(client))
      .set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents, preferences: { conversation: 'silence', music: 'soft', temperature: 'cool', luggageHelp: true }, specialRequests: 'Deux valises' })
      .expect(201);
    const rideId = created.body.id as string;
    const other = await createDriver(app);
    expect((await request(server()).get(`/v1/driver/rides/${rideId}`).set(bearer(driver.tokens))).status).toBe(403);
    await request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(admin.tokens)).send({ driverId: driver.driverId }).expect(200);
    const card = await request(server()).get(`/v1/driver/rides/${rideId}`).set(bearer(driver.tokens)).expect(200);
    expect(card.body).toMatchObject({ id: rideId, state: 'assigned', job: { clientFirstName: 'Léa', specialRequests: 'Deux valises', paymentChoice: 'pay_driver_after', preferences: { conversation: 'silence', luggageHelp: true }, payment: { direct: true, amountDueCents: null }, clientRated: false, noShow: { availableAt: null } } });
    expect(JSON.stringify(card.body)).not.toContain(client.user.phone);
    expect((await request(server()).get(`/v1/driver/rides/${rideId}`).set(bearer(other.tokens))).status).toBe(403);

    for (const step of ['depart', 'arrive']) await request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(driver.tokens)).expect(200);
    const arrived = await request(server()).get(`/v1/driver/rides/${rideId}`).set(bearer(driver.tokens)).expect(200);
    expect(arrived.body.job.noShow.availableAt).not.toBeNull();
    expect((await request(server()).post(`/v1/driver/rides/${rideId}/payment-received`).set(bearer(driver.tokens)).send({ amountCents: 100 })).body.code).toBe('RIDE_NOT_COMPLETED');
    await request(server()).post(`/v1/driver/rides/${rideId}/start`).set(bearer(driver.tokens)).expect(200);
    const done = await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200);
    const due = done.body.finalPriceCents as number;

    const paid = await request(server()).post(`/v1/driver/rides/${rideId}/payment-received`).set(bearer(driver.tokens)).send({ amountCents: due }).expect(200);
    expect(paid.body.job.payment).toEqual({ direct: true, amountDueCents: due, confirmedCents: due });
    const short = await request(server()).post(`/v1/driver/rides/${rideId}/payment-received`).set(bearer(driver.tokens)).send({ amountCents: due - 500 }).expect(200);
    expect(short.body.job.payment.confirmedCents).toBe(due - 500);
    const incidents = await db(app).select().from(schema.incidents).where(eq(schema.incidents.rideId, rideId));
    expect(incidents.some((i) => i.description.startsWith('Écart de paiement direct'))).toBe(true);
    const [payment] = await db(app).select().from(schema.payments).where(eq(schema.payments.rideId, rideId));
    expect(payment).toMatchObject({ status: 'paid_direct', collectedBy: 'driver', driverConfirmedCents: due - 500 });

    const rated = await request(server()).post(`/v1/driver/rides/${rideId}/rate`).set(bearer(driver.tokens)).send({ score: 5, tags: ['polite', 'punctual'] }).expect(200);
    expect(rated.body.job.clientRated).toBe(true);
    await request(server()).post(`/v1/driver/rides/${rideId}/rate`).set(bearer(driver.tokens)).send({ score: 1 }).expect(200);
    const [rating] = await db(app).select().from(schema.rideRatings).where(and(eq(schema.rideRatings.rideId, rideId), eq(schema.rideRatings.authorKind, 'driver')));
    expect(rating!.score).toBe(5);
    const incident = await request(server()).post(`/v1/driver/rides/${rideId}/incident`).set(bearer(driver.tokens)).send({ kind: 'lost_item', description: 'Parapluie oublié sur la banquette' }).expect(201);
    expect(incident.body.status).toBe('open');

    const earnings = await request(server()).get('/v1/driver/earnings?period=week').set(bearer(driver.tokens)).expect(200);
    expect(earnings.body.totals.rides).toBe(1);
    expect(earnings.body.items[0]).toMatchObject({ rideId, kind: 'ride', collectedBy: 'driver', paymentMethod: 'cash' });
    expect(earnings.body.totals.totalCents).toBe(earnings.body.totals.fareCents + earnings.body.totals.tipsCents);
    expect(earnings.body.collectedDirectCents).toBe(due);
    expect((await request(server()).get('/v1/driver/earnings?period=year').set(bearer(driver.tokens))).status).toBe(400);
    const home = await request(server()).get('/v1/driver/home').set(bearer(driver.tokens)).expect(200);
    expect(home.body.earnings.today.rides).toBe(1);

    // Une deuxième course avec le même client en fait un client fidèle (D38) ; le favori passe devant.
    await db(app).update(schema.clientDriverLinks).set({ ridesCount: 2 }).where(eq(schema.clientDriverLinks.driverId, driver.driverId));
    const loyal = await request(server()).get('/v1/driver/loyal-clients').set(bearer(driver.tokens)).expect(200);
    expect(loyal.body).toEqual([expect.objectContaining({ firstName: 'Léa', ridesCount: 2, favourite: false })]);

    // Positions simulées aujourd'hui : un démarrage brusque puis un freinage brusque.
    const t0 = Date.now() - 600_000;
    const points = [[0, 0], [5, 15], [10, 28], [15, 28], [20, 12], [25, 0]] as const;
    for (const [s, v] of points) {
      await db(app).execute(sql`INSERT INTO driver_locations (driver_id, position, speed_mps, recorded_at) VALUES (${driver.driverId}, ST_SetSRID(ST_MakePoint(-73.58, ${45.5 + s * 0.0001}), 4326)::geography, ${v}, ${new Date(t0 + s * 1000).toISOString()})`);
    }
    const score = await request(server()).get('/v1/driver/score').set(bearer(driver.tokens)).expect(200);
    expect(score.body).toMatchObject({ harshAccelerations: 1, harshBrakings: 1, completedRides: 1, cancellationCount: 0, punctualityPct: expect.any(Number) });
    expect(score.body.suggestions.length).toBeGreaterThan(0);
    const again = await request(server()).get('/v1/driver/score').set(bearer(driver.tokens)).expect(200);
    expect(again.body.harshBrakings).toBe(1);
  });

  it('relevés : seuls les relevés émis, lignes signées renvoyant à leur course', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const database = db(app);
    const [draft] = await database.insert(schema.weeklyStatements).values({ driverId: driver.driverId, periodStart: '2026-08-31', periodEnd: '2026-09-06', status: 'draft' }).returning();
    const [issued] = await database
      .insert(schema.weeklyStatements)
      .values({ driverId: driver.driverId, periodStart: '2026-09-07', periodEnd: '2026-09-13', status: 'issued', creditsCents: 5000, debitsCents: 1200, netCents: 3800, issuedAt: new Date() })
      .returning();
    await database.insert(schema.statementLines).values([
      { statementId: issued!.id, kind: 'ride_fare_platform', amountCents: 5000, label: 'Tarif de la course', occurredAt: new Date('2026-09-08T14:00:00Z') },
      { statementId: issued!.id, kind: 'pack_billed', amountCents: 1200, label: 'Pack Pro', occurredAt: new Date('2026-09-07T10:00:00Z') },
    ]);
    const list = await request(server()).get('/v1/driver/statements').set(bearer(driver.tokens)).expect(200);
    expect(list.body.map((s: { id: string }) => s.id)).toEqual([issued!.id]);
    const detail = await request(server()).get(`/v1/driver/statements/${issued!.id}`).set(bearer(driver.tokens)).expect(200);
    expect(detail.body.lines.map((l: { amountCents: number }) => l.amountCents)).toEqual([-1200, 5000]);
    expect((await request(server()).get(`/v1/driver/statements/${draft!.id}`).set(bearer(driver.tokens))).status).toBe(404);
    const other = await createDriver(app);
    expect((await request(server()).get(`/v1/driver/statements/${issued!.id}`).set(bearer(other.tokens))).status).toBe(404);
    await database.delete(schema.weeklyStatements).where(eq(schema.weeklyStatements.driverId, driver.driverId));
  });

  it('vérification faciale masquée derrière le drapeau', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const res = await request(server()).post('/v1/driver/shifts/start').set(bearer(driver.tokens)).send({ photoBase64: JPEG.toString('base64') }).expect(200);
    expect(res.body).toEqual({ shiftId: null, faceCheck: 'disabled', startedAt: null });
  });
});
