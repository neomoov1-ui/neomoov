import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { splitTaxDetail, type RideInvoiceView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockSevProvider, MockStorageProvider } from '../src/adapters/mock/index.js';
import { SEV_PROVIDER, STORAGE_PROVIDER } from '../src/adapters/types.js';
import { SettingsService } from '../src/common/settings.service.js';
import { InvoiceJobsService } from '../src/modules/invoicing/invoice-jobs.service.js';
import { InvoicingService } from '../src/modules/invoicing/invoicing.service.js';
import { SevService } from '../src/modules/invoicing/sev.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testPhone, type StaffSession, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const inThreeHours = () => new Date(Date.now() + 3 * 3_600_000).toISOString();
const key = () => `inv-${Math.random().toString(36).slice(2, 14)}`;
const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
type Tokens = { accessToken: string; user: { id: string } };

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('facturation certifiée : factures, numérotation, notes de crédit, SEV, PDF, vérification (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let sev: MockSevProvider;
  let storage: MockStorageProvider;
  let admin: StaffSession;
  const server = () => app!.getHttpServer();
  const invoicing = () => app!.get(InvoicingService);

  beforeAll(async () => {
    app = await startTestApp({ FEATURE_IMMEDIATE_RIDES: 'on' });
    if (!app) return;
    sev = app.get<MockSevProvider>(SEV_PROVIDER);
    storage = app.get<MockStorageProvider>(STORAGE_PROVIDER);
    admin = await createStaffAndLogin(app, ['admin']);
  });
  beforeEach(async () => {
    if (!app) return;
    await resetHttpLimits(app);
    sev.failures = 0;
    sev.healthy = true;
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const invoicesOf = (rideId: string) => db(app!).select().from(schema.invoices).where(eq(schema.invoices.rideId, rideId)).orderBy(asc(schema.invoices.issuedAt), asc(schema.invoices.number));
  const mainInvoice = async (rideId: string) => (await db(app!).select().from(schema.invoices).where(and(eq(schema.invoices.rideId, rideId), isNull(schema.invoices.creditNoteOfId))))[0];
  const transmissionsOf = (invoiceId: string) => db(app!).select().from(schema.sevTransmissions).where(eq(schema.sevTransmissions.invoiceId, invoiceId)).orderBy(asc(schema.sevTransmissions.attempt));

  async function quote(client: Tokens) {
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inThreeHours() }).expect(201);
    return res.body.quotes[0] as { id: string; maxConsentedCents: number };
  }

  function book(client: Tokens, q: { id: string; maxConsentedCents: number }) {
    return request(server())
      .post('/v1/rides')
      .set(bearer(client))
      .set('Idempotency-Key', key())
      .send({ quoteId: q.id, type: 'scheduled', requestedAt: inThreeHours(), paymentChoice: 'prepaid', paymentMethod: 'card_app', maxConsentedCents: q.maxConsentedCents });
  }

  async function assigned(rideId: string, driver: TestDriver) {
    await request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(admin.tokens)).send({ driverId: driver.driverId }).expect(200);
    await until(async () => (await db(app!).select().from(schema.payments).where(eq(schema.payments.rideId, rideId)))[0], (p) => p?.status === 'authorized', 'autorisation');
  }

  /** Course prépayée par carte, attribuée, conduite et terminée par l'API ; renvoie la course, le client et le chauffeur. */
  async function completedRide() {
    const client = await loginByOtp(app!);
    const driver = await createDriver(app!, 'neo_premium', { acceptsScheduled: false, firstName: 'Samuel' });
    await db(app!).update(schema.drivers).set({ gstNumber: '123456789RT0001', qstNumber: '1234567890TQ0001' }).where(eq(schema.drivers.id, driver.driverId));
    const ride = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(ride.id, driver);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${ride.id}/${step}`).set(bearer(driver.tokens)).expect(200);
    const done = (await request(server()).post(`/v1/driver/rides/${ride.id}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100 }).expect(200)).body as { finalPriceCents: number };
    await until(async () => (await db(app!).select().from(schema.payments).where(eq(schema.payments.rideId, ride.id)))[0], (p) => p?.status === 'captured', 'capture à la fin de course');
    return { ride, client, driver, finalPriceCents: done.finalPriceCents };
  }

  /** Courses préparées directement en base pour un chauffeur (numérotation, SEV) : terminées, payées en espèces. */
  async function insertRides(driver: TestDriver, count: number, over: Partial<typeof schema.rides.$inferInsert> = {}) {
    const completedAt = new Date().toISOString();
    const rows = await db(app!)
      .insert(schema.rides)
      .values(Array.from({ length: count }, (_, i) => ({
        publicNumber: `T9B-${RUN}-${Math.random().toString(36).slice(2, 7)}-${i}`, cityCode: 'montreal', guestName: 'Camille Invitée', guestPhone: testPhone(), driverId: driver.driverId, vehicleId: driver.vehicleId,
        reservedCategory: 'neo_premium' as const, state: 'completed' as const, type: 'scheduled' as const, originAddress: PLATEAU.address, originPosition: PLATEAU.coordinates,
        destinationAddress: CENTRE.address, destinationPosition: CENTRE.coordinates, paymentMethod: 'cash' as const, paymentChoice: 'pay_driver_after', maxConsentedCents: 5_000,
        quotedTotalCents: 3_156, finalPriceCents: 3_156, fareCents: 2_455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274,
        distanceMeters: 8_000, durationSeconds: 1_080, stateTimestamps: { completed: completedAt }, ...over,
      })))
      .returning({ id: schema.rides.id });
    return rows.map((r) => r.id);
  }

  it('fin de course : facture complète (5.13), SEV accusé, PDF stocké, courriel en file, idempotente, droits d\'accès', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const pendingRide = (await book(client, await quote(client)).expect(201)).body as { id: string };
    const early = await request(server()).get(`/v1/rides/${pendingRide.id}/invoice`).set(bearer(client));
    expect(early.status).toBe(404);
    expect(early.body.code).toBe('INVOICE_NOT_FOUND');

    const { ride, client: owner, driver, finalPriceCents } = await completedRide();
    const row = await until(() => mainInvoice(ride.id), (i) => Boolean(i?.pdfKey) && i?.sevStatus === 'acknowledged', 'facture émise, transmise et rendue');
    const [rideRow] = await db(app).select().from(schema.rides).where(eq(schema.rides.id, ride.id));

    const view = (await request(server()).get(`/v1/rides/${ride.id}/invoice`).set(bearer(owner)).expect(200)).body as RideInvoiceView;
    const settings = app.get(SettingsService);
    expect(view).toMatchObject({
      id: row!.id, kind: 'ride', rideId: ride.id, supplierSequence: 1, totalCents: finalPriceCents, tipCents: 0, pdfAvailable: true, creditNoteOf: null, creditNotes: [],
      supplier: { driverId: driver.driverId, gstNumber: '123456789RT0001', qstNumber: '1234567890TQ0001' },
      platform: { name: await settings.string('company.legal_name', 'Neomoov') },
      trip: { originAddress: rideRow!.originAddress, destinationAddress: rideRow!.destinationAddress, distanceMeters: rideRow!.distanceMeters, category: 'neo_premium' },
      payment: { method: 'card_app' },
      sev: { status: 'acknowledged' },
    });
    expect(view.number).toMatch(/^NM-\d{7}$/);
    expect(view.supplier.name).toContain('Samuel');
    expect(view.legalNotice.length).toBeGreaterThan(20);
    expect(view.lines.map((l) => l.code)).toEqual(expect.arrayContaining(['base_fare', 'distance', 'duration', 'service_fee', 'regulatory_fee']));
    expect(view.lines.every((l) => l.label.length > 0)).toBe(true);
    // Somme exacte : lignes, TPS et TVQ perçues font le prix final ; détail des taxes par nature de `splitTaxDetail`.
    expect(view.lines.reduce((s, l) => s + l.amountCents, 0) + view.taxes.gstCents + view.taxes.qstCents).toBe(finalPriceCents);
    const detail = splitTaxDetail({
      id: ride.id, status: 'completed', completedAt: new Date(), paymentChannel: 'platform', fareCents: rideRow!.fareCents!, serviceFeeCents: rideRow!.serviceFeeCents!, regulatoryFeeCents: rideRow!.regulatoryFeeCents!,
      gstCents: rideRow!.gstCents!, qstCents: rideRow!.qstCents!, tipCents: 0, tipChannel: 'platform', promotionCompensationCents: rideRow!.promotionDiscountCents, tollCents: rideRow!.tollsCents, cancellationFeeCents: 0,
    }, { gstRatePpm: view.taxes.gstRatePpm, qstRatePpm: view.taxes.qstRatePpm });
    expect({ fare: view.taxes.fare, fee: view.taxes.fee }).toEqual(detail);
    expect(view.taxes).toMatchObject({ gstCents: rideRow!.gstCents, qstCents: rideRow!.qstCents });

    // SEV simulé : vente enregistrée avec le numéro et le total de la facture ; transaction reprise sur la facture.
    const sale = sev.calls.find((c) => c.document.invoiceId === row!.id);
    expect(sale).toMatchObject({ method: 'registerSale', document: { number: view.number, totalCents: finalPriceCents, supplierSequence: 1 } });
    expect(view.sev.transactionId).toMatch(/^sev_mock_/);
    expect(await transmissionsOf(row!.id)).toMatchObject([{ attempt: 1, status: 'acknowledged', adapter: 'mock' }]);

    // PDF produit par la file (mode mémoire) et rangé par l'adaptateur de stockage simulé.
    const stored = storage.objects.get(row!.pdfKey!);
    expect(stored?.contentType).toBe('application/pdf');
    expect(stored!.body.subarray(0, 5).toString()).toBe('%PDF-');
    const pdf = await request(server()).get(`/v1/rides/${ride.id}/invoice/pdf`).set(bearer(owner)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    await request(server()).get(`/v1/admin/invoices/${row!.id}/pdf`).set(bearer(admin.tokens)).expect(200);

    // Courriel au client en file (envoi réel à l'étape 13).
    const [notice] = await db(app).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, owner.user.id), eq(schema.notifications.template, 'invoice.issued')));
    expect(notice).toMatchObject({ channel: 'email', data: { invoiceId: row!.id, number: view.number } });

    // Idempotence : émission rappelée (même événement reçu par un autre processus).
    const again = await invoicing().issueForRide(ride.id);
    expect(again).toMatchObject({ created: false, invoice: { id: row!.id } });
    expect(await invoicesOf(ride.id)).toHaveLength(1);

    // Droits : chauffeur de la course et personnel oui ; un autre client non ; sans jeton, 401.
    expect((await request(server()).get(`/v1/rides/${ride.id}/invoice`).set(bearer(driver.tokens)).expect(200)).body.number).toBe(view.number);
    expect((await request(server()).get(`/v1/rides/${ride.id}/invoice`).set(bearer(admin.tokens)).expect(200)).body.number).toBe(view.number);
    const stranger = await loginByOtp(app);
    const denied = await request(server()).get(`/v1/rides/${ride.id}/invoice`).set(bearer(stranger));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('NOT_OWNER');
    expect((await request(server()).get(`/v1/rides/${ride.id}/invoice/pdf`).set(bearer(stranger))).status).toBe(403);
    expect((await request(server()).get(`/v1/rides/${ride.id}/invoice`)).status).toBe(401);
    expect((await request(server()).get(`/v1/admin/invoices/${row!.id}/pdf`).set(bearer(stranger))).status).toBe(403);
  });

  it('vérification publique : jeton signé valide, jeton altéré ou mal formé refusé', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const [rideId] = await insertRides(driver, 1);
    const { invoice } = (await invoicing().issueForRide(rideId!))!;
    const token = new URL(invoice.qrPayload!).searchParams.get('t')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{44}$/);

    const ok = (await request(server()).get(`/v1/public/invoices/verify/${token}`).expect(200)).body;
    expect(ok).toEqual({ number: invoice.number, kind: 'ride', issuedAt: invoice.issuedAt.toISOString(), supplierName: invoice.supplierName, totalCents: 3_156, sevStatus: 'pending' });

    const flipped = `${token.slice(0, 20)}${token[20] === 'A' ? 'B' : 'A'}${token.slice(21)}`;
    const tampered = await request(server()).get(`/v1/public/invoices/verify/${flipped}`);
    expect(tampered.status).toBe(404);
    expect(tampered.body.code).toBe('INVOICE_NOT_VERIFIED');
    expect((await request(server()).get(`/v1/public/invoices/verify/${token.slice(0, 30)}`)).status).toBe(400);
  });

  it('numérotation sous concurrence : 100 courses terminées traitées en parallèle (et rejouées), aucun trou ni doublon', { timeout: 240_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const rideIds = await insertRides(driver, 100);
    const started = Date.now();
    // Chaque course est émise en parallèle, 20 d'entre elles deux fois en même temps (plusieurs processus, même événement).
    const results = await Promise.all([...rideIds, ...rideIds.slice(0, 20)].map((id) => invoicing().issueForRide(id)));
    const elapsed = Date.now() - started;
    expect(results.filter((r) => r?.created)).toHaveLength(100);

    const rows = await db(app).select().from(schema.invoices).where(inArray(schema.invoices.rideId, rideIds)).orderBy(asc(schema.invoices.supplierSequence));
    expect(rows).toHaveLength(100);
    expect(rows.map((r) => r.supplierSequence)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    const numbers = rows.map((r) => Number(r.number.slice(3)));
    expect(new Set(numbers).size).toBe(100);
    // Même ordre des verrous (global puis fournisseur) : la séquence du fournisseur suit l'ordre des numéros globaux.
    for (let i = 1; i < numbers.length; i += 1) expect(numbers[i]).toBeGreaterThan(numbers[i - 1]!);
    const gaps = numbers.at(-1)! - numbers[0]! + 1 - numbers.length;
    // Ces factures ne sont jamais transmises : retirées ici pour ne pas encombrer la reprise du SEV testée plus loin.
    await db(app).delete(schema.invoices).where(inArray(schema.invoices.rideId, rideIds));
    console.info(`Numérotation sous concurrence : ${results.length} émissions (100 courses, 20 rejouées) en ${elapsed} ms ; séquences du fournisseur 1 à ${rows.at(-1)!.supplierSequence}, sans trou ni doublon ; numéros globaux ${rows[0]!.number} à ${rows.at(-1)!.number} (${gaps} numéros intercalés par d'autres émissions de la base partagée)`);
  });

  it('annulation et non-présentation facturées : facture de frais au chauffeur ; sans frais, aucune facture', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const ride = (await book(client, await quote(client)).expect(201)).body as { id: string };
    await assigned(ride.id, driver);
    await request(server()).post(`/v1/driver/rides/${ride.id}/depart`).set(bearer(driver.tokens)).expect(200);
    const cancelled = (await request(server()).post(`/v1/rides/${ride.id}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200)).body as { feeCents: number };
    expect(cancelled.feeCents).toBeGreaterThan(0);
    const invoice = await until(() => mainInvoice(ride.id), (i) => Boolean(i?.pdfKey), 'facture d\'annulation');
    expect(invoice).toMatchObject({ kind: 'cancellation', totalCents: cancelled.feeCents, fareCents: cancelled.feeCents, serviceFeeCents: 0, gstCents: 0, qstCents: 0, sevStatus: 'acknowledged' });
    const view = (await request(server()).get(`/v1/rides/${ride.id}/invoice`).set(bearer(client)).expect(200)).body as RideInvoiceView;
    expect(view.lines).toEqual([{ code: 'cancellation_fee', label: 'Frais d\'annulation', amountCents: cancelled.feeCents, party: 'driver' }]);
    expect(sev.calls.find((c) => c.document.invoiceId === invoice!.id)?.method).toBe('registerCancellation');

    const [noShow, free, direct] = await insertRides(driver, 3, { state: 'no_show', cancellationFeeCents: 700, finalPriceCents: null, stateTimestamps: { no_show: new Date().toISOString() } });
    await db(app).update(schema.rides).set({ paymentChoice: 'prepaid', paymentMethod: 'card_app' }).where(eq(schema.rides.id, noShow!));
    await db(app).update(schema.rides).set({ state: 'cancelled_by_client', cancellationFeeCents: 0 }).where(eq(schema.rides.id, free!));
    expect((await invoicing().issueForRide(noShow!))?.invoice).toMatchObject({ kind: 'no_show', totalCents: 700 });
    expect(await invoicing().issueForRide(free!)).toBeNull();
    // Payée au chauffeur : frais non encaissés en V1, donc aucune facture de frais (revue finale).
    expect(await invoicing().issueForRide(direct!)).toBeNull();
  });

  it('remboursements : une note de crédit par remboursement (carte puis crédit), montants positifs, rattachée à la facture et au SEV', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const { ride, client, finalPriceCents } = await completedRide();
    const original = await until(() => mainInvoice(ride.id), (i) => i?.sevStatus === 'acknowledged' && Boolean(i?.pdfKey), 'facture de la course');

    await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(admin.tokens)).send({ amountCents: 1_000, reason: 'Retard de 20 minutes' }).expect(201);
    const first = await until(async () => (await invoicesOf(ride.id)).filter((i) => i.kind === 'credit_note'), (l) => l.length === 1 && Boolean(l[0]!.pdfKey), 'première note de crédit');
    expect(first[0]).toMatchObject({ creditNoteOfId: original!.id, totalCents: 1_000, driverId: original!.driverId, sevStatus: 'acknowledged' });
    expect(first[0]!.gstCents + first[0]!.qstCents).toBeGreaterThan(0);
    expect(first[0]!.supplierSequence).toBe(original!.supplierSequence + 1);
    const credit = sev.calls.find((c) => c.document.invoiceId === first[0]!.id);
    expect(credit).toMatchObject({ method: 'registerCredit', document: { original: { number: original!.number, transactionId: original!.sevTransactionId } } });
    expect(credit!.document.lines.every((l) => l.amountCents > 0)).toBe(true);

    const rest = finalPriceCents - 1_000;
    await request(server()).post(`/v1/admin/rides/${ride.id}/refund`).set(bearer(admin.tokens)).send({ amountCents: rest, reason: 'Geste commercial', mode: 'credit' }).expect(201);
    const notes = await until(async () => (await invoicesOf(ride.id)).filter((i) => i.kind === 'credit_note'), (l) => l.length === 2 && l.every((n) => Boolean(n.pdfKey)), 'seconde note de crédit');
    expect(notes.reduce((s, n) => s + n.totalCents, 0)).toBe(finalPriceCents);
    expect(notes.reduce((s, n) => s + n.gstCents, 0)).toBe(original!.gstCents);
    expect(notes.reduce((s, n) => s + n.qstCents, 0)).toBe(original!.qstCents);

    // Rejouer l'événement ne crée pas de seconde note ; la facture montre ses notes de crédit.
    const [refund] = await db(app).select({ id: schema.refunds.id }).from(schema.refunds).innerJoin(schema.payments, eq(schema.payments.id, schema.refunds.paymentId)).where(and(eq(schema.payments.rideId, ride.id), eq(schema.refunds.mode, 'credit')));
    expect((await invoicing().issueCreditNote(refund!.id))?.created).toBe(false);
    const view = (await request(server()).get(`/v1/rides/${ride.id}/invoice`).set(bearer(client)).expect(200)).body as RideInvoiceView;
    expect(view.creditNotes.map((n) => [n.kind, n.totalCents])).toEqual([['credit_note', 1_000], ['credit_note', rest]]);
    const noteView = await invoicing().view(notes[1]!);
    expect(noteView).toMatchObject({ kind: 'credit_note', creditNoteOf: { id: original!.id, number: original!.number }, refund: { mode: 'credit', reason: 'Geste commercial' } });
    const notePdf = await request(server()).get(`/v1/rides/${ride.id}/invoice/pdf`).query({ documentId: notes[1]!.id }).set(bearer(client));
    expect(notePdf.status).toBe(200);
  });

  it('remboursement en attente chez Stripe : note à la confirmation (webhook) ; facture d\'origine non transmise : transmise d\'abord, PDF refait', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    sev.failures = 1;
    const { ride } = await completedRide();
    const original = await until(() => mainInvoice(ride.id), (i) => Boolean(i?.pdfKey) && i?.sevStatus === 'pending', 'facture émise, SEV en panne');
    const firstPdf = storage.objects.get(original!.pdfKey!)!.body;

    const [payment] = await db(app).select().from(schema.payments).where(and(eq(schema.payments.rideId, ride.id), eq(schema.payments.kind, 'ride')));
    const stripeRefundId = `re_pending_${RUN}_${Math.random().toString(36).slice(2, 8)}`;
    const [refund] = await db(app)
      .insert(schema.refunds)
      .values({ paymentId: payment!.id, mode: 'refund', amountCents: 500, reason: 'Remboursement en attente (test)', stripeRefundId, status: 'pending', idempotencyKey: `refund:${ride.id}:${stripeRefundId}` })
      .returning({ id: schema.refunds.id });
    expect(await invoicing().issueCreditNote(refund!.id)).toBeNull();

    const event = { id: `evt_${stripeRefundId}`, type: 'refund.updated', data: { object: { id: stripeRefundId, status: 'succeeded' } } };
    await request(server()).post('/v1/webhooks/stripe').set('stripe-signature', 'mock-signature').set('content-type', 'application/json').send(JSON.stringify(event)).expect(200);
    const [note] = await until(async () => (await invoicesOf(ride.id)).filter((i) => i.kind === 'credit_note'), (l) => l.length === 1 && Boolean(l[0]!.pdfKey) && l[0]!.sevStatus === 'acknowledged', 'note de crédit après confirmation');
    expect(note).toMatchObject({ totalCents: 500, creditNoteOfId: original!.id });
    const transmitted = (await mainInvoice(ride.id))!;
    expect(transmitted).toMatchObject({ sevStatus: 'acknowledged' });
    expect((await transmissionsOf(original!.id)).map((t) => t.status)).toEqual(['error', 'acknowledged']);
    // L'origine, acceptée grâce à la note, a un nouveau PDF (numéro de transaction).
    expect(storage.objects.get(original!.pdfKey!)!.body.equals(firstPdf)).toBe(false);
    const credit = sev.calls.find((c) => c.document.invoiceId === note!.id);
    expect(credit?.document.original).toEqual({ number: original!.number, transactionId: transmitted.sevTransactionId });
  });

  it('SEV : échec puis reprise manuelle, erreur après le nombre maximal de tentatives, reprise périodique, état dans My Hub', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app);
    const [first, second] = await insertRides(driver, 2);
    const jobs = app.get(InvoiceJobsService);

    sev.failures = 1;
    await jobs.run({ kind: 'ride', rideId: first! });
    const pending = (await mainInvoice(first!))!;
    expect(pending).toMatchObject({ sevStatus: 'pending', sevTransactionId: null });
    expect(pending.pdfKey).not.toBeNull();
    expect(await transmissionsOf(pending.id)).toMatchObject([{ attempt: 1, status: 'error', response: { error: 'SEV indisponible (simulation)' } }]);

    const report = (await request(server()).get('/v1/admin/sev/status').set(bearer(admin.tokens)).expect(200)).body;
    expect(report.adapter).toMatchObject({ name: 'mock', healthy: true });
    expect(report.counts.pending).toBeGreaterThanOrEqual(1);
    expect(report.lastErrors).toContainEqual(expect.objectContaining({ invoiceId: pending.id, number: pending.number, attempt: 1, error: 'SEV indisponible (simulation)' }));

    const readonly = await createStaffAndLogin(app, ['readonly']);
    expect((await request(server()).post(`/v1/admin/sev/retry/${pending.id}`).set(bearer(readonly.tokens))).status).toBe(403);
    const retried = (await request(server()).post(`/v1/admin/sev/retry/${pending.id}`).set(bearer(admin.tokens)).expect(200)).body;
    expect(retried).toMatchObject({ invoiceId: pending.id, sevStatus: 'acknowledged', attempts: 2 });
    expect(retried.transactionId).toMatch(/^sev_mock_/);
    const again = await request(server()).post(`/v1/admin/sev/retry/${pending.id}`).set(bearer(admin.tokens));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('SEV_ALREADY_ACKNOWLEDGED');

    // Tentatives épuisées : état `error`, visible ; la reprise périodique la transmet quand le SEV revient.
    const maxAttempts = await app.get(SettingsService).number('sev.max_attempts', 5);
    sev.failures = 1_000;
    await jobs.run({ kind: 'ride', rideId: second! });
    const failing = (await mainInvoice(second!))!;
    for (let i = 1; i < maxAttempts; i += 1) await app.get(SevService).transmit(failing.id);
    expect((await mainInvoice(second!))!.sevStatus).toBe('error');
    expect(await transmissionsOf(failing.id)).toHaveLength(maxAttempts);
    sev.healthy = false;
    const down = (await request(server()).get('/v1/admin/sev/status').set(bearer(readonly.tokens)).expect(200)).body;
    expect(down.adapter).toMatchObject({ healthy: false, detail: 'Panne simulée du SEV' });
    expect(down.counts.error).toBeGreaterThanOrEqual(1);

    sev.failures = 0;
    const accepted = await app.get(SevService).retryDue(new Date(Date.now() + 2 * 3_600_000));
    expect(accepted).toContain(failing.id);
    expect((await mainInvoice(second!))!).toMatchObject({ sevStatus: 'acknowledged' });
    expect(await transmissionsOf(failing.id)).toHaveLength(maxAttempts + 1);
  });
});
