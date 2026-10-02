import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockPaymentProvider } from '../src/adapters/mock/index.js';
import { PAYMENT_PROVIDER } from '../src/adapters/types.js';
import { CreditsEventsService } from '../src/modules/credits/credits-events.service.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { OrganizationStatementsService } from '../src/modules/settlement/organization-statements.service.js';
import { SettlementPayoutsService } from '../src/modules/settlement/settlement-payouts.service.js';
import { StatementsService } from '../src/modules/settlement/statements.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Revue du code du 2 octobre 2026, agent A (argent) : crédits et paiement au chauffeur (constat 2), réservation des
 * crédits à la réservation (constat 3), loyer de flotte sans course (constat 6), clés d'idempotence stables et état
 * « unknown » des règlements (constat 7), pourboire refusé puis réessayé (constat 11), solde et suspension (constat 12).
 */
const PLATEAU = { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } };
const CENTRE = { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } };
const DAY_MS = 86_400_000;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const key = () => `rva-${Math.random().toString(36).slice(2, 14)}`;
type Tokens = { accessToken: string; user: { id: string } };
interface QuoteBody { id: string; totalCents: number; amountDueCents: number; creditsAppliedCents: number; creditsPrepaidOnly: boolean; maxConsentedCents: number; lines: Array<{ code: string; amountCents: number }> }

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, label: string, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (ok(value)) return value;
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label} (${JSON.stringify(value)})`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('revue du 2 octobre 2026, agent A : crédits, règlements, loyer de flotte, pourboire (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let finance: StaffSession;
  const orgIds: string[] = [];
  const server = () => app!.getHttpServer();
  const provider = () => app!.get<MockPaymentProvider>(PAYMENT_PROVIDER);
  const statements = () => app!.get(StatementsService);
  const payouts = () => app!.get(SettlementPayoutsService);

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    admin = await createStaffAndLogin(app, ['operator']);
    finance = await createStaffAndLogin(app, ['finance']);
  });
  beforeEach(async () => {
    if (app) await resetHttpLimits(app);
  });
  afterAll(async () => {
    if (app) {
      await cleanupTestData(app);
      if (orgIds.length) {
        await db(app).delete(schema.organizationStatements).where(inArray(schema.organizationStatements.organizationId, orgIds));
        await db(app).delete(schema.revenueShareRules).where(inArray(schema.revenueShareRules.organizationId, orgIds));
        await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, orgIds));
      }
    }
    await app?.close();
  });

  const grantCredit = async (userId: string, amountCents: number) =>
    (await db(app!).insert(schema.credits).values({ userId, origin: 'goodwill', amountCents, remainingCents: amountCents, expiresAt: new Date(Date.now() + 100 * DAY_MS), reference: 'revue-a' }).returning())[0]!;
  const creditRow = async (id: string) => (await db(app!).select().from(schema.credits).where(eq(schema.credits.id, id)))[0]!;
  const usesOf = (rideId: string) => db(app!).select().from(schema.creditUses).where(eq(schema.creditUses.rideId, rideId));
  const rideRow = async (id: string) => (await db(app!).select().from(schema.rides).where(eq(schema.rides.id, id)))[0]!;
  const wallet = async (tokens: Tokens) => (await request(server()).get('/v1/me/credits').set(bearer(tokens)).expect(200)).body as { availableCents: number };
  const quote = async (client: Tokens, extra: Record<string, unknown> = {}) => {
    const res = await request(server()).post('/v1/quotes').set(bearer(client)).send({ category: 'neo_premium', origin: PLATEAU, destination: CENTRE, requestedAt: inHours(3), ...extra });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.quotes[0] as QuoteBody;
  };
  const book = (client: Tokens, q: QuoteBody, payment: { paymentChoice: 'prepaid' | 'pay_driver_after'; paymentMethod: string }) =>
    request(server()).post('/v1/rides').set(bearer(client)).set('Idempotency-Key', key()).send({ quoteId: q.id, type: 'scheduled', requestedAt: inHours(3), ...payment, maxConsentedCents: q.maxConsentedCents });
  /** Attribution par l'opérateur puis déroulé complet par le chauffeur. */
  const drive = async (rideId: string, driver: TestDriver, complete: Record<string, unknown> = {}) => {
    await request(server()).post(`/v1/admin/rides/${rideId}/assign`).set(bearer(admin.tokens)).send({ driverId: driver.driverId }).expect(200);
    for (const step of ['depart', 'arrive', 'start']) await request(server()).post(`/v1/driver/rides/${rideId}/${step}`).set(bearer(driver.tokens)).expect(200);
    return (await request(server()).post(`/v1/driver/rides/${rideId}/complete`).set(bearer(driver.tokens)).send({ measuredDistanceMeters: 8200, measuredDurationSeconds: 1100, ...complete }).expect(200)).body as { finalPriceCents: number };
  };
  const statementKeys = (statementId: string) =>
    provider().calls.filter((c) => c.method === 'chargeOffSession' && (c.args[0] as { metadata?: { statement_id?: string } }).metadata?.statement_id === statementId).map((c) => (c.args[0] as { idempotencyKey: string }).idempotencyKey);
  /** Pack à facturer sur la période (sans course ni activation par l'API : écrit en base, expiré pour ne gêner aucune répartition). */
  const packToBill = (driverId: string, activatedAt: string, priceCents = 16_900) =>
    db(app!).insert(schema.packPurchases).values({ driverId, packCode: 'elite', pricePaidCents: priceCents, ridesIncluded: 100, ridesRemaining: 0, activatedAt: new Date(activatedAt), expiresAt: new Date(Date.parse(activatedAt) + 28 * DAY_MS), status: 'expired', autoRenew: false, billing: 'to_bill' });
  const issuedStatement = async (driverId: string, periodStart: string, at = new Date(`${periodStart}T12:00:00Z`)) => {
    const draft = (await statements().generate({ periodStart, driverId })).statements[0];
    expect(draft, `relevé ${periodStart} de ${driverId}`).toBeDefined();
    await statements().issue(draft!.id!, at);
    return draft!.id!;
  };

  it('constat 2 : « payer au chauffeur » sans crédit (devis annoncé, course entière, aucune consommation) ; prépayé avec crédits', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const credit = await grantCredit(client.user.id, 2_000);

    // Devis annoncé « payer au chauffeur » : aucun crédit déduit, le reste à payer est le total, et le devis le dit.
    const direct = await quote(client, { paymentChoice: 'pay_driver_after' });
    expect(direct).toMatchObject({ creditsAppliedCents: 0, creditsPrepaidOnly: true });
    expect(direct.amountDueCents).toBe(direct.totalCents);
    expect(direct.lines.some((l) => l.code === 'credits')).toBe(false);
    // Sans choix annoncé : calculé comme une course prépayée.
    const q = await quote(client);
    expect(q.creditsAppliedCents).toBe(Math.min(2_000, q.totalCents));
    expect(q.amountDueCents).toBe(q.totalCents - q.creditsAppliedCents);
    expect(q.lines.find((l) => l.code === 'credits')?.amountCents).toBe(-q.creditsAppliedCents);
    expect(q.creditsPrepaidOnly).toBe(true);

    // Réservée « payer au chauffeur » : la course ignore les crédits du devis (rien de réservé, le compte reste entier).
    const created = await book(client, q, { paymentChoice: 'pay_driver_after', paymentMethod: 'cash' });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const rideId = created.body.id as string;
    expect(await rideRow(rideId)).toMatchObject({ creditsAppliedCents: 0, quotedTotalCents: q.totalCents, paymentChoice: 'pay_driver_after' });
    expect(created.body.quote.totalCents).toBe(q.totalCents);
    expect(await usesOf(rideId)).toHaveLength(0);
    expect((await creditRow(credit.id)).remainingCents).toBe(2_000);
    expect((await wallet(client)).availableCents).toBe(2_000);

    // Fin de course : le chauffeur encaisse le prix entier (montant proposé par son application), sans écart ; aucun crédit prélevé.
    const done = await drive(rideId, driver);
    expect(done.finalPriceCents).toBe(q.totalCents);
    const job = (await request(server()).get(`/v1/driver/rides/${rideId}`).set(bearer(driver.tokens)).expect(200)).body as { finalPriceCents: number; job: { payment: { direct: boolean; amountDueCents: number | null } } };
    expect(job.job.payment).toMatchObject({ direct: true, amountDueCents: q.totalCents });
    await request(server()).post(`/v1/driver/rides/${rideId}/payment-received`).set(bearer(driver.tokens)).send({ amountCents: q.totalCents }).expect(200);
    expect(await db(app).select({ id: schema.incidents.id }).from(schema.incidents).where(and(eq(schema.incidents.rideId, rideId), sql`${schema.incidents.description} LIKE 'Écart de paiement direct%'`))).toHaveLength(0);
    const consumed = await app.get(CreditsEventsService).onRideCompleted(rideId);
    expect(consumed.credits).toMatchObject({ appliedCents: 0, consumedCents: 0 });
    expect(await usesOf(rideId)).toHaveLength(0);
    expect((await creditRow(credit.id)).remainingCents).toBe(2_000);
    expect((await wallet(client)).availableCents).toBe(2_000);
  });

  it('constat 3 : réservation à la réservation (une seule des deux courses passe, 409 pour l\'autre), solde net, libération à l\'annulation, confirmation à la fin de course', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const credit = await grantCredit(client.user.id, 1_500);
    const [qA, qB] = await Promise.all([quote(client), quote(client)]);
    expect(qA.creditsAppliedCents).toBe(1_500);
    expect(qB.creditsAppliedCents).toBe(1_500);

    // Deux réservations en même temps sur le même crédit : la seconde ne peut plus le couvrir.
    const results = await Promise.all([book(client, qA, { paymentChoice: 'prepaid', paymentMethod: 'card_app' }), book(client, qB, { paymentChoice: 'prepaid', paymentMethod: 'card_app' })]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    const winner = results.find((r) => r.status === 201)!;
    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.code).toBe('CREDITS_INSUFFICIENT');
    expect(loser.body.details).toMatchObject({ requestedCents: 1_500, availableCents: 0 });
    const rideA = winner.body.id as string;
    expect((await rideRow(rideA)).creditsAppliedCents).toBe(1_500);
    const reserved = await usesOf(rideA);
    expect(reserved).toHaveLength(1);
    expect(reserved[0]).toMatchObject({ creditId: credit.id, amountCents: 1_500, status: 'reserved' });
    expect((await creditRow(credit.id)).remainingCents).toBe(0);
    // Le solde affiché et le devis suivant déduisent la réservation.
    expect((await wallet(client)).availableCents).toBe(0);
    expect((await quote(client)).creditsAppliedCents).toBe(0);
    // La course perdante (quel que soit le devis qui a perdu) n'existe pas : transaction annulée.
    const loserQuote = results[0]!.status === 409 ? qA : qB;
    expect(await db(app).select({ id: schema.rides.id }).from(schema.rides).where(eq(schema.rides.quoteId, loserQuote.id))).toHaveLength(0);

    // Annulation : la réservation est rendue au compte.
    await request(server()).post(`/v1/rides/${rideA}/cancel`).set(bearer(client)).send({ reason: 'changed_plans' }).expect(200);
    await until(() => creditRow(credit.id), (c) => c.remainingCents === 1_500, 'libération de la réservation à l\'annulation');
    expect((await usesOf(rideA))[0]!.status).toBe('released');
    expect((await wallet(client)).availableCents).toBe(1_500);

    // Nouvelle course prépayée : réservée, puis confirmée à la fin de course, une seule fois même rejouée.
    const qC = await quote(client);
    expect(qC.creditsAppliedCents).toBe(1_500);
    const rideC = (await book(client, qC, { paymentChoice: 'prepaid', paymentMethod: 'card_app' }).expect(201)).body.id as string;
    expect((await creditRow(credit.id)).remainingCents).toBe(0);
    await drive(rideC, driver);
    const uses = await until(() => usesOf(rideC), (rows) => rows.length === 1 && rows[0]!.status === 'consumed', 'confirmation de la réservation à la fin de course');
    expect(uses[0]).toMatchObject({ creditId: credit.id, amountCents: 1_500, status: 'consumed' });
    const events = app.get(CreditsEventsService);
    const replay = await events.onRideCompleted(rideC);
    expect(replay.credits).toMatchObject({ replayed: true, consumedCents: 0 });
    await Promise.all([events.onRideCompleted(rideC), events.onRideCompleted(rideC)]);
    expect((await creditRow(credit.id)).remainingCents).toBe(0);
    expect(await usesOf(rideC)).toHaveLength(1);
    expect((await wallet(client)).availableCents).toBe(0);
  });

  it('constat 6 : loyer hebdomadaire de flotte dû sans course ; constat 7 (organisation) : clé de transfert stable, état « unknown », réconciliation par rejeu', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const [root] = await db(app).select({ id: schema.organizations.id, path: schema.organizations.path }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    const orgId = randomUUID();
    await db(app).insert(schema.organizations).values({ id: orgId, code: `flotte-revue-a-${orgId.slice(0, 8)}`, name: 'Flotte revue A', type: 'fleet', parentId: root!.id, path: `${root!.path}${orgId}/` });
    orgIds.push(orgId);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.drivers).set({ organizationId: orgId, stripeDebitPaymentMethodId: 'pm_test_rent_ok' }).where(eq(schema.drivers.id, driver.driverId));
    await db(app).insert(schema.revenueShareRules).values({ organizationId: orgId, driverId: null, mode: 'rent', weeklyRentCents: 10_000, effectiveFrom: '2026-01-01' });

    // Semaine sans aucune course : la passe de tous les chauffeurs retient le chauffeur, le relevé porte le loyer, net négatif.
    const pass = await statements().generate({ periodStart: '2026-08-03', preview: true });
    const mine = pass.statements.find((s) => s.driverId === driver.driverId);
    expect(mine, 'chauffeur sous loyer retenu par la passe sans course').toBeDefined();
    expect(mine!.lines.map((l) => ({ kind: l.kind, amountCents: l.amountCents }))).toEqual([{ kind: 'fleet_share', amountCents: -10_000 }]);
    expect(mine!.netCents).toBe(-10_000);
    const statementId = await issuedStatement(driver.driverId, '2026-08-03');
    // Prélevé selon le mécanisme existant, première clé de prélèvement du relevé.
    const charged = await request(server()).post(`/v1/admin/statements/${statementId}/pay`).set(bearer(finance.tokens)).expect(200);
    expect(charged.body).toMatchObject({ status: 'charged', netCents: -10_000, attempts: 1 });
    expect(statementKeys(statementId)).toEqual([`statement:${statementId}:charge:1`]);

    // Relevé de l'organisation : sa part (le loyer), versée par transfert avec une clé stable par relevé.
    const organizationStatements = app.get(OrganizationStatementsService);
    await organizationStatements.issueAndPay({ startDate: '2026-08-03', endDate: '2026-08-09' });
    const orgRow = async () => (await db(app!).select().from(schema.organizationStatements).where(and(eq(schema.organizationStatements.organizationId, orgId), eq(schema.organizationStatements.periodStart, '2026-08-03'))))[0]!;
    expect(await orgRow()).toMatchObject({ status: 'issued', shareCents: 10_000, driverCount: 1 });
    await db(app).update(schema.organizations).set({ stripeAccountId: `acct_test_${orgId.slice(0, 8)}`, stripeAccountOnboarded: true }).where(eq(schema.organizations.id, orgId));
    const orgStatementId = (await orgRow()).id;
    const transferKey = `organization-statement:${orgStatementId}:payout`;
    // Panne simulée pour ce seul transfert : l'appel est consigné comme un vrai appel (sa clé est vérifiée), puis rejeté sans réponse.
    const original = provider().transfer.bind(provider());
    const outage = vi.spyOn(provider(), 'transfer').mockImplementation(async (input) => {
      if (input.idempotencyKey !== transferKey) return original(input);
      provider().calls.push({ method: 'transfer', args: [input] });
      throw new Error('Délai dépassé (simulation)');
    });
    try {
      const report = await organizationStatements.retryFailed();
      expect(report.unknown).toBeGreaterThanOrEqual(1);
    } finally {
      outage.mockRestore();
    }
    expect(await orgRow()).toMatchObject({ status: 'unknown', failureCode: 'transfer_unknown', attempts: 0, stripeTransferId: null });
    // Aucune reprise automatique tant que la réconciliation n'a pas tranché.
    await organizationStatements.retryFailed();
    expect((await orgRow()).status).toBe('unknown');
    const reconciled = await request(server()).post(`/v1/admin/organization-statements/${orgStatementId}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'replay' }).expect(200);
    expect(reconciled.body).toMatchObject({ status: 'paid' });
    expect(reconciled.body.transferRef).toMatch(/^tr_mock/);
    const transferKeys = provider().calls.filter((c) => c.method === 'transfer' && (c.args[0] as { idempotencyKey: string }).idempotencyKey === transferKey);
    expect(transferKeys).toHaveLength(2);
    const notUnknown = await request(server()).post(`/v1/admin/organization-statements/${orgStatementId}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'replay' });
    expect(notUnknown.status).toBe(409);
    expect(notUnknown.body.code).toBe('ORGANIZATION_STATEMENT_NOT_UNKNOWN');
  });

  it('constat 7 (chauffeur) : prestataire sans réponse → relevé « unknown » sans reprise automatique ; réconciliation (rejeu même clé, constaté, non exécuté) ; refus définitif → nouvelle clé', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debit_ok' }).where(eq(schema.drivers.id, driver.driverId));
    for (const week of ['2026-08-11', '2026-08-18', '2026-08-25', '2026-09-01']) await packToBill(driver.driverId, `${week}T13:00:00Z`);
    const friday = new Date('2026-09-11T10:30:00Z');
    const row = async (id: string) => (await db(app!).select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, id)))[0]!;
    const withOutage = async (statementId: string, run: () => Promise<unknown>) => {
      const original = provider().chargeOffSession.bind(provider());
      const outage = vi.spyOn(provider(), 'chargeOffSession').mockImplementation(async (input) => {
        if (input.metadata?.['statement_id'] !== statementId) return original(input);
        provider().calls.push({ method: 'chargeOffSession', args: [input] });
        throw new Error('Délai dépassé (simulation)');
      });
      try {
        await run();
      } finally {
        outage.mockRestore();
      }
    };

    // 1. Sans réponse : « unknown », tentative non comptée, finances alertées ; ni la reprise du lundi ni « payer » ne retentent.
    const first = await issuedStatement(driver.driverId, '2026-08-10', friday);
    expect((await row(first)).netCents).toBeLessThan(0);
    await withOutage(first, () => payouts().settle(first, friday));
    expect(await row(first)).toMatchObject({ status: 'unknown', attempts: 0, failureCode: 'charge_unknown', settledAt: null });
    expect(await db(app).select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.template, 'alert.settlement_unknown'), sql`${schema.notifications.data}->>'statementId' = ${first}`))).not.toHaveLength(0);
    await db(app).update(schema.weeklyStatements).set({ updatedAt: friday }).where(eq(schema.weeklyStatements.id, first));
    await payouts().retryFailed(new Date('2026-09-14T11:00:00Z'));
    expect((await row(first)).status).toBe('unknown');
    const refused = await request(server()).post(`/v1/admin/statements/${first}/pay`).set(bearer(finance.tokens));
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe('STATEMENT_OUTCOME_UNKNOWN');
    // Le solde ne compte pas un relevé dont l'issue est inconnue.
    expect((await db(app).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.driverId)))[0]).toMatchObject({ balanceCents: 0, suspendedForBalanceAt: null });
    // Rejeu avec la même clé : le prestataire répond, le relevé est prélevé ; les deux appels portent une clé identique.
    const replayed = await request(server()).post(`/v1/admin/statements/${first}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'replay' }).expect(200);
    expect(replayed.body).toMatchObject({ status: 'charged', attempts: 1, failureCode: null });
    expect(statementKeys(first)).toEqual([`statement:${first}:charge:1`, `statement:${first}:charge:1`]);
    expect((await request(server()).post(`/v1/admin/statements/${first}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'replay' })).body.code).toBe('STATEMENT_NOT_UNKNOWN');

    // 2. Mouvement constaté chez le prestataire : réglé avec sa référence, sans nouvel appel.
    const second = await issuedStatement(driver.driverId, '2026-08-17', friday);
    await withOutage(second, () => payouts().settle(second, friday));
    expect((await row(second)).status).toBe('unknown');
    expect((await request(server()).post(`/v1/admin/statements/${second}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'executed' })).status).toBe(400);
    const seen = await request(server()).post(`/v1/admin/statements/${second}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'executed', reference: 'pi_vu_dans_le_tableau_de_bord', note: 'Paiement trouvé par l\'identifiant du relevé' }).expect(200);
    expect(seen.body).toMatchObject({ status: 'charged', chargeRef: 'pi_vu_dans_le_tableau_de_bord', attempts: 1, failureCode: null });
    expect(seen.body.settledAt).not.toBeNull();
    expect(statementKeys(second)).toEqual([`statement:${second}:charge:1`]);

    // 3. Rien d'exécuté : relevé en échec, repris avec une nouvelle clé.
    const third = await issuedStatement(driver.driverId, '2026-08-24', friday);
    await withOutage(third, () => payouts().settle(third, friday));
    const notExecuted = await request(server()).post(`/v1/admin/statements/${third}/reconcile`).set(bearer(finance.tokens)).send({ outcome: 'not_executed' }).expect(200);
    expect(notExecuted.body).toMatchObject({ status: 'failed', attempts: 1, failureCode: 'not_executed' });
    const retried = await request(server()).post(`/v1/admin/statements/${third}/pay`).set(bearer(finance.tokens)).expect(200);
    expect(retried.body).toMatchObject({ status: 'charged', attempts: 2 });
    expect(statementKeys(third)).toEqual([`statement:${third}:charge:1`, `statement:${third}:charge:2`]);

    // 4. Refus définitif de la carte : en échec (tentative comptée), nouvelle carte, nouvelle clé.
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debit_declined' }).where(eq(schema.drivers.id, driver.driverId));
    const fourth = await issuedStatement(driver.driverId, '2026-08-31', friday);
    expect(await payouts().settle(fourth, friday)).toMatchObject({ status: 'failed', attempts: 1, failureCode: 'card_declined' });
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debit_ok' }).where(eq(schema.drivers.id, driver.driverId));
    expect(await payouts().settle(fourth, friday)).toMatchObject({ status: 'charged', attempts: 2 });
    expect(statementKeys(fourth)).toEqual([`statement:${fourth}:charge:1`, `statement:${fourth}:charge:2`]);
  });

  it('constat 11 : pourboire refusé puis réessayé (clé changée après le refus seulement, identique après un délai)', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    const q = await quote(client);
    const rideId = (await book(client, q, { paymentChoice: 'prepaid', paymentMethod: 'card_app' }).expect(201)).body.id as string;
    await drive(rideId, driver);
    const tipRow = async () => (await db(app!).select().from(schema.payments).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'tip'))))[0];
    const tipKeys = () => provider().calls.filter((c) => c.method === 'chargeOffSession' && (c.args[0] as { metadata?: { ride_id?: string; kind?: string } }).metadata?.ride_id === rideId && (c.args[0] as { metadata?: { kind?: string } }).metadata?.kind === 'tip').map((c) => (c.args[0] as { idempotencyKey: string }).idempotencyKey);

    // Carte de la course refusée : 402, refus compté sur la ligne du pourboire, rien de capturé.
    await db(app).update(schema.payments).set({ stripePaymentMethodId: 'pm_test_tip_declined' }).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'ride')));
    const declined = await request(server()).post(`/v1/rides/${rideId}/tip`).set(bearer(client)).send({ amountCents: 500 });
    expect(declined.status).toBe(402);
    expect(declined.body.code).toBe('PAYMENT_DECLINED');
    expect(await tipRow()).toMatchObject({ status: 'failed', attempts: 1, failureCode: 'card_declined', capturedCents: 0 });
    expect((await rideRow(rideId)).tipCents).toBe(0);
    // Délai du prestataire : aucune ligne changée, la clé suivante reste celle de cette tentative.
    const outage = vi.spyOn(provider(), 'chargeOffSession').mockImplementationOnce(async (input) => {
      provider().calls.push({ method: 'chargeOffSession', args: [input] });
      throw new Error('Délai dépassé (simulation)');
    });
    try {
      await expect(app.get(PaymentsService).tip(rideId, client.user.id, 500)).rejects.toThrow('Délai dépassé');
    } finally {
      outage.mockRestore();
    }
    expect(await tipRow()).toMatchObject({ status: 'failed', attempts: 1 });
    // Nouvelle carte : la tentative passe (une clé différente de celle du refus), une seule ligne, rejouée sans second débit.
    await db(app).update(schema.payments).set({ stripePaymentMethodId: 'pm_test_tip_ok' }).where(and(eq(schema.payments.rideId, rideId), eq(schema.payments.kind, 'ride')));
    const captured = await request(server()).post(`/v1/rides/${rideId}/tip`).set(bearer(client)).send({ amountCents: 500 }).expect(201);
    expect(captured.body).toMatchObject({ kind: 'tip', status: 'captured', capturedCents: 500 });
    expect(await tipRow()).toMatchObject({ status: 'captured', attempts: 1, failureCode: null, capturedCents: 500, tipCents: 500 });
    expect((await rideRow(rideId)).tipCents).toBe(500);
    expect(tipKeys()).toEqual([`tip:${rideId}`, `tip:${rideId}:1`, `tip:${rideId}:1`]);
    expect((await request(server()).post(`/v1/rides/${rideId}/tip`).set(bearer(client)).send({ amountCents: 500 }).expect(201)).body.id).toBe(captured.body.id);
    expect(tipKeys()).toHaveLength(3);
  });

  it('constat 12 : un versement en échec dû au chauffeur ne compense pas sa dette ; la suspension se juge sur la dette', { timeout: 120_000 }, async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const client = await loginByOtp(app);
    const driver = await createDriver(app, 'neo_premium', { acceptsScheduled: false });
    // Semaine 1 : une course terminée (tarif 200 $) sans compte Connect : versement en échec, 200 $ dus au chauffeur.
    const q = await quote(client);
    const rideId = (await book(client, q, { paymentChoice: 'prepaid', paymentMethod: 'card_app' }).expect(201)).body.id as string;
    await db(app).update(schema.rides).set({ state: 'completed', driverId: driver.driverId, fareCents: 20_000, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 1_015, qstCents: 2_024, stateTimestamps: { completed: '2026-07-07T15:00:00Z' } }).where(eq(schema.rides.id, rideId));
    const friday = new Date('2026-07-17T10:30:00Z');
    const positive = await issuedStatement(driver.driverId, '2026-07-06', friday);
    expect(await payouts().settle(positive, friday)).toMatchObject({ status: 'failed', failureCode: 'payout_account_missing' });
    expect((await db(app).select().from(schema.weeklyStatements).where(eq(schema.weeklyStatements.id, positive)))[0]!.netCents).toBeGreaterThan(15_000);
    // Semaine 2 : un pack de 169 $ à facturer, carte de prélèvement refusée : dette au-delà du seuil de 150 $.
    await packToBill(driver.driverId, '2026-07-14T13:00:00Z');
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debt_declined' }).where(eq(schema.drivers.id, driver.driverId));
    const negative = await issuedStatement(driver.driverId, '2026-07-13', friday);
    expect(await payouts().settle(negative, friday)).toMatchObject({ status: 'failed', attempts: 1, failureCode: 'card_declined' });
    const balance = async () => (await db(app!).select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.driverId)))[0]!;
    // Première tentative : pas encore de suspension (reprise du lundi d'abord).
    expect((await balance()).suspendedForBalanceAt).toBeNull();
    await db(app).update(schema.weeklyStatements).set({ updatedAt: friday }).where(eq(schema.weeklyStatements.id, negative));
    const monday = new Date('2026-07-20T11:00:00Z');
    await payouts().retryFailed(monday);
    const after = await balance();
    // Solde informatif mêlé (versement dû moins dette), mais suspension sur la dette seule, au-delà du seuil après la reprise.
    expect(after.balanceCents).toBeGreaterThan(0);
    expect(after.suspendedForBalanceAt?.toISOString()).toBe(monday.toISOString());
    // Dette régularisée : réactivation, le versement dû restant en attente.
    await db(app).update(schema.drivers).set({ stripeDebitPaymentMethodId: 'pm_test_debt_ok' }).where(eq(schema.drivers.id, driver.driverId));
    expect(await payouts().settle(negative, monday)).toMatchObject({ status: 'charged' });
    expect((await balance()).suspendedForBalanceAt).toBeNull();
  });
});
