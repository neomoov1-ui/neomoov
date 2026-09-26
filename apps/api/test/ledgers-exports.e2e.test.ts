import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { monthOf, quarterOfMonth } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockStorageProvider } from '../src/adapters/mock/index.js';
import { STORAGE_PROVIDER } from '../src/adapters/types.js';
import { APP_ENV, type AppEnv } from '../src/config/env.js';
import { GeolocationExportService } from '../src/modules/ledgers/geolocation-export.service.js';
import { geolocationKey, pseudonym } from '../src/modules/ledgers/geolocation-format.js';
import { LedgerJobsService } from '../src/modules/ledgers/ledger-jobs.service.js';
import { LedgersService } from '../src/modules/ledgers/ledgers.service.js';
import { PricingRulesService } from '../src/modules/pricing/pricing-rules.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

const TZ = 'America/Toronto';
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `led-${Math.random().toString(36).slice(2, 14)}`;
type Tokens = { accessToken: string; user: { id: string } };

/**
 * Période propre à ce fichier : un trimestre tiré au hasard entre 1990 et 2009, où seules les courses de ce test sont
 * inscrites (les autres fichiers de tests terminent leurs courses aujourd'hui, sur la même base) : les totaux sont exacts.
 */
const YEAR = 1990 + Math.floor(Math.random() * 20);
const QUARTER_INDEX = 1 + Math.floor(Math.random() * 4);
const pad = (n: number) => String(n).padStart(2, '0');
const QUARTER = `${YEAR}-T${QUARTER_INDEX}`;
const M1 = `${YEAR}-${pad(QUARTER_INDEX * 3 - 2)}`;
const M2 = `${YEAR}-${pad(QUARTER_INDEX * 3 - 1)}`;
const M3 = `${YEAR}-${pad(QUARTER_INDEX * 3)}`;
const AFTER_QUARTER = QUARTER_INDEX === 4 ? `${YEAR + 1}-01` : `${YEAR}-${pad(QUARTER_INDEX * 3 + 1)}`;

/** Arrondi au cent, moitié vers le haut : calcul indépendant des taxes attendues. */
const taxOn = (cents: number, ppm: number) => Math.floor((cents * ppm + 500_000) / 1_000_000);

/** Lecture binaire d'une réponse (PDF) : sous Node, superagent passe le flux de la réponse. */
function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const csvRows = (text: string, separator = ';') => text.trim().split('\r\n').map((line) => line.split(separator));

describe('registres de la redevance et des taxes, exports (intégration)', () => {
  let app: NestExpressApplication | null = null;
  const server = () => app!.getHttpServer();
  let finance: StaffSession;
  let operator: StaffSession;
  let client: Tokens;
  let clientId: string;
  let driverA: TestDriver;
  let driverB: TestDriver;
  let rates: { gst: number; qst: number; redevance: number };
  /** Courses insérées directement dans le trimestre du test (sans événement) : A1 et A2 en M1, A3 et B1 en M2. */
  const rides: Record<'a1' | 'a2' | 'a3' | 'b1', { id: string; publicNumber: string }> = {} as never;

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    finance = await createStaffAndLogin(app, ['finance']);
    operator = await createStaffAndLogin(app, ['operator']);
    client = await loginByOtp(app);
    const [clientRow] = await db(app).select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.userId, client.user.id));
    clientId = clientRow!.id;
    driverA = await createDriver(app, 'neo_premium', { acceptsScheduled: false, firstName: 'Registra' });
    driverB = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.drivers).set({ gstNumber: '123456789 RT0001', qstNumber: '1234567890 TQ0001' }).where(eq(schema.drivers.id, driverA.driverId));
    const loaded = await app.get(PricingRulesService).rulesFor('montreal');
    rates = { gst: loaded.rules.gstRatePpm, qst: loaded.rules.qstRatePpm, redevance: loaded.rules.regulatoryFeeCents };
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      await db(app).delete(schema.geolocationExports).where(inArray(schema.geolocationExports.periodStart, [`${M1}-01`, `${M2}-01`]));
      await cleanupTestData(app);
    }
    await app?.close();
  });

  /** Course terminée insérée telle quelle (montants et fin de course imposés), sans passer par l'événement de fin. */
  async function insertCompletedRide(driver: TestDriver, completedAt: string, amounts: { fare: number; promotion?: number; regulatory: number; gst: number; qst: number }, origin = { lat: 45.52345, lng: -73.58234 }) {
    const end = new Date(completedAt);
    const total = amounts.fare - (amounts.promotion ?? 0) + 200 + amounts.regulatory + amounts.gst + amounts.qst;
    const [row] = await db(app!)
      .insert(schema.rides)
      .values({
        publicNumber: `NM-T9C-${Math.random().toString(36).slice(2, 12).toUpperCase()}`, cityCode: 'montreal', clientId, driverId: driver.driverId, vehicleId: driver.vehicleId,
        reservedCategory: 'neo_premium', servedCategory: 'neo_premium', state: 'completed', type: 'scheduled', paymentMethod: 'card_app',
        originAddress: PLATEAU.address, originPosition: origin, destinationAddress: CENTRE.address, destinationPosition: { lat: 45.50012, lng: -73.56789 },
        maxConsentedCents: 100_000, quotedTotalCents: total, finalPriceCents: total, fareCents: amounts.fare, serviceFeeCents: 200, regulatoryFeeCents: amounts.regulatory,
        gstCents: amounts.gst, qstCents: amounts.qst, promotionDiscountCents: amounts.promotion ?? 0, distanceMeters: 8200, durationSeconds: 1100,
        stateTimestamps: { requested: new Date(end.getTime() - 86_400_000).toISOString(), in_progress: new Date(end.getTime() - 1_200_000).toISOString(), completed: end.toISOString() },
      })
      .returning({ id: schema.rides.id, publicNumber: schema.rides.publicNumber });
    return row!;
  }

  const redevanceRows = (rideIds: string[]) => db(app!).select().from(schema.redevanceLedger).where(inArray(schema.redevanceLedger.rideId, rideIds));
  const taxRows = (rideIds: string[]) => db(app!).select().from(schema.taxLedger).where(inArray(schema.taxLedger.rideId, rideIds));

  it('fin de course : une ligne par registre aux montants exacts, période du mois de Montréal, rejouée sans doublon', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const quote = (await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours(), options: {} }).expect(201)).body.quotes[0];
    const ride = (await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: quote.maxConsentedCents }).expect(201)).body as { id: string };
    await request(server()).post(`/v1/admin/rides/${ride.id}/assign`).set(bearer(operator.tokens)).send({ driverId: driverA.driverId }).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(driverA.tokens)).expect(200);
    await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(driverA.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200);

    const [redevance] = await until(() => redevanceRows([ride.id]), (rows) => rows.length === 1, 'ligne de redevance à la fin de course');
    const [taxes] = await until(() => taxRows([ride.id]), (rows) => rows.length === 1, 'ligne de taxes à la fin de course');
    const [row] = await db(app).select().from(schema.rides).where(eq(schema.rides.id, ride.id));
    const completedAt = new Date((row!.stateTimestamps as Record<string, string>)['completed']!);
    const period = monthOf(completedAt, TZ);
    const fare = row!.fareCents!;
    const collected = fare - row!.promotionDiscountCents;
    expect(redevance).toMatchObject({ amountCents: row!.regulatoryFeeCents, remittancePeriod: period, remittedAt: null });
    expect(redevance!.amountCents).toBe(rates.redevance);
    expect(taxes).toMatchObject({
      driverId: driverA.driverId, period,
      fareGstCents: taxOn(fare, rates.gst), fareQstCents: taxOn(fare, rates.qst),
      feeGstCents: row!.gstCents! - taxOn(collected, rates.gst), feeQstCents: row!.qstCents! - taxOn(collected, rates.qst),
    });
    // Toutes les taxes perçues sont réparties : part du chauffeur plus part de Neomoov.
    expect(taxes!.fareGstCents + taxes!.feeGstCents).toBe(row!.gstCents);

    // Rejouée (événement reçu deux fois, tâche relancée, reprise) : rien de plus.
    await app.get(LedgerJobsService).run({ kind: 'ledger', rideId: ride.id });
    expect(await app.get(LedgersService).record(ride.id)).toEqual({ redevance: false, taxes: false });
    expect(await app.get(LedgersService).sweep({ rideIds: [ride.id] })).toEqual({ scanned: 0, redevance: 0, taxes: 0, failed: 0 });
    expect(await redevanceRows([ride.id])).toHaveLength(1);
    expect(await taxRows([ride.id])).toHaveLength(1);
  });

  it('reprise : les courses terminées sans ligne sont comblées (promotion, course offerte, fin de mois à Montréal)', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    rides.a1 = await insertCompletedRide(driverA, `${M1}-15T15:00:00Z`, { fare: 2455, regulatory: 90, gst: 137, qst: 274 });
    // Promotion de 30 % ; terminée le 1er à 03 h 30 UTC : encore le dernier jour de M1 à Montréal.
    rides.a2 = await insertCompletedRide(driverA, `${M2}-01T03:30:00Z`, { fare: 3000, promotion: 900, regulatory: 90, gst: 120, qst: 238 });
    // Course offerte : rien de facturé, la redevance reste due au montant en vigueur.
    rides.a3 = await insertCompletedRide(driverA, `${M2}-10T16:00:00Z`, { fare: 2000, promotion: 2000, regulatory: 0, gst: 0, qst: 0 });
    rides.b1 = await insertCompletedRide(driverB, `${M2}-20T16:00:00Z`, { fare: 1500, regulatory: 90, gst: 90, qst: 179 });
    const ids = Object.values(rides).map((r) => r.id);
    expect(await redevanceRows(ids)).toHaveLength(0);

    const ledgers = app.get(LedgersService);
    expect(await ledgers.sweep({ rideIds: ids })).toEqual({ scanned: 4, redevance: 4, taxes: 4, failed: 0 });
    expect(await ledgers.sweep({ rideIds: ids })).toEqual({ scanned: 0, redevance: 0, taxes: 0, failed: 0 });

    const redevance = new Map((await redevanceRows(ids)).map((r) => [r.rideId, r]));
    expect([rides.a1, rides.a2, rides.a3, rides.b1].map((r) => [redevance.get(r.id)!.remittancePeriod, redevance.get(r.id)!.amountCents])).toEqual([[M1, 90], [M1, 90], [M2, rates.redevance], [M2, 90]]);
    const taxes = new Map((await taxRows(ids)).map((r) => [r.rideId, r]));
    const pick = (id: string) => { const t = taxes.get(id)!; return [t.period, t.driverId, t.fareGstCents, t.fareQstCents, t.feeGstCents, t.feeQstCents]; };
    expect(pick(rides.a1.id)).toEqual([M1, driverA.driverId, 123, 245, 14, 29]);
    expect(pick(rides.a2.id)).toEqual([M1, driverA.driverId, 150, 299, 15, 29]);
    expect(pick(rides.a3.id)).toEqual([M2, driverA.driverId, 100, 200, 0, 0]);
    expect(pick(rides.b1.id)).toEqual([M2, driverB.driverId, 75, 150, 15, 29]);

    // Une ligne perdue dans un seul registre : la reprise la refait, sans toucher à l'autre.
    await db(app).delete(schema.taxLedger).where(eq(schema.taxLedger.rideId, rides.a3.id));
    expect(await ledgers.sweep({ rideIds: ids })).toEqual({ scanned: 1, redevance: 0, taxes: 1, failed: 0 });
    expect(await taxRows([rides.a3.id])).toHaveLength(1);
  });

  it('CSV mensuel et trimestriel : en-têtes, une ligne par course, totaux par mois et du trimestre', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const csv = (type: string, period: string) => request(server()).get(`/v1/admin/ledgers/exports?type=${type}&period=${period}`).set(bearer(finance.tokens));

    const monthly = await csv('redevance', M1).expect(200);
    expect(monthly.headers['content-type']).toContain('text/csv');
    expect(monthly.headers['content-disposition']).toContain(`neomoov-registre-redevance-${M1}.csv`);
    const m1 = csvRows(monthly.text);
    expect(m1[0]).toEqual(['periode', 'course', 'terminee_le', 'chauffeur', 'redevance_cents', 'facturee_client_cents', 'remise_le']);
    expect(m1.slice(1, 3).map((r) => [r[0], r[1], r[4], r[5], r[6]])).toEqual([[M1, rides.a1.publicNumber, '90', '90', ''], [M1, rides.a2.publicNumber, '90', '90', '']]);
    expect(m1[2]![2]).toBe(`${M1}-${new Date(Date.UTC(YEAR, QUARTER_INDEX * 3 - 2, 0)).getUTCDate()} ${m1[2]![2]!.slice(-5)}`);
    expect(m1.slice(3)).toEqual([[`TOTAL ${M1}`, '2', '', '', '180', '180', '']]);

    const quarterly = csvRows((await csv('redevance', QUARTER).expect(200)).text);
    expect(quarterly.filter((r) => r[0]!.startsWith('TOTAL'))).toEqual([
      [`TOTAL ${M1}`, '2', '', '', '180', '180', ''],
      [`TOTAL ${M2}`, '2', '', '', String(rates.redevance + 90), '90', ''],
      [`TOTAL ${M3}`, '0', '', '', '0', '0', ''],
      [`TOTAL ${QUARTER}`, '4', '', '', String(270 + rates.redevance), '270', ''],
    ]);
    expect(quarterly).toHaveLength(1 + 4 + 4);

    const taxes = csvRows((await csv('taxes', QUARTER).expect(200)).text);
    expect(taxes[0]).toEqual(['periode', 'course', 'terminee_le', 'chauffeur', 'tps_chauffeur', 'tvq_chauffeur', 'tarif_cents', 'tps_tarif_cents', 'tvq_tarif_cents', 'tps_frais_cents', 'tvq_frais_cents']);
    const a1 = taxes.find((r) => r[1] === rides.a1.publicNumber)!;
    expect(a1.slice(4)).toEqual(['123456789 RT0001', '1234567890 TQ0001', '2455', '123', '245', '14', '29']);
    expect(taxes.find((r) => r[0] === `TOTAL ${QUARTER}`)).toEqual([`TOTAL ${QUARTER}`, '4', '', '', '', '', '8955', '448', '894', '44', '87']);

    // Période invalide, rôle sans accès aux finances.
    expect((await csv('redevance', `${YEAR}-13`)).status).toBe(400);
    expect((await csv('tps', M1)).status).toBe(400);
    const denied = await request(server()).get(`/v1/admin/ledgers/exports?type=redevance&period=${M1}`).set(bearer(operator.tokens));
    expect(denied.status).toBe(403);
    // Téléchargement journalisé avec l'acteur.
    const [entry] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'ledger.export_downloaded'), eq(schema.auditLog.actorUserId, finance.userId))).orderBy(desc(schema.auditLog.occurredAt)).limit(1);
    expect(entry?.after).toMatchObject({ type: 'taxes', period: QUARTER, format: 'csv' });
  });

  it('mois des registres et remise de la redevance d\'un mois, journalisée ; mois en cours refusé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const months = await request(server()).get(`/v1/admin/ledgers/months?period=${QUARTER}`).set(bearer(finance.tokens)).expect(200);
    expect(months.body.map((m: { period: string }) => m.period)).toEqual([M2, M1]);
    expect(months.body[1]).toEqual({
      period: M1, rideCount: 2, redevanceCents: 180, redevanceBilledCents: 180, remittedCents: 0, unremittedCount: 2, remittedAt: null,
      fareGstCents: 273, fareQstCents: 544, feeGstCents: 29, feeQstCents: 58,
    });

    const remit = (body: Record<string, unknown>) => request(server()).post('/v1/admin/ledgers/redevance/remit').set(bearer(finance.tokens)).send(body);
    const done = await remit({ period: M1, reference: 'RQ-TEST-0001' }).expect(200);
    expect(done.body).toMatchObject({ period: M1, rideCount: 2, amountCents: 180, newlyRemitted: 2, newlyRemittedCents: 180 });
    const again = await remit({ period: M1 }).expect(200);
    expect(again.body).toMatchObject({ newlyRemitted: 0, newlyRemittedCents: 0, remittedAt: done.body.remittedAt });
    const entries = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.action, 'ledger.redevance_remitted'), eq(schema.auditLog.actorUserId, finance.userId))).orderBy(desc(schema.auditLog.occurredAt)).limit(2);
    expect(entries.map((e) => e.after)).toEqual([expect.objectContaining({ period: M1, newlyRemitted: 0, reference: null }), expect.objectContaining({ period: M1, newlyRemitted: 2, newlyRemittedCents: 180, reference: 'RQ-TEST-0001' })]);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const m1 = csvRows((await request(server()).get(`/v1/admin/ledgers/exports?type=redevance&period=${M1}`).set(bearer(finance.tokens)).expect(200)).text);
    expect(m1.slice(1, 3).map((r) => r[6])).toEqual([today, today]);

    // Date de remise indiquée : midi à Montréal ce jour-là.
    const dated = await remit({ period: M2, remittedOn: `${AFTER_QUARTER}-10` }).expect(200);
    expect(dated.body.newlyRemitted).toBe(2);
    const m2 = csvRows((await request(server()).get(`/v1/admin/ledgers/exports?type=redevance&period=${M2}`).set(bearer(finance.tokens)).expect(200)).text);
    expect(m2.slice(1, 3).map((r) => r[6])).toEqual([`${AFTER_QUARTER}-10`, `${AFTER_QUARTER}-10`]);
    expect((await request(server()).get(`/v1/admin/ledgers/months?period=${M2}`).set(bearer(finance.tokens)).expect(200)).body[0]).toMatchObject({ remittedCents: 90 + rates.redevance, unremittedCount: 0 });

    const current = monthOf(new Date(), TZ);
    const open = await remit({ period: current });
    expect(open.status).toBe(409);
    expect(open.body.code).toBe('LEDGER_PERIOD_OPEN');
    const empty = await remit({ period: M3 });
    expect(empty.status).toBe(404);
    expect(empty.body.code).toBe('LEDGER_PERIOD_EMPTY');
    const badDate = await remit({ period: M1, remittedOn: `${M1}-20` });
    expect(badDate.status).toBe(400);
    expect(badDate.body.code).toBe('REMITTANCE_DATE_INVALID');
    expect((await remit({ period: QUARTER })).status).toBe(400);
    expect((await request(server()).post('/v1/admin/ledgers/redevance/remit').set(bearer(operator.tokens)).send({ period: M1 })).status).toBe(403);
  });

  it('rapport de synthèse PDF : produit par la file (mode mémoire), présent dans le stockage simulé, téléchargeable', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const storage = app.get<MockStorageProvider>(STORAGE_PROVIDER);
    const requested = await request(server()).post('/v1/admin/ledgers/summaries').set(bearer(finance.tokens)).send({ type: 'taxes', period: QUARTER }).expect(202);
    expect(requested.body).toMatchObject({ type: 'taxes', period: QUARTER, status: 'ready', error: null, downloadPath: `/admin/ledgers/summaries/taxes/${QUARTER}/pdf` });
    expect(storage.objects.get(`ledgers/summaries/taxes/${QUARTER}.pdf`)?.contentType).toBe('application/pdf');

    const status = await request(server()).get(`/v1/admin/ledgers/summaries/taxes/${QUARTER}`).set(bearer(finance.tokens)).expect(200);
    expect(status.body.status).toBe('ready');
    expect(status.body.generatedAt).toBeTruthy();
    const pdf = await request(server()).get(`/v1/admin/ledgers/summaries/taxes/${QUARTER}/pdf`).set(bearer(finance.tokens)).buffer(true).parse(binary).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    await request(server()).post('/v1/admin/ledgers/summaries').set(bearer(finance.tokens)).send({ type: 'redevance', period: M1 }).expect(202);
    expect(storage.objects.has(`ledgers/summaries/redevance/${M1}.pdf`)).toBe(true);
    const never = await request(server()).get(`/v1/admin/ledgers/summaries/redevance/${M3}`).set(bearer(finance.tokens));
    expect(never.status).toBe(404);
    expect(never.body.code).toBe('LEDGER_SUMMARY_NOT_FOUND');
    expect((await request(server()).get(`/v1/admin/ledgers/summaries/redevance/${M3}/pdf`).set(bearer(finance.tokens))).status).toBe(404);
    expect((await request(server()).post('/v1/admin/ledgers/summaries').set(bearer(finance.tokens)).send({ type: 'taxes', period: `${YEAR}-T5` })).status).toBe(400);
    expect((await request(server()).post('/v1/admin/ledgers/summaries').set(bearer(operator.tokens)).send({ type: 'taxes', period: QUARTER })).status).toBe(403);
  });

  it('rapport trimestriel du chauffeur : le sien seulement, côté chauffeur et côté administration', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const expected = {
      quarter: QUARTER,
      driver: { id: driverA.driverId, name: expect.stringMatching(/^Registra/), gstNumber: '123456789 RT0001', qstNumber: '1234567890 TQ0001' },
      months: [
        { month: M1, rideCount: 2, fareCents: 5455, gstCents: 273, qstCents: 544 },
        { month: M2, rideCount: 1, fareCents: 2000, gstCents: 100, qstCents: 200 },
        { month: M3, rideCount: 0, fareCents: 0, gstCents: 0, qstCents: 0 },
      ],
      totals: { rideCount: 3, fareCents: 7455, gstCents: 373, qstCents: 744 },
    };
    const own = await request(server()).get(`/v1/driver/tax-report?quarter=${QUARTER}`).set(bearer(driverA.tokens)).expect(200);
    expect(own.body).toMatchObject(expected);
    const staff = await request(server()).get(`/v1/admin/ledgers/drivers/${driverA.driverId}/tax-report?quarter=${QUARTER}`).set(bearer(finance.tokens)).expect(200);
    expect(staff.body).toMatchObject(expected);
    const other = await request(server()).get(`/v1/driver/tax-report?quarter=${QUARTER}`).set(bearer(driverB.tokens)).expect(200);
    expect(other.body.totals).toEqual({ rideCount: 1, fareCents: 1500, gstCents: 75, qstCents: 150 });

    // Trimestre en cours par défaut.
    const current = await request(server()).get('/v1/driver/tax-report').set(bearer(driverA.tokens)).expect(200);
    expect(current.body.quarter).toBe(quarterOfMonth(monthOf(new Date(), TZ)));
    // Un chauffeur ne lit jamais le rapport d'un autre ; un client n'a pas de rapport.
    const denied = await request(server()).get(`/v1/admin/ledgers/drivers/${driverB.driverId}/tax-report?quarter=${QUARTER}`).set(bearer(driverA.tokens));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN_ROLE');
    expect((await request(server()).get('/v1/driver/tax-report').set(bearer(client))).status).toBe(403);
    expect((await request(server()).get(`/v1/driver/tax-report?quarter=${M1}`).set(bearer(driverA.tokens))).status).toBe(400);
    const unknown = await request(server()).get(`/v1/admin/ledgers/drivers/00000000-0000-4000-8000-00000000c9c9/tax-report?quarter=${QUARTER}`).set(bearer(finance.tokens));
    expect(unknown.status).toBe(404);
  });

  it('export de géolocalisation : tâche mensuelle, identifiants pseudonymisés et stables, rejouable sans doublon', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const geo = app.get(GeolocationExportService);
    // Le 1er de M2 à Montréal : la tâche produit l'export de M1, puis ne refait rien.
    const first = await geo.runDue(new Date(`${M2}-01T12:00:00Z`));
    expect(first).toMatchObject({ month: M1, status: 'produced', rideCount: 2 });
    const second = await geo.runDue(new Date(`${M2}-01T13:00:00Z`));
    expect(second).toMatchObject({ month: M1, status: 'skipped', exportId: first.exportId });

    const list = await request(server()).get('/v1/admin/geolocation-exports').set(bearer(finance.tokens)).expect(200);
    const item = list.body.find((e: { id: string }) => e.id === first.exportId);
    expect(item).toMatchObject({ period: M1, periodStart: `${M1}-01`, format: 'csv-v0', rideCount: 2, downloadPath: `/admin/geolocation-exports/${first.exportId}/file` });
    expect(item.fileName).toMatch(new RegExp(`^neomoov-geolocalisation-${M1}-\\d{8}T\\d{6}Z\\.csv$`));

    const download = async () => (await request(server()).get(`/v1/admin/geolocation-exports/${first.exportId}/file`).set(bearer(finance.tokens)).expect(200)).text;
    const text = await download();
    const lines = csvRows(text, ',');
    expect(lines[0]).toEqual(['trajet', 'chauffeur', 'vehicule', 'categorie', 'origine_lat', 'origine_lng', 'destination_lat', 'destination_lng', 'prise_en_charge_utc', 'arrivee_utc', 'distance_m', 'duree_s']);
    const secretKey = geolocationKey(app.get<AppEnv>(APP_ENV).ENCRYPTION_KEY!);
    expect(lines.slice(1)).toEqual([
      [pseudonym(secretKey, 'ride', rides.a1.id), pseudonym(secretKey, 'driver', driverA.driverId), pseudonym(secretKey, 'vehicle', driverA.vehicleId), 'neo_premium', '45.523', '-73.582', '45.5', '-73.568', `${M1}-15T14:40:00Z`, `${M1}-15T15:00:00Z`, '8200', '1100'],
      [pseudonym(secretKey, 'ride', rides.a2.id), pseudonym(secretKey, 'driver', driverA.driverId), pseudonym(secretKey, 'vehicle', driverA.vehicleId), 'neo_premium', '45.523', '-73.582', '45.5', '-73.568', `${M2}-01T03:10:00Z`, `${M2}-01T03:30:00Z`, '8200', '1100'],
    ]);
    // Aucun identifiant réel : ni identifiants internes, ni numéros publics, ni adresses.
    for (const secret of [rides.a1.id, rides.a2.id, driverA.driverId, driverA.vehicleId, driverA.userId, clientId, rides.a1.publicNumber, 'Saint-Denis', 'Gauchetière']) expect(text).not.toContain(secret);

    // Lancement manuel : même ligne, fichier remplacé, pseudonymes identiques.
    const manual = await request(server()).post('/v1/admin/geolocation-exports').set(bearer(finance.tokens)).send({ month: M1 }).expect(202);
    expect(manual.body).toMatchObject({ month: M1, format: 'csv-v0', status: 'done', export: { id: first.exportId, rideCount: 2 } });
    const rows = await db(app).select().from(schema.geolocationExports).where(eq(schema.geolocationExports.periodStart, `${M1}-01`));
    expect(rows).toHaveLength(1);
    expect(csvRows(await download(), ',').slice(1).map((l) => l[0])).toEqual(lines.slice(1).map((l) => l[0]));

    const open = await request(server()).post('/v1/admin/geolocation-exports').set(bearer(finance.tokens)).send({ month: monthOf(new Date(), TZ) });
    expect(open.status).toBe(409);
    expect(open.body.code).toBe('GEOLOCATION_PERIOD_OPEN');
    expect((await request(server()).post('/v1/admin/geolocation-exports').set(bearer(finance.tokens)).send({ month: QUARTER })).status).toBe(400);
    expect((await request(server()).get('/v1/admin/geolocation-exports/00000000-0000-4000-8000-00000000c9c9/file').set(bearer(finance.tokens))).status).toBe(404);
  });

  it('droits d\'accès : finances et administrateur seulement ; ni opérateur, ni lecture seule, ni chauffeur, ni client', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const admin = await createStaffAndLogin(app, ['admin']);
    const readonly = await createStaffAndLogin(app, ['readonly']);
    const routes = [
      `/v1/admin/ledgers/exports?type=taxes&period=${M1}`, `/v1/admin/ledgers/months?period=${QUARTER}`, `/v1/admin/ledgers/summaries/taxes/${QUARTER}`,
      `/v1/admin/ledgers/drivers/${driverA.driverId}/tax-report?quarter=${QUARTER}`, '/v1/admin/geolocation-exports',
    ];
    for (const route of routes) {
      await request(server()).get(route).set(bearer(admin.tokens)).expect(200);
      await request(server()).get(route).set(bearer(finance.tokens)).expect(200);
      for (const tokens of [operator.tokens, readonly.tokens, driverA.tokens, client]) {
        const res = await request(server()).get(route).set(bearer(tokens));
        expect(res.status, route).toBe(403);
      }
      expect((await request(server()).get(route)).status, route).toBe(401);
    }
    expect((await request(server()).post('/v1/admin/geolocation-exports').set(bearer(readonly.tokens)).send({ month: M1 })).status).toBe(403);
  });
});
