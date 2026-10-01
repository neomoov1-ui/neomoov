import 'reflect-metadata';
import { schema } from '@neomoov/db';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BILLING_PROVIDER } from '../src/adapters/billing.types.js';
import type { MockBillingProvider } from '../src/adapters/mock/billing.mock.js';
import type { MockEmailProvider } from '../src/adapters/mock/index.js';
import { EMAIL_PROVIDER } from '../src/adapters/types.js';
import { NotificationDeliveryService } from '../src/modules/notifications/notification-delivery.service.js';
import { SettingsService } from '../src/common/settings.service.js';
import { OrgScopeService } from '../src/modules/organizations/org-scope.service.js';
import { BillingJobsService } from '../src/modules/platform-billing/billing-jobs.service.js';
import { PlatformBillingService } from '../src/modules/platform-billing/platform-billing.service.js';
import { bearer, cleanupTestData, createDriver, createStaffAndLogin, db, loginByOtp, resetHttpLimits, startTestApp, testEmail, type StaffSession, type TestDriver } from './helpers.js';

/**
 * Étape 25 : facturation de la plateforme de bout en bout, Stripe Billing simulé. Abonnement, première facture
 * (installation et taxes), paiement par webhook, facture de fin de période avec véhicules actifs, échec de paiement,
 * rappels à +3, +7 et +14 jours, lecture seule à +30, suspension à +45 reportée pendant une course, règlement hors
 * plateforme et réactivation, journal d'audit ; essai, changement de formule, résiliation ; panne du fournisseur.
 * Le cycle prend `now` en paramètre : aucune attente réelle.
 */
const DAY = 86_400_000;
const HOUR = 3_600_000;
const RUN = Math.random().toString(36).slice(2, 8);
const PRO = `e2e-pro-${RUN}`;
const SOLO = `e2e-solo-${RUN}`;

describe('facturation de la plateforme (intégration)', () => {
  let app: NestExpressApplication | null = null;
  let admin: StaffSession;
  let billing: PlatformBillingService;
  let jobs: BillingJobsService;
  let mock: MockBillingProvider;
  let owner: { userId: string; accessToken: string };
  let driver: TestDriver;
  const orgs: Record<'a' | 'b' | 'c', string> = { a: '', b: '', c: '' };
  const events: string[] = [];
  const state: { subscriptionId: string; firstInvoice: string; firstStripe: string; secondInvoice: string; secondStripe: string; dueAt: number } = { subscriptionId: '', firstInvoice: '', firstStripe: '', secondInvoice: '', secondStripe: '', dueAt: 0 };
  const server = () => app!.getHttpServer();

  const postEvent = (event: { id: string }, signature = 'mock-signature') => {
    events.push(event.id);
    return request(server()).post('/v1/webhooks/stripe-billing').set('stripe-signature', signature).set('content-type', 'application/json').send(JSON.stringify(event));
  };
  const subscription = async (organizationId: string) => (await db(app!).select().from(schema.subscriptions).where(and(eq(schema.subscriptions.organizationId, organizationId), sql`${schema.subscriptions.status} <> 'cancelled'`)))[0];
  const invoice = async (id: string) => (await db(app!).select().from(schema.platformInvoices).where(eq(schema.platformInvoices.id, id)))[0]!;
  const organization = async (id: string) => (await db(app!).select().from(schema.organizations).where(eq(schema.organizations.id, id)))[0]!;
  const notices = async (template: string) => db(app!).select().from(schema.notifications).where(and(eq(schema.notifications.recipientUserId, owner.userId), eq(schema.notifications.template, template))).orderBy(desc(schema.notifications.createdAt));
  async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean, what: string): Promise<T> {
    for (let i = 0; i < 40; i += 1) {
      const value = await read();
      if (ok(value)) return value;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`Attente dépassée : ${what}`);
  }

  beforeAll(async () => {
    app = await startTestApp();
    if (!app) return;
    billing = app.get(PlatformBillingService);
    jobs = app.get(BillingJobsService);
    mock = app.get<MockBillingProvider>(BILLING_PROVIDER);
    app.get(SettingsService).invalidate();
    admin = await createStaffAndLogin(app, ['admin']);
    await db(app).insert(schema.plans).values([
      { code: PRO, name: 'Pro (test)', modules: ['organization', 'rides', 'vehicles', 'drivers', 'platform'], setupFeeCents: 150_000, monthlyPriceCents: 19_900, annualPriceCents: 199_000, perActiveVehicleCents: 1_500, includedVehicles: 10 },
      { code: SOLO, name: 'Solo (test)', modules: ['organization', 'rides'], setupFeeCents: 9_900, monthlyPriceCents: 4_900, annualPriceCents: 49_000, perActiveVehicleCents: 0, includedVehicles: 1 },
    ]);
    const [root] = await db(app).select().from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    for (const key of ['a', 'b', 'c'] as const) {
      const id = randomUUID();
      await db(app).insert(schema.organizations).values({ id, code: `pf-${key}-${id.slice(0, 8)}`, name: `Flotte facturée ${key.toUpperCase()}`, legalName: `Flotte ${key.toUpperCase()} inc.`, type: 'fleet', parentId: root!.id, path: `${root!.path}${id}/` });
      orgs[key] = id;
    }
    // Propriétaire du compte de A : destinataire des avis de facturation.
    const tokens = await loginByOtp(app);
    await db(app).update(schema.users).set({ email: testEmail('proprio') }).where(eq(schema.users.id, tokens.user.id));
    const [ownerRole] = await db(app).select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.code, 'org_owner'), isNull(schema.roles.organizationId))).limit(1);
    await db(app).insert(schema.memberships).values({ userId: tokens.user.id, organizationId: orgs.a, roleId: ownerRole!.id });
    owner = { userId: tokens.user.id, accessToken: tokens.accessToken };
    driver = await createDriver(app);
    await db(app).update(schema.drivers).set({ organizationId: orgs.a }).where(eq(schema.drivers.id, driver.driverId));
    // Le véhicule du chauffeur n'est rattaché à A qu'après l'abonnement (première facture sans véhicule en sus).
    await db(app).update(schema.vehicles).set({ status: 'pending' }).where(eq(schema.vehicles.id, driver.vehicleId));
  });

  afterAll(async () => {
    if (app) {
      const ids = Object.values(orgs).filter(Boolean);
      if (ids.length) {
        await db(app).delete(schema.platformInvoices).where(inArray(schema.platformInvoices.organizationId, ids));
        await db(app).delete(schema.subscriptions).where(inArray(schema.subscriptions.organizationId, ids));
        await db(app).delete(schema.organizationFeatures).where(inArray(schema.organizationFeatures.organizationId, ids));
      }
      if (owner) await db(app).delete(schema.notifications).where(eq(schema.notifications.recipientUserId, owner.userId));
      if (events.length) await db(app).delete(schema.webhookEvents).where(inArray(schema.webhookEvents.id, events.map((e) => `billing_${e}`)));
      await cleanupTestData(app);
      if (ids.length) await db(app).delete(schema.organizations).where(inArray(schema.organizations.id, ids));
      await db(app).delete(schema.plans).where(inArray(schema.plans.code, [PRO, SOLO]));
    }
    await app?.close();
  });

  it('abonnement (Stripe simulé) : première facture avec frais d\'installation et taxes, PDF, courriel au propriétaire', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    await resetHttpLimits(app);
    // Droits : la plateforme seulement.
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.a}/subscription`)).status).toBe(401);
    expect((await request(server()).post(`/v1/admin/organizations/${orgs.a}/subscription`).set(bearer(owner)).send({ planCode: PRO })).status).toBe(403);
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.a}/subscription`).set(bearer(admin.tokens))).body.code).toBe('SUBSCRIPTION_NOT_FOUND');
    expect((await request(server()).post(`/v1/admin/organizations/${orgs.a}/subscription`).set(bearer(admin.tokens)).send({ planCode: 'inconnue' })).body.code).toBe('PLAN_NOT_FOUND');
    const [root] = await db(app).select({ id: schema.organizations.id }).from(schema.organizations).where(isNull(schema.organizations.parentId)).limit(1);
    expect((await request(server()).post(`/v1/admin/organizations/${root!.id}/subscription`).set(bearer(admin.tokens)).send({ planCode: PRO })).body.code).toBe('PLATFORM_NOT_BILLABLE');

    const res = await request(server()).post(`/v1/admin/organizations/${orgs.a}/subscription`).set(bearer(admin.tokens)).send({ planCode: PRO, billingPeriod: 'monthly' }).expect(200);
    expect(res.body).toMatchObject({ created: true, subscription: { organizationId: orgs.a, planCode: PRO, status: 'active', billingPeriod: 'monthly', activeVehicles: 0, monthlyRecurringRevenueCents: 19_900 } });
    expect(res.body.subscription.stripeCustomerId).toMatch(/^cus_mockb_/);
    expect(res.body.subscription.plan.modules).toEqual(['drivers', 'organization', 'rides', 'vehicles']);
    const first = res.body.invoice;
    expect(first).toMatchObject({ status: 'open', subtotalCents: 169_900, gstCents: 8_495, qstCents: 16_948, totalCents: 195_343, currency: 'CAD', remindersSent: 0, pdfAvailable: true, paymentMethod: null });
    expect(first.number).toMatch(/^PF-\d{4}-\d{6}$/);
    expect(first.lines.map((l: { code: string }) => l.code)).toEqual(['setup_fee', 'subscription']);
    expect(first.stripeInvoiceId).toMatch(/^in_mock_/);
    expect(first.hostedInvoiceUrl).toContain(first.stripeInvoiceId);
    state.subscriptionId = res.body.subscription.id;
    state.firstInvoice = first.id;
    state.firstStripe = first.stripeInvoiceId;
    // Chez le fournisseur : mêmes lignes, taxes en lignes distinctes, même total.
    const atStripe = mock.invoices.get(first.stripeInvoiceId)!;
    expect(atStripe.number).toBe(first.number);
    expect([...atStripe.lines, ...atStripe.taxes].reduce((sum, l) => sum + l.amountCents, 0)).toBe(195_343);
    expect(atStripe.taxes.map((t) => t.label)).toEqual(['TPS (5 %)', 'TVQ (9,975 %)']);
    // Organisation : formule et modules de la formule (jamais un module de la plateforme).
    expect(await organization(orgs.a)).toMatchObject({ planCode: PRO, status: 'active' });
    const features = await db(app).select({ module: schema.organizationFeatures.module }).from(schema.organizationFeatures).where(eq(schema.organizationFeatures.organizationId, orgs.a));
    expect(features.map((f) => f.module).sort()).toEqual(['drivers', 'organization', 'rides', 'vehicles']);
    // Courriel au propriétaire, PDF joint (identifiant de la facture dans les données).
    const [issued] = await notices('billing.invoice_issued');
    expect(issued).toMatchObject({ channel: 'email', language: 'fr' });
    expect(issued!.data).toMatchObject({ platformInvoiceId: first.id, number: first.number, totalCents: 195_343, planName: 'Pro (test)' });
    // Envoi réel du courriel (en test, l'envoi n'est jamais automatique) : objet de la facture, PDF joint.
    expect(await app.get(NotificationDeliveryService).deliver(issued!.id)).toBe('sent');
    const mail = app.get<MockEmailProvider>(EMAIL_PROVIDER).sent.at(-1)!;
    expect(mail).toMatchObject({ subject: `Facture ${first.number} de la plateforme Neomoov · Neomoov`, attachments: [`facture-${first.number}.pdf`] });
    expect(mail.to.startsWith('proprio-') && mail.to.endsWith('@test.neomoov.local')).toBe(true);
    // Lectures de My Hub : abonnement, factures, PDF.
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.a}/subscription`).set(bearer(admin.tokens)).expect(200)).body.id).toBe(state.subscriptionId);
    const list = (await request(server()).get(`/v1/admin/organizations/${orgs.a}/platform-invoices`).set(bearer(admin.tokens)).expect(200)).body as Array<{ id: string }>;
    expect(list.map((i) => i.id)).toEqual([first.id]);
    const pdf = await request(server()).get(`/v1/admin/platform-invoices/${first.id}/pdf`).set(bearer(admin.tokens)).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('paiement réussi par webhook simulé, appliqué une seule fois ; signature invalide refusée ; événement inconnu ignoré', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const bad = await postEvent(mock.paymentEvent(state.firstStripe, 'failed'), 'fausse-signature');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    const paid = mock.paymentEvent(state.firstStripe, 'paid');
    expect((await postEvent(paid).expect(200)).body).toEqual({ received: true, duplicate: false, status: 'processed' });
    expect(await invoice(state.firstInvoice)).toMatchObject({ status: 'paid', paymentMethod: 'stripe' });
    expect((await invoice(state.firstInvoice)).paidAt).not.toBeNull();
    expect((await postEvent(paid).expect(200)).body).toEqual({ received: true, duplicate: true, status: 'processed' });
    const ignored = { id: `evt_e2e_${RUN}_sub`, type: 'customer.subscription.updated', data: { object: { id: 'sub_inconnu' } } };
    expect((await postEvent(ignored).expect(200)).body).toEqual({ received: true, duplicate: false, status: 'ignored' });
    const [row] = await db(app).select().from(schema.webhookEvents).where(eq(schema.webhookEvents.id, `billing_${paid.id}`));
    expect(row).toMatchObject({ provider: 'mock_billing', type: 'invoice.paid', status: 'processed' });
  });

  it('fin de période : facture avec ligne de véhicules actifs ; échec de paiement puis past_due', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    // 12 véhicules actifs dans A (10 inclus) : le véhicule du chauffeur et 11 autres.
    await db(app).update(schema.vehicles).set({ status: 'active', organizationId: orgs.a }).where(eq(schema.vehicles.id, driver.vehicleId));
    await db(app).insert(schema.vehicles).values(Array.from({ length: 11 }, () => ({
      driverId: driver.driverId, organizationId: orgs.a, category: 'neo_premium' as const, make: 'Tesla', model: 'Model Y', year: 2024, colour: 'noire', plate: `F${Math.random().toString(36).slice(2, 9).toUpperCase()}`, seats: 4, status: 'active' as const,
    })));
    expect(await billing.activeVehicles(orgs.a)).toBe(12);
    const sub = (await subscription(orgs.a))!;
    const periodEnd = sub.currentPeriodEnd.getTime();
    const report = await jobs.run(new Date(periodEnd + HOUR));
    expect(report.renewed).toBeGreaterThanOrEqual(1);
    expect(report.errors).toBe(0);
    const [second] = await db(app).select().from(schema.platformInvoices).where(and(eq(schema.platformInvoices.organizationId, orgs.a), eq(schema.platformInvoices.periodStart, sub.currentPeriodEnd)));
    expect(second).toMatchObject({ status: 'open', subtotalCents: 22_900, totalCents: 22_900 + 1_145 + 2_284 });
    expect((second!.lines as Array<{ code: string; quantity: number; amountCents: number }>).map((l) => [l.code, l.quantity, l.amountCents])).toEqual([['subscription', 1, 19_900], ['active_vehicles', 2, 3_000]]);
    expect(second!.stripeInvoiceId).toMatch(/^in_mock_/);
    const renewed = (await subscription(orgs.a))!;
    expect(renewed).toMatchObject({ activeVehicles: 12, status: 'active' });
    expect(renewed.currentPeriodStart.getTime()).toBe(periodEnd);
    // Rejouée, la passe ne facture pas deux fois la même période.
    await jobs.run(new Date(periodEnd + 2 * HOUR));
    expect(await db(app).select({ id: schema.platformInvoices.id }).from(schema.platformInvoices).where(eq(schema.platformInvoices.organizationId, orgs.a))).toHaveLength(2);
    state.secondInvoice = second!.id;
    state.secondStripe = second!.stripeInvoiceId!;
    state.dueAt = second!.dueAt.getTime();
    // Le test fige la période suivante (dans un an) : les étapes de relance ne déclenchent pas d'autre renouvellement.
    await db(app).update(schema.subscriptions).set({ currentPeriodEnd: new Date(periodEnd + 365 * DAY) }).where(eq(schema.subscriptions.id, sub.id));

    expect((await postEvent(mock.paymentEvent(state.secondStripe, 'failed')).expect(200)).body.status).toBe('processed');
    expect(await invoice(state.secondInvoice)).toMatchObject({ status: 'past_due', paymentFailureCode: 'card_declined' });
    expect((await subscription(orgs.a))!.status).toBe('past_due');
    expect((await organization(orgs.a)).status).toBe('active');
  });

  it('rappels à +3, +7 et +14 jours, chacun une seule fois', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const at = (days: number, extra = 0) => new Date(state.dueAt + days * DAY + extra);
    expect((await jobs.run(at(2))).errors).toBe(0);
    expect((await invoice(state.secondInvoice)).remindersSent).toBe(0);
    await jobs.run(at(3, HOUR));
    expect((await invoice(state.secondInvoice)).remindersSent).toBe(1);
    await jobs.run(at(3, 2 * HOUR));
    expect((await invoice(state.secondInvoice)).remindersSent).toBe(1);
    await jobs.run(at(7, HOUR));
    expect((await invoice(state.secondInvoice)).remindersSent).toBe(2);
    await jobs.run(at(14, HOUR));
    await jobs.run(at(20));
    expect((await invoice(state.secondInvoice)).remindersSent).toBe(3);
    const reminders = (await notices('billing.reminder')).filter((n) => (n.data as { platformInvoiceId?: string }).platformInvoiceId === state.secondInvoice);
    expect(reminders.map((n) => (n.data as { reminder: number }).reminder).sort()).toEqual([1, 2, 3]);
    expect((await subscription(orgs.a))!.status).toBe('past_due');
  });

  it('lecture seule à +30 jours ; suspension à +45 jours reportée pendant une course, puis appliquée', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const at = (days: number) => new Date(state.dueAt + days * DAY + HOUR);
    const readOnly = await jobs.run(at(30));
    expect(readOnly.readOnly).toBeGreaterThanOrEqual(1);
    expect((await subscription(orgs.a))!.status).toBe('read_only');
    expect((await organization(orgs.a)).status).toBe('read_only');
    expect(await notices('billing.read_only')).toHaveLength(1);
    // Une course est en cours dans l'organisation : la suspension attend.
    const [ride] = await db(app).insert(schema.rides).values({
      publicNumber: `T25-${RUN}-1`, cityCode: 'montreal', guestName: 'Passager Test', guestPhone: '+19995550101', driverId: driver.driverId, vehicleId: driver.vehicleId, organizationId: orgs.a,
      reservedCategory: 'neo_premium', state: 'in_progress', originAddress: '4500 rue Saint-Denis, Montréal', originPosition: { lat: 45.523, lng: -73.582 },
      destinationAddress: '1000 rue De La Gauchetière Ouest, Montréal', destinationPosition: { lat: 45.5, lng: -73.567 }, paymentMethod: 'cash', paymentChoice: 'pay_driver_after', maxConsentedCents: 5_000, quotedTotalCents: 3_156,
    }).returning({ id: schema.rides.id });
    expect(await billing.hasActiveRide(orgs.a)).toBe(true);
    const postponed = await jobs.run(at(45));
    expect(postponed.postponed).toBeGreaterThanOrEqual(1);
    expect((await subscription(orgs.a))!.status).toBe('read_only');
    // Course terminée : la passe du lendemain suspend.
    await db(app).update(schema.rides).set({ state: 'completed' }).where(eq(schema.rides.id, ride!.id));
    expect(await billing.hasActiveRide(orgs.a)).toBe(false);
    const suspended = await jobs.run(at(46));
    expect(suspended.suspended).toBeGreaterThanOrEqual(1);
    expect((await subscription(orgs.a))!.status).toBe('suspended');
    expect((await organization(orgs.a)).status).toBe('suspended');
    expect(await notices('billing.suspended')).toHaveLength(1);
    // Vue d'ensemble : l'impayé est compté ; aucune étape à venir pour une organisation déjà suspendue.
    const overview = await billing.overview(at(46), 14);
    expect(overview.unpaid.count).toBeGreaterThanOrEqual(1);
    expect(overview.upcoming.some((u) => u.organizationId === orgs.a)).toBe(false);
  });

  it('règlement hors plateforme et réactivation ; journal d\'audit complet', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const res = await request(server()).post(`/v1/admin/platform-invoices/${state.secondInvoice}/mark-paid`).set(bearer(admin.tokens)).send({ reference: `VIR-E2E-${RUN}` }).expect(200);
    expect(res.body).toMatchObject({ status: 'paid', paymentMethod: 'offline', paymentReference: `VIR-E2E-${RUN}` });
    expect(mock.invoices.get(state.secondStripe)).toMatchObject({ status: 'paid', paidOutOfBand: true });
    expect((await subscription(orgs.a))!.status).toBe('active');
    expect((await organization(orgs.a)).status).toBe('active');
    expect(await notices('billing.reactivated')).toHaveLength(1);
    const again = await request(server()).post(`/v1/admin/platform-invoices/${state.secondInvoice}/mark-paid`).set(bearer(admin.tokens)).send({ reference: 'VIR-2' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PLATFORM_INVOICE_ALREADY_PAID');
    const ids = [state.subscriptionId, state.firstInvoice, state.secondInvoice];
    const actions = await until(
      async () => (await db(app!).select({ action: schema.auditLog.action }).from(schema.auditLog).where(inArray(schema.auditLog.entityId, ids))).map((a) => a.action),
      (list) => list.includes('platform_billing.invoice_marked_paid') && list.filter((a) => a === 'platform_billing.status_changed').length >= 4,
      'journal d\'audit de la facturation',
    );
    for (const action of ['platform_billing.subscribed', 'platform_billing.invoice_issued', 'platform_billing.invoice_paid', 'platform_billing.renewed', 'platform_billing.payment_failed', 'platform_billing.reminder_sent', 'platform_billing.status_changed', 'platform_billing.suspension_postponed', 'platform_billing.invoice_marked_paid']) {
      expect(actions, action).toContain(action);
    }
    const [marked] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, state.secondInvoice), eq(schema.auditLog.action, 'platform_billing.invoice_marked_paid')));
    expect(marked!.actorUserId).toBe(admin.userId);
    const [postponed] = await db(app).select().from(schema.auditLog).where(and(eq(schema.auditLog.entityId, state.subscriptionId), eq(schema.auditLog.action, 'platform_billing.suspension_postponed')));
    expect(postponed!.actorAgentCode).toBe('platform_billing');
  });

  it('essai : aucune facture pendant l\'essai, première facture à sa fin ; changement de formule ; résiliation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const created = await request(server()).post(`/v1/admin/organizations/${orgs.b}/subscription`).set(bearer(admin.tokens)).send({ planCode: SOLO, trialDays: 14 }).expect(200);
    expect(created.body).toMatchObject({ created: true, invoice: null, subscription: { status: 'trialing', startedAt: null, planCode: SOLO } });
    expect((await organization(orgs.b)).status).toBe('trial');
    const extended = await request(server()).post(`/v1/admin/organizations/${orgs.b}/subscription`).set(bearer(admin.tokens)).send({ planCode: SOLO, trialDays: 30 }).expect(200);
    expect(extended.body.created).toBe(false);
    const trialEndsAt = Date.parse(extended.body.subscription.trialEndsAt);
    expect(trialEndsAt - Date.parse(created.body.subscription.trialEndsAt)).toBeGreaterThan(15 * DAY);
    expect(await db(app).select().from(schema.platformInvoices).where(eq(schema.platformInvoices.organizationId, orgs.b))).toHaveLength(0);
    const report = await jobs.run(new Date(trialEndsAt + HOUR));
    expect(report.trialsEnded).toBeGreaterThanOrEqual(1);
    const started = (await subscription(orgs.b))!;
    expect(started).toMatchObject({ status: 'active' });
    expect(started.startedAt!.getTime()).toBe(trialEndsAt);
    const [firstB] = await db(app).select().from(schema.platformInvoices).where(eq(schema.platformInvoices.organizationId, orgs.b));
    expect((firstB!.lines as Array<{ code: string }>).map((l) => l.code)).toEqual(['setup_fee', 'subscription']);
    expect(firstB!.subtotalCents).toBe(14_800);
    expect((await organization(orgs.b)).status).toBe('active');
    // Changement de période (prochaine facture) ; un essai ne se redonne pas à un abonnement actif.
    const annual = await request(server()).post(`/v1/admin/organizations/${orgs.b}/subscription`).set(bearer(admin.tokens)).send({ planCode: SOLO, billingPeriod: 'annual' }).expect(200);
    expect(annual.body.subscription.billingPeriod).toBe('annual');
    // Sans période dans la demande, la période en cours est gardée.
    expect((await request(server()).post(`/v1/admin/organizations/${orgs.b}/subscription`).set(bearer(admin.tokens)).send({ planCode: SOLO }).expect(200)).body.subscription.billingPeriod).toBe('annual');
    const trial = await request(server()).post(`/v1/admin/organizations/${orgs.b}/subscription`).set(bearer(admin.tokens)).send({ planCode: SOLO, trialDays: 10 });
    expect(trial.status).toBe(409);
    expect(trial.body.code).toBe('TRIAL_NOT_AVAILABLE');
    const cancelled = await request(server()).post(`/v1/admin/organizations/${orgs.b}/subscription/cancel`).set(bearer(admin.tokens)).send({ reason: 'Fin du contrat (test)' }).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', monthlyRecurringRevenueCents: 0 });
    expect((await organization(orgs.b)).status).toBe('read_only');
    expect((await request(server()).get(`/v1/admin/organizations/${orgs.b}/subscription`).set(bearer(admin.tokens))).status).toBe(404);
  });

  it('panne du fournisseur : la facture est émise, transmise à la passe suivante ; vues de la plateforme et de l\'organisation', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    mock.unavailable = true;
    try {
      const res = await request(server()).post(`/v1/admin/organizations/${orgs.c}/subscription`).set(bearer(admin.tokens)).send({ planCode: SOLO }).expect(200);
      expect(res.body.subscription.stripeCustomerId).toBeNull();
      expect(res.body.invoice).toMatchObject({ status: 'open', stripeInvoiceId: null, totalCents: 14_800 + 740 + 1_476 });
    } finally {
      mock.unavailable = false;
    }
    const [pending] = await db(app).select().from(schema.platformInvoices).where(eq(schema.platformInvoices.organizationId, orgs.c));
    expect(await billing.unpushedInvoices()).toContain(pending!.id);
    expect(await billing.pushInvoiceById(pending!.id)).toBe(true);
    expect((await invoice(pending!.id)).stripeInvoiceId).toMatch(/^in_mock_/);
    expect((await subscription(orgs.c))!.stripeCustomerId).toMatch(/^cus_mockb_/);
    // Vue d'ensemble (My Hub de la plateforme) et cycle déclenché à la main.
    const overview = (await request(server()).get('/v1/admin/billing/overview?horizonDays=30').set(bearer(admin.tokens)).expect(200)).body;
    expect(overview.monthlyRecurringRevenueCents).toBeGreaterThanOrEqual(22_900 + 4_900);
    expect(overview.subscriptions.active).toBeGreaterThanOrEqual(2);
    expect(overview.upcoming.find((u: { organizationId: string }) => u.organizationId === orgs.c)).toMatchObject({ nextAction: 'read_only', invoiceNumber: pending!.number });
    const plans = (await request(server()).get('/v1/admin/billing/plans').set(bearer(admin.tokens)).expect(200)).body as Array<{ code: string; modules: string[] }>;
    expect(plans.find((p) => p.code === PRO)!.modules).not.toContain('platform');
    expect(Object.keys((await request(server()).post('/v1/admin/billing/run').set(bearer(admin.tokens)).expect(200)).body).sort()).toEqual(['errors', 'invoicesIssued', 'pastDue', 'postponed', 'pushed', 'reactivated', 'readOnly', 'reminders', 'renewed', 'suspended', 'trialsEnded']);
    // Vue de l'organisation (route /v1/org à la fusion) : aucun identifiant Stripe.
    const own = await billing.billingForOrganization(orgs.a);
    expect(own.subscription).toMatchObject({ status: 'active', planCode: PRO });
    expect(own.subscription).not.toHaveProperty('stripeCustomerId');
    expect(own.invoices).toHaveLength(2);
    expect(own.invoices[0]).not.toHaveProperty('stripeInvoiceId');
    expect(await billing.billingForOrganization(orgs.b)).toMatchObject({ subscription: null });
  });

  it('isolation : dans le contexte d\'une organisation, son abonnement et ses factures en lecture seule, rien des autres', async ({ skip }) => {
    if (!app) return skip('DATABASE_URL absente');
    const scope = app.get(OrgScopeService);
    const pathA = (await organization(orgs.a)).path;
    const invoices = await scope.run(pathA, async (tx) => tx.select({ organizationId: schema.platformInvoices.organizationId }).from(schema.platformInvoices).where(inArray(schema.platformInvoices.organizationId, [orgs.a, orgs.b, orgs.c])));
    expect(invoices.length).toBe(2);
    expect(new Set(invoices.map((i) => i.organizationId))).toEqual(new Set([orgs.a]));
    const subs = await scope.run(pathA, async (tx) => tx.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(inArray(schema.subscriptions.organizationId, [orgs.a, orgs.b, orgs.c])));
    expect(subs.map((s) => s.id)).toEqual([state.subscriptionId]);
    // Aucune écriture : la mise à jour ne voit aucune ligne, l'insertion est refusée par la politique.
    const updated = await scope.run(pathA, async (tx) => tx.update(schema.platformInvoices).set({ status: 'void' }).where(eq(schema.platformInvoices.organizationId, orgs.a)).returning({ id: schema.platformInvoices.id }));
    expect(updated).toHaveLength(0);
    await expect(scope.run(pathA, async (tx) => tx.update(schema.subscriptions).set({ status: 'active' }).where(eq(schema.subscriptions.id, state.subscriptionId)).returning({ id: schema.subscriptions.id }))).resolves.toHaveLength(0);
    await expect(scope.run(pathA, async (tx) => tx.insert(schema.subscriptions).values({ organizationId: orgs.a, planCode: SOLO, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + DAY), status: 'cancelled' }))).rejects.toThrow();
    // La vue de l'organisation fonctionne dans son contexte restreint (route /v1/org à la fusion).
    const own = await scope.run(pathA, () => billing.billingForOrganization(orgs.a));
    expect(own.subscription).toMatchObject({ planCode: PRO });
    expect(own.invoices).toHaveLength(2);
    expect((await scope.run(pathA, () => billing.billingForOrganization(orgs.c))).invoices).toHaveLength(0);
  });
});
