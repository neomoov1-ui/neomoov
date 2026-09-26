import 'reflect-metadata';
import { schema } from '@neomoov/db';
import { buildStatement, classifyRideForStatement, mulDivRound, packBillingLines, splitTaxes, type SettlementRide, type StatementLine, type TaxRates, type TokensView } from '@neomoov/domain';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SettlementJobsService } from '../src/modules/settlement/settlement-jobs.service.js';
import { SettlementPayoutsService } from '../src/modules/settlement/settlement-payouts.service.js';
import { StatementsService } from '../src/modules/settlement/statements.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const key = () => `test-${Math.random().toString(36).slice(2, 14)}`;

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (ok(value) || Date.now() - started > timeoutMs) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface RideSpec {
  at: string;
  direct?: boolean;
  state?: 'completed' | 'no_show';
  fareCents?: number;
  tipCents?: number;
  promotionCents?: number;
  cancellationFeeCents?: number;
  guarantee?: 'validated';
  protectedFare?: boolean;
}

describe('règlement hebdomadaire (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let staff: StaffSession;
  let client: TokensView;
  let rates: TaxRates;
  let hour = 3;
  const server = () => app!.getHttpServer();

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    staff = await createStaffAndLogin(app, ['finance']);
    client = await loginByOtp(app);
    rates = await app.get(StatementsService).rates();
  });
  afterAll(async () => {
    if (app) await cleanupTestData(app);
    await app?.close();
  });

  const statements = () => app!.get(StatementsService);
  const payouts = () => app!.get(SettlementPayoutsService);

  /** Montants d'une course de test : taxes calculées comme au devis sur le sous-total. */
  function amounts(spec: RideSpec): SettlementRide {
    const fare = spec.fareCents ?? 2_000;
    const subtotal = fare - (spec.promotionCents ?? 0) + 200 + 90;
    const completed = (spec.state ?? 'completed') === 'completed';
    return {
      id: '', status: completed ? 'completed' : 'no_show', completedAt: new Date(spec.at), paymentChannel: spec.direct ? 'direct' : 'platform',
      fareCents: completed ? fare : 0, serviceFeeCents: completed ? 200 : 0, regulatoryFeeCents: completed ? 90 : 0,
      gstCents: completed ? mulDivRound(subtotal, rates.gstRatePpm, 1_000_000) : 0, qstCents: completed ? mulDivRound(subtotal, rates.qstRatePpm, 1_000_000) : 0,
      tipCents: spec.tipCents ?? 0, tipChannel: 'platform', promotionCompensationCents: spec.promotionCents ?? 0, tollCents: 0, cancellationFeeCents: spec.cancellationFeeCents ?? 0,
    };
  }

  /** Course planifiée créée par l'API, puis terminée (ou non-présentation) à la date voulue, écrite en base. */
  async function ride(driver: TestDriver, spec: RideSpec): Promise<{ id: string; settlement: SettlementRide }> {
    hour += 2;
    const requestedAt = new Date(Date.now() + hour * 3_600_000).toISOString();
    const quotes = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt }).expect(201);
    const quote = quotes.body.quotes[0] as { id: string; maxConsentedCents: number };
    const created = await request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key())
      .send({ quoteId: quote.id, type: 'scheduled', requestedAt, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: quote.maxConsentedCents }).expect(201);
    const id = created.body.id as string;
    const s = amounts(spec);
    const state = spec.state ?? 'completed';
    await db(app!).update(schema.rides).set({
      state, driverId: driver.driverId, paymentChoice: spec.direct ? 'pay_driver_after' : 'prepaid', paymentMethod: spec.direct ? 'cash' : 'card_app',
      fareCents: s.fareCents, serviceFeeCents: s.serviceFeeCents, regulatoryFeeCents: s.regulatoryFeeCents, gstCents: s.gstCents, qstCents: s.qstCents, tipCents: s.tipCents,
      promotionDiscountCents: s.promotionCompensationCents, cancellationFeeCents: s.cancellationFeeCents, guaranteeOutcome: spec.guarantee ?? null, driverFareProtected: spec.protectedFare ?? false,
      stateTimestamps: { [state]: spec.at },
    }).where(eq(schema.rides.id, id));
    return { id, settlement: { ...s, id } };
  }

  /** Pack à facturer, activé à la date voulue. */
  async function pack(driver: TestDriver, code: 'essential' | 'elite', activatedAt: string) {
    await request(server()).post('/v1/driver/packs/activate').set(bearer(driver.tokens)).send({ packCode: code, autoRenew: false }).expect(200);
    const [row] = await db(app!).select().from(schema.packPurchases).where(eq(schema.packPurchases.driverId, driver.driverId));
    await db(app!).update(schema.packPurchases).set({ activatedAt: new Date(activatedAt), billing: 'to_bill' }).where(eq(schema.packPurchases.id, row!.id));
    return row!;
  }

  const sortLines = (lines: Array<{ kind: string; amountCents: number }>) => lines.map((l) => `${l.kind}:${l.amountCents}`).sort();

  it('relevé complet : lignes du moteur de règlement, aperçu sans écriture, ajustement gardé, émission immuable, PDF', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const other = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const card = await ride(driver, { at: '2026-06-02T15:00:00Z', tipCents: 300 });
    const cash = await ride(driver, { at: '2026-06-03T18:30:00Z', direct: true, fareCents: 1_500 });
    const promo = await ride(driver, { at: '2026-06-04T12:00:00Z', promotionCents: 600 });
    const noShow = await ride(driver, { at: '2026-06-05T20:00:00Z', state: 'no_show', cancellationFeeCents: 500 });
    const guarantee = await ride(driver, { at: '2026-06-06T14:00:00Z', guarantee: 'validated' });
    await ride(driver, { at: '2026-06-08T09:00:00Z' }); // lundi suivant : relevé suivant
    await ride(other, { at: '2026-06-03T10:00:00Z' });
    const purchase = await pack(driver, 'essential', '2026-06-01T13:00:00Z');
    await db(app).insert(schema.credits).values({ userId: driver.userId, amountCents: 5_000, remainingCents: 5_000, origin: 'driver_pack', note: 'Crédit de pack', expiresAt: new Date(Date.now() + 86_400_000 * 300) });

    const expected: StatementLine[] = [card, cash, promo, noShow, guarantee].flatMap((r) => classifyRideForStatement(r.settlement, rates));
    expected.push({ kind: 'adjustment_negative', amountCents: guarantee.settlement.fareCents + splitTaxes(guarantee.settlement, rates).fareTaxesCents, occurredAt: new Date() });
    const packLines = packBillingLines(purchase.id, 5_900, new Date(), rates, 'Pack');
    expected.push(...packLines, { kind: 'referral_credit', amountCents: 5_000, occurredAt: new Date() });
    const expectedStatement = buildStatement(driver.driverId, { startDate: '2026-06-01', endDate: '2026-06-07', timeZone: 'America/Toronto' }, expected);

    // Aperçu : les mêmes lignes, rien d'enregistré.
    const preview = await request(server()).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: '2026-06-01', driverId: driver.driverId, preview: true }).expect(200);
    expect(preview.body).toMatchObject({ periodStart: '2026-06-01', periodEnd: '2026-06-07', preview: true, generated: 1 });
    expect(sortLines(preview.body.statements[0].lines.map((l: { kind: string; amountCents: number }) => ({ kind: l.kind, amountCents: Math.abs(l.amountCents) })))).toEqual(sortLines(expected));
    expect(preview.body.statements[0]).toMatchObject({ id: null, netCents: expectedStatement.netCents, creditsCents: expectedStatement.creditsCents, debitsCents: expectedStatement.debitsCents });
    expect(await db(app).select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.driverId, driver.driverId))).toHaveLength(0);

    const draft = (await request(server()).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: '2026-06-01', driverId: driver.driverId }).expect(200)).body.statements[0];
    expect(draft).toMatchObject({ status: 'draft', netCents: expectedStatement.netCents });
    const lines = await db(app).select().from(schema.statementLines).where(eq(schema.statementLines.statementId, draft.id));
    expect(lines.filter((l) => l.rideId === card.id).map((l) => l.label)).toContain(`Tarif de la course · ${(await db(app).select({ n: schema.rides.publicNumber }).from(schema.rides).where(eq(schema.rides.id, card.id)))[0]!.n}`);

    // Ajustement motivé sur le brouillon, gardé quand le brouillon est recalculé.
    const adjusted = await request(server()).post(`/v1/admin/statements/${draft.id}/adjust`).set(bearer(staff.tokens)).send({ direction: 'credit', amountCents: 1_000, reason: 'Prime de bienvenue' }).expect(200);
    expect(adjusted.body.netCents).toBe(expectedStatement.netCents + 1_000);
    const again = (await request(server()).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: '2026-06-01', driverId: driver.driverId }).expect(200)).body.statements[0];
    expect(again.id).toBe(draft.id);
    expect(again.netCents).toBe(expectedStatement.netCents + 1_000);
    expect(again.lines.filter((l: { kind: string }) => l.kind === 'adjustment_positive')).toHaveLength(1);
    expect((await request(server()).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: '2026-06-02' })).body.code).toBe('PERIOD_NOT_MONDAY');

    // Le chauffeur ne voit pas un brouillon.
    expect((await request(server()).get(`/v1/driver/statements/${draft.id}`).set(bearer(driver.tokens))).status).toBe(404);

    // Émission : immuable, packs facturés, crédit de pack prélevé, PDF produit par la file.
    const issued = await request(server()).post(`/v1/admin/statements/${draft.id}/issue`).set(bearer(staff.tokens)).expect(200);
    expect(issued.body).toMatchObject({ status: 'issued', netCents: expectedStatement.netCents + 1_000 });
    expect((await request(server()).post(`/v1/admin/statements/${draft.id}/issue`).set(bearer(staff.tokens))).body.code).toBe('STATEMENT_NOT_DRAFT');
    expect((await request(server()).post(`/v1/admin/statements/${draft.id}/adjust`).set(bearer(staff.tokens)).send({ direction: 'debit', amountCents: 100, reason: 'Correction' })).body.code).toBe('STATEMENT_ALREADY_ISSUED');
    const [billed] = await db(app).select().from(schema.packPurchases).where(eq(schema.packPurchases.id, purchase.id));
    expect(billed).toMatchObject({ billing: 'billed', statementId: draft.id });
    const [credit] = await db(app).select().from(schema.credits).where(eq(schema.credits.userId, driver.userId));
    expect(credit!.remainingCents).toBe(0);
    const notice = await db(app).select().from(schema.notifications).where(eq(schema.notifications.recipientUserId, driver.userId));
    expect(notice.some((n) => n.template === 'statement.issued' && n.channel === 'email')).toBe(true);

    const mine = await request(server()).get('/v1/driver/statements').set(bearer(driver.tokens)).expect(200);
    expect(mine.body.map((s: { id: string }) => s.id)).toContain(draft.id);
    const pdfReady = await until(() => request(server()).get(`/v1/driver/statements/${draft.id}`).set(bearer(driver.tokens)), (r) => r.body.pdfAvailable === true);
    expect(pdfReady.body.pdfAvailable).toBe(true);
    expect(pdfReady.body.pdfUrl).toMatch(/^mock:\/\/storage\/statements/);
    const pdf = await request(server()).get(`/v1/driver/statements/${draft.id}/pdf`).set(bearer(driver.tokens)).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await request(server()).get(`/v1/driver/statements/${draft.id}/pdf`).set(bearer(other.tokens))).status).toBe(404);
    expect((await request(server()).get(`/v1/admin/statements/${draft.id}/pdf`).set(bearer(staff.tokens))).status).toBe(200);

    // Semaine suivante : la course du lundi, jamais une course déjà réglée.
    const next = (await request(server()).post('/v1/admin/statements/generate').set(bearer(staff.tokens)).send({ periodStart: '2026-06-08', driverId: driver.driverId }).expect(200)).body.statements[0];
    const nextRides = new Set(next.lines.map((l: { rideId: string | null }) => l.rideId).filter(Boolean));
    expect(nextRides.size).toBe(1);
    expect(nextRides.has(card.id)).toBe(false);
    // Les droits : le personnel en lecture seule ne génère rien.
    const readonly = await createStaffAndLogin(app, ['readonly']);
    expect((await request(server()).post('/v1/admin/statements/generate').set(bearer(readonly.tokens)).send({ periodStart: '2026-06-08' })).status).toBe(403);
  });

  it('versement Connect d\'un net positif, rejouable ; net nul réglé sans mouvement', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await ride(driver, { at: '2026-06-16T15:00:00Z', fareCents: 3_000 });
    const draft = (await statements().generate({ periodStart: '2026-06-15', driverId: driver.driverId })).statements[0]!;
    await statements().issue(draft.id!);
    const missing = await payouts().settle(draft.id!);
    expect(missing).toMatchObject({ status: 'failed', failureCode: 'payout_account_missing' });
    await db(app).update(schema.drivers).set({ stripeConnectAccountId: `acct_test_${driver.driverId.slice(0, 8)}`, stripeConnectOnboarded: true }).where(eq(schema.drivers.id, driver.driverId));
    const paid = await request(server()).post(`/v1/admin/statements/${draft.id}/pay`).set(bearer(staff.tokens)).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', attempts: 2, failureCode: null });
    expect(paid.body.transferRef).toMatch(/^tr_mock/);
    const replay = await request(server()).post(`/v1/admin/statements/${draft.id}/pay`).set(bearer(staff.tokens)).expect(200);
    expect(replay.body).toMatchObject({ status: 'paid', transferRef: paid.body.transferRef, attempts: 2 });
    const [balance] = await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.driverId));
    expect(balance).toMatchObject({ balanceCents: 0, suspendedForBalanceAt: null });
  });

  it('prélèvement refusé : nouvel essai le lundi, suspension au-delà de 150 $, réactivation après régularisation ; impayé de plus de 7 jours', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await pack(driver, 'elite', '2026-06-23T13:00:00Z');
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debit_declined' }).where(eq(schema.drivers.id, driver.driverId));
    const draft = (await statements().generate({ periodStart: '2026-06-22', driverId: driver.driverId })).statements[0]!;
    expect(draft.netCents).toBeLessThan(-15_000);
    const friday = new Date('2026-07-03T10:30:00Z');
    await statements().issue(draft.id!, friday);
    const failed = await payouts().settle(draft.id!, friday);
    expect(failed).toMatchObject({ status: 'failed', attempts: 1, failureCode: 'card_declined' });
    let [balance] = await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.driverId));
    // Première tentative : solde dû, pas encore de suspension (nouvelle tentative le lundi).
    expect(balance).toMatchObject({ balanceCents: draft.netCents, suspendedForBalanceAt: null });
    expect(balance!.unpaidSince?.toISOString()).toBe(friday.toISOString());

    // Lundi : nouvel essai refusé, suspension ; le passage en ligne est refusé avec le motif.
    await db(app).update(schema.weeklyStatements).set({ updatedAt: friday }).where(eq(schema.weeklyStatements.id, draft.id!));
    const monday = new Date('2026-07-06T11:00:00Z');
    expect(await payouts().retryFailed(monday)).toBeGreaterThanOrEqual(1);
    [balance] = await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.driverId));
    expect(balance!.suspendedForBalanceAt?.toISOString()).toBe(monday.toISOString());
    const refused = await request(server()).post('/v1/driver/status').set(bearer(driver.tokens)).send({ status: 'online', coordinates: PLATEAU.coordinates });
    expect(refused.body.details.reasons).toContain('balance_suspended');
    const notices = await db(app).select().from(schema.notifications).where(eq(schema.notifications.recipientUserId, driver.userId));
    expect(notices.some((n) => n.template === 'balance.suspended')).toBe(true);
    const listed = await request(server()).get('/v1/admin/balances').set(bearer(staff.tokens)).expect(200);
    expect(listed.body.find((b: { driverId: string }) => b.driverId === driver.driverId)).toMatchObject({ balanceCents: draft.netCents });

    // Nouvelle carte, règlement par My Hub : prélevé, solde régularisé, réactivation automatique.
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debit_ok' }).where(eq(schema.drivers.id, driver.driverId));
    const charged = await request(server()).post(`/v1/admin/statements/${draft.id}/pay`).set(bearer(staff.tokens)).expect(200);
    expect(charged.body).toMatchObject({ status: 'charged', attempts: 3 });
    [balance] = await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.driverId));
    expect(balance).toMatchObject({ balanceCents: 0, unpaidSince: null, suspendedForBalanceAt: null });
    expect((await db(app).select().from(schema.notifications).where(eq(schema.notifications.recipientUserId, driver.userId))).some((n) => n.template === 'balance.reactivated')).toBe(true);

    // Petit solde impayé : pas de suspension avant 7 jours, suspension ensuite.
    const small = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await pack(small, 'essential', '2026-06-23T13:00:00Z');
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_small_declined' }).where(eq(schema.drivers.id, small.driverId));
    const smallDraft = (await statements().generate({ periodStart: '2026-06-22', driverId: small.driverId })).statements[0]!;
    await statements().issue(smallDraft.id!, friday);
    await payouts().settle(smallDraft.id!, friday);
    await payouts().refreshBalance(small.driverId, new Date('2026-07-09T12:00:00Z'));
    expect((await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, small.driverId)))[0]!.suspendedForBalanceAt).toBeNull();
    const late = new Date('2026-07-11T12:00:00Z');
    await payouts().refreshBalance(small.driverId, late);
    expect((await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, small.driverId)))[0]!.suspendedForBalanceAt?.toISOString()).toBe(late.toISOString());
  });

  it('passe du vendredi 6 h : relevés de la semaine précédente générés, émis et réglés ; rien la veille ni deux fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.drivers).set({ stripeConnectAccountId: `acct_test_${driver.driverId.slice(0, 8)}`, stripeConnectOnboarded: true }).where(eq(schema.drivers.id, driver.driverId));
    await ride(driver, { at: '2026-05-06T16:00:00Z', fareCents: 2_500 });
    const jobs = app.get(SettlementJobsService);
    const mine = () => db(app!).select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.driverId, driver.driverId));
    // Jeudi 14 mai : rien ; vendredi 15 mai à 5 h 30 (heure de Montréal) : rien non plus.
    await jobs.tick(new Date('2026-05-14T14:00:00Z'));
    await jobs.tick(new Date('2026-05-15T09:30:00Z'));
    expect(await mine()).toHaveLength(0);
    const report = await jobs.tick(new Date('2026-05-15T10:30:00Z'));
    expect(report.generated).toBeGreaterThanOrEqual(1);
    const [statement] = await mine();
    expect(statement).toMatchObject({ periodStart: '2026-05-04', periodEnd: '2026-05-10', status: 'paid' });
    expect(statement!.netCents).toBeGreaterThan(0);
    await jobs.tick(new Date('2026-05-15T10:45:00Z'));
    expect(await mine()).toHaveLength(1);
    const ids = (await mine()).map((s) => s.id);
    await until(() => db(app!).select({ pdf: schema.weeklyStatements.pdfKey }).from(schema.weeklyStatements).where(inArray(schema.weeklyStatements.id, ids)), (rows) => rows.every((r) => Boolean(r.pdf)));
    expect((await mine())[0]!.pdfKey).toMatch(/^statements\//);
  });
});
