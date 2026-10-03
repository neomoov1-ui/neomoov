/**
 * Facturation de la plateforme (étape 25, amendement v1.2 section 8, décision D2) : abonnements des organisations
 * clientes aux formules Solo, Pro et Entreprise ; factures `PF-AAAA-NNNNNN` calculées par le domaine (frais
 * d'installation, abonnement, véhicules actifs, TPS et TVQ), numérotées sous verrou consultatif, transmises à Stripe
 * Billing qui les encaisse (simulé en test) ; webhook dédié ; règlement hors plateforme ; relances et suspension
 * progressive (jamais pendant une course) ; vue d'ensemble pour la plateforme et vue de l'organisation.
 *
 * Partage des rôles : Neomoov tient l'abonnement, les montants, la numérotation et les relances (une seule source de
 * vérité, règles du Québec) ; Stripe tient le client et encaisse chaque facture. Tout ce qui touche le fournisseur est
 * rejouable : une panne laisse la facture en attente de transmission, reprise par la passe quotidienne.
 */
import { schema } from '@neomoov/db';
import {
  billingPeriodEnd, computePlatformInvoice, dunningSchedule, dunningSettingsFrom, dunningStep, formatPlatformInvoiceNumber, localDate, monthlyRecurringRevenueCents,
  nextSubscriptionStatus, organizationStatusFor, planModules, QUEBEC_TAX_RATES, SUBSCRIPTION_STATUSES, suspensionForced, targetSubscriptionStatus, type BillingPortalSession,
  type BillingOverview, type BillingPeriod, type DunningSettings, type Language, type OrganizationBillingView, type PlatformInvoiceLine, type PlatformInvoiceView,
  type PlatformPlan, type PlatformPlanView, type SubscriptionStatus, type SubscriptionTransition, type SubscriptionUpsert, type SubscriptionView, type TaxRates,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { BILLING_PROVIDER, type BillingProvider, type BillingWebhookEvent } from '../../adapters/billing.types.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService, type AuditEntry } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { renderPlatformInvoicePdf } from './platform-invoice-pdf.js';

type SubscriptionRow = typeof schema.subscriptions.$inferSelect;
type InvoiceRow = typeof schema.platformInvoices.$inferSelect;
type PlanRow = typeof schema.plans.$inferSelect;
type OrganizationRow = typeof schema.organizations.$inferSelect;

const DAY_MS = 86_400_000;
/** Renouvellements rattrapés au plus en une passe (passe manquée pendant des mois). */
const MAX_CATCH_UP_PERIODS = 24;
const UNPAID = ['open', 'past_due'] as const;
/** États d'une course où un chauffeur y est engagé (domaine : ACTIVE_RIDE_STATES). */
const ACTIVE_RIDE_STATES = ['assigned', 'en_route', 'arrived', 'in_progress'] as const;
/** Abonnements renouvelés : pas de facture pendant l'essai, la suspension ni après la résiliation. */
const RENEWABLE: SubscriptionStatus[] = ['active', 'past_due', 'read_only'];
const DUNNED: SubscriptionStatus[] = ['active', 'past_due', 'read_only', 'suspended'];

export function planOf(row: PlanRow): PlatformPlan {
  const modules = Array.isArray(row.modules) ? (row.modules as unknown[]).filter((m): m is string => typeof m === 'string') : [];
  return {
    code: row.code, name: row.name, modules, setupFeeCents: row.setupFeeCents, monthlyPriceCents: row.monthlyPriceCents, annualPriceCents: row.annualPriceCents,
    perActiveVehicleCents: row.perActiveVehicleCents, includedVehicles: row.includedVehicles, currency: row.currency,
  };
}

function planView(row: PlanRow): PlatformPlanView {
  const plan = planOf(row);
  return { ...plan, modules: planModules(plan), active: row.active };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function uniqueViolation(error: unknown): string | null {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (e?.code ?? e?.cause?.code) === '23505' ? (e?.constraint_name ?? e?.cause?.constraint_name ?? '23505') : null;
}

function subscriptionView(row: SubscriptionRow, plan: PlanRow): SubscriptionView {
  return {
    id: row.id, organizationId: row.organizationId, planCode: row.planCode, plan: planView(plan), status: row.status as SubscriptionStatus, billingPeriod: row.billingPeriod as BillingPeriod,
    startedAt: iso(row.startedAt), currentPeriodStart: row.currentPeriodStart.toISOString(), currentPeriodEnd: row.currentPeriodEnd.toISOString(), trialEndsAt: iso(row.trialEndsAt),
    activeVehicles: row.activeVehicles, monthlyRecurringRevenueCents: monthlyRecurringRevenueCents(planOf(plan), { billingPeriod: row.billingPeriod as BillingPeriod, status: row.status as SubscriptionStatus, activeVehicles: row.activeVehicles }),
    cancelledAt: iso(row.cancelledAt), stripeCustomerId: row.stripeCustomerId, stripeSubscriptionId: row.stripeSubscriptionId, createdAt: row.createdAt.toISOString(),
  };
}

function invoiceView(row: InvoiceRow): PlatformInvoiceView {
  return {
    id: row.id, organizationId: row.organizationId, subscriptionId: row.subscriptionId, number: row.number, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
    lines: row.lines as PlatformInvoiceLine[], subtotalCents: row.subtotalCents, gstCents: row.gstCents, qstCents: row.qstCents, totalCents: row.totalCents, currency: row.currency,
    status: row.status as PlatformInvoiceView['status'], issuedAt: row.issuedAt.toISOString(), dueAt: row.dueAt.toISOString(), paidAt: iso(row.paidAt),
    paymentMethod: (row.paymentMethod as PlatformInvoiceView['paymentMethod']) ?? null, paymentReference: row.paymentReference, remindersSent: row.remindersSent,
    hostedInvoiceUrl: row.hostedInvoiceUrl, stripeInvoiceId: row.stripeInvoiceId, pdfAvailable: Boolean(row.pdfKey), createdAt: row.createdAt.toISOString(),
  };
}

/** Taux en parties par million → « 9,975 % ». */
function rateLabel(ppm: number): string {
  return `${(ppm / 10_000).toString().replace('.', ',')} %`;
}

export interface DunningOutcome {
  pastDue: boolean;
  reminded: boolean;
}

@Injectable()
export class PlatformBillingService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
    private readonly events: DomainEventsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  get providerName(): string {
    return this.billing.name;
  }

  // --- Formules ---

  async plans(): Promise<PlatformPlanView[]> {
    const rows = await this.db.select().from(schema.plans).orderBy(asc(schema.plans.monthlyPriceCents), asc(schema.plans.code));
    return rows.map(planView);
  }

  private async planRow(code: string): Promise<PlanRow> {
    const [row] = await this.db.select().from(schema.plans).where(eq(schema.plans.code, code)).limit(1);
    if (!row) throw AppError.notFound('PLAN_NOT_FOUND', `Formule inconnue : ${code}`);
    return row;
  }

  // --- Abonnements ---

  private async organization(organizationId: string): Promise<OrganizationRow> {
    const [org] = await this.db.select().from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    return org;
  }

  /** Abonnement en cours (non résilié) d'une organisation, s'il y en a un. */
  async currentSubscription(organizationId: string): Promise<SubscriptionRow | null> {
    const [row] = await this.db.select().from(schema.subscriptions).where(and(eq(schema.subscriptions.organizationId, organizationId), sql`${schema.subscriptions.status} <> 'cancelled'`)).limit(1);
    return row ?? null;
  }

  private async subscriptionById(id: string): Promise<SubscriptionRow | null> {
    const [row] = await this.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)).limit(1);
    return row ?? null;
  }

  async getSubscription(organizationId: string): Promise<SubscriptionView> {
    await this.organization(organizationId);
    const row = await this.currentSubscription(organizationId);
    if (!row) throw AppError.notFound('SUBSCRIPTION_NOT_FOUND', 'Cette organisation n\'a pas d\'abonnement en cours');
    return subscriptionView(row, await this.planRow(row.planCode));
  }

  /**
   * Crée l'abonnement d'une organisation cliente ou change sa formule et sa période (effet à la prochaine facture, sans
   * prorata). Sans essai, la première facture (frais d'installation compris) est émise tout de suite ; avec essai, à sa fin.
   */
  async upsertSubscription(organizationId: string, input: SubscriptionUpsert, actor: UserActor | null, now = new Date()): Promise<{ created: boolean; subscription: SubscriptionView; invoice: PlatformInvoiceView | null }> {
    const org = await this.organization(organizationId);
    if (org.type === 'platform' || !org.parentId) throw AppError.conflict('PLATFORM_NOT_BILLABLE', 'La plateforme ne s\'abonne pas à elle-même : choisissez une organisation cliente');
    if (org.status === 'closed') throw AppError.conflict('ORGANIZATION_CLOSED', 'Organisation fermée : rouvrez-la avant de l\'abonner');
    const plan = await this.planRow(input.planCode);
    if (!plan.active) throw AppError.conflict('PLAN_INACTIVE', `La formule ${plan.name} n'est plus proposée`);
    const existing = await this.currentSubscription(organizationId);
    if (existing) return this.changeSubscription(existing, org, plan, input, actor, now);

    const trialDays = input.trialDays ?? 0;
    const billingPeriod: BillingPeriod = input.billingPeriod ?? 'monthly';
    const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * DAY_MS) : null;
    const status: SubscriptionStatus = trialEndsAt ? 'trialing' : 'active';
    const customerId = await this.ensureCustomer(org, null);
    let row: SubscriptionRow;
    try {
      [row] = (await this.db.insert(schema.subscriptions).values({
        organizationId, planCode: plan.code, status, billingPeriod, startedAt: trialEndsAt ? null : now,
        currentPeriodStart: now, currentPeriodEnd: trialEndsAt ?? billingPeriodEnd(now, billingPeriod), trialEndsAt, stripeCustomerId: customerId,
      }).returning()) as [SubscriptionRow];
    } catch (error) {
      if (uniqueViolation(error) === 'subscriptions_org_current_unique') throw AppError.conflict('SUBSCRIPTION_EXISTS', 'Cette organisation a déjà un abonnement en cours');
      throw error;
    }
    await this.applyPlanToOrganization(org, plan, organizationStatusFor(status));
    await this.syncProvider(row);
    await this.record({ action: 'platform_billing.subscribed', entity: 'subscriptions', entityId: row.id, after: { organizationId, planCode: plan.code, billingPeriod, trialEndsAt: iso(trialEndsAt), by: actor?.userId ?? null } });
    this.events.emit('organization.subscribed', { organizationId, planCode: plan.code });
    const invoice = trialEndsAt ? null : (await this.issueInvoice(row, plan, { start: now, end: row.currentPeriodEnd }, true, now)).invoice;
    return { created: true, subscription: subscriptionView(row, plan), invoice };
  }

  private async changeSubscription(existing: SubscriptionRow, org: OrganizationRow, plan: PlanRow, input: SubscriptionUpsert, actor: UserActor | null, now: Date) {
    if (input.trialDays !== undefined && input.trialDays > 0 && existing.status !== 'trialing') throw AppError.conflict('TRIAL_NOT_AVAILABLE', 'Un essai ne se donne qu\'à la création de l\'abonnement (ou pour prolonger un essai en cours)');
    const billingPeriod = input.billingPeriod ?? (existing.billingPeriod as BillingPeriod);
    const set: Partial<typeof schema.subscriptions.$inferInsert> = { planCode: plan.code, billingPeriod };
    let endTrialNow = false;
    if (existing.status === 'trialing' && input.trialDays !== undefined) {
      if (input.trialDays > 0) {
        const trialEndsAt = new Date(now.getTime() + input.trialDays * DAY_MS);
        Object.assign(set, { trialEndsAt, currentPeriodEnd: trialEndsAt });
      } else endTrialNow = true;
    }
    const [row] = await this.db.update(schema.subscriptions).set(set).where(eq(schema.subscriptions.id, existing.id)).returning();
    await this.applyPlanToOrganization(org, plan, null);
    await this.syncProvider(row!);
    await this.record({ action: 'platform_billing.subscription_changed', entity: 'subscriptions', entityId: existing.id, before: { planCode: existing.planCode, billingPeriod: existing.billingPeriod, trialEndsAt: iso(existing.trialEndsAt) }, after: { planCode: plan.code, billingPeriod, trialEndsAt: iso(row!.trialEndsAt), by: actor?.userId ?? null } });
    if (existing.planCode !== plan.code) this.events.emit('organization.subscribed', { organizationId: org.id, planCode: plan.code });
    const invoice = endTrialNow ? await this.startBilling(row!, now, now) : null;
    const fresh = (await this.subscriptionById(existing.id))!;
    return { created: false, subscription: subscriptionView(fresh, plan), invoice };
  }

  /** Résiliation : plus aucune facture ; les factures impayées restent dues (rappels) ; l'organisation passe en lecture seule. */
  async cancelSubscription(organizationId: string, reason: string, actor: UserActor | null, now = new Date()): Promise<SubscriptionView> {
    const org = await this.organization(organizationId);
    const existing = await this.currentSubscription(organizationId);
    if (!existing) throw AppError.notFound('SUBSCRIPTION_NOT_FOUND', 'Cette organisation n\'a pas d\'abonnement en cours');
    const [row] = await this.db.update(schema.subscriptions).set({ status: 'cancelled', cancelledAt: now, cancelReason: reason }).where(eq(schema.subscriptions.id, existing.id)).returning();
    await this.setOrganizationStatus(org, organizationStatusFor('cancelled'));
    await this.syncProvider(row!);
    await this.record({ action: 'platform_billing.subscription_cancelled', entity: 'subscriptions', entityId: existing.id, before: { status: existing.status }, after: { status: 'cancelled', reason, by: actor?.userId ?? null } });
    return subscriptionView(row!, await this.planRow(row!.planCode));
  }

  /** Formule de l'organisation et modules de la formule (`organization_features`, source `plan` ; une dérogation reste). */
  private async applyPlanToOrganization(org: OrganizationRow, plan: PlanRow, status: string | null): Promise<void> {
    const set: Partial<typeof schema.organizations.$inferInsert> = { planCode: plan.code };
    if (status && org.status !== 'closed') set.status = status;
    await this.db.update(schema.organizations).set(set).where(eq(schema.organizations.id, org.id));
    const modules = planModules(planOf(plan));
    await this.db.delete(schema.organizationFeatures).where(and(eq(schema.organizationFeatures.organizationId, org.id), eq(schema.organizationFeatures.source, 'plan'), modules.length ? notInArray(schema.organizationFeatures.module, modules) : undefined));
    if (modules.length) await this.db.insert(schema.organizationFeatures).values(modules.map((module) => ({ organizationId: org.id, module, enabled: true, source: 'plan' }))).onConflictDoNothing();
  }

  private async setOrganizationStatus(org: Pick<OrganizationRow, 'id' | 'status'>, status: string): Promise<void> {
    if (org.status === 'closed' || org.status === status) return;
    await this.db.update(schema.organizations).set({ status }).where(and(eq(schema.organizations.id, org.id), sql`${schema.organizations.status} <> 'closed'`));
  }

  /** Client chez le fournisseur : créé une fois ; une panne n'empêche rien (repris à la transmission de la facture). */
  private async ensureCustomer(org: OrganizationRow, subscription: SubscriptionRow | null): Promise<string | null> {
    if (subscription?.stripeCustomerId) return subscription.stripeCustomerId;
    try {
      const owner = await this.owner(org.id);
      const { customerId } = await this.billing.createCustomer({ organizationId: org.id, name: org.legalName ?? org.name, email: owner?.email ?? null, language: owner?.language === 'en' ? 'en' : 'fr' });
      if (subscription) await this.db.update(schema.subscriptions).set({ stripeCustomerId: customerId }).where(eq(schema.subscriptions.id, subscription.id));
      return customerId;
    } catch (error) {
      this.logger.warn({ err: error, organizationId: org.id }, 'Client de facturation non créé chez le fournisseur (repris plus tard)');
      return null;
    }
  }

  private async syncProvider(row: SubscriptionRow): Promise<void> {
    if (!row.stripeCustomerId) return;
    try {
      await this.billing.syncSubscription(row.stripeCustomerId, { organizationId: row.organizationId, planCode: row.planCode, billingPeriod: row.billingPeriod as BillingPeriod, status: row.status });
    } catch (error) {
      this.logger.warn({ err: error, subscriptionId: row.id }, 'Abonnement non synchronisé chez le fournisseur');
    }
  }

  // --- Factures ---

  private async taxRates(): Promise<TaxRates> {
    const [gst, qst] = await Promise.all([this.settings.number('pricing.gst_rate_ppm', QUEBEC_TAX_RATES.gstRatePpm), this.settings.number('pricing.qst_rate_ppm', QUEBEC_TAX_RATES.qstRatePpm)]);
    return { gstRatePpm: gst, qstRatePpm: qst };
  }

  async dunningSettings(): Promise<DunningSettings> {
    const [reminderDays, readOnlyDays, suspendedDays] = await Promise.all([
      this.settings.get<unknown>('billing.reminder_days', undefined), this.settings.get<unknown>('billing.read_only_days', undefined), this.settings.get<unknown>('billing.suspended_days', undefined),
    ]);
    return dunningSettingsFrom({ reminderDays, readOnlyDays, suspendedDays });
  }

  /** Véhicules actifs de l'organisation et de son sous-arbre (véhicule rattaché, ou à défaut son chauffeur). */
  async activeVehicles(organizationId: string): Promise<number> {
    const [row] = await this.db.execute<{ n: number }>(sql`
      WITH scope AS (SELECT o.id FROM organizations o WHERE o.path LIKE (SELECT p.path FROM organizations p WHERE p.id = ${organizationId}) || '%')
      SELECT count(DISTINCT v.id)::int AS n FROM vehicles v LEFT JOIN drivers d ON d.id = v.driver_id
      WHERE v.status = 'active' AND (v.organization_id IN (SELECT id FROM scope) OR (v.organization_id IS NULL AND d.organization_id IN (SELECT id FROM scope)))`);
    return Number(row?.n ?? 0);
  }

  /** Une course est-elle en cours dans l'organisation (sa course, ou celle d'un de ses chauffeurs) ? */
  async hasActiveRide(organizationId: string): Promise<boolean> {
    const [row] = await this.db.execute<{ active: boolean }>(sql`
      WITH scope AS (SELECT o.id FROM organizations o WHERE o.path LIKE (SELECT p.path FROM organizations p WHERE p.id = ${organizationId}) || '%')
      SELECT EXISTS (SELECT 1 FROM rides r LEFT JOIN drivers d ON d.id = r.driver_id
        WHERE r.state::text IN (${sql.join(ACTIVE_RIDE_STATES.map((s) => sql`${s}`), sql`, `)})
          AND (r.organization_id IN (SELECT id FROM scope) OR d.organization_id IN (SELECT id FROM scope))) AS active`);
    return Boolean(row?.active);
  }

  /**
   * Émet la facture d'une période : calcul par le domaine (véhicules actifs comptés maintenant), numéro de l'année sous
   * verrou consultatif, une seule facture par période (rejouable), puis transmission au fournisseur, PDF et courriel au
   * propriétaire. Le fournisseur ou le stockage en panne : la facture reste émise, la passe quotidienne reprend.
   */
  async issueInvoice(subscription: SubscriptionRow, plan: PlanRow, period: { start: Date; end: Date }, first: boolean, now: Date): Promise<{ invoice: PlatformInvoiceView; created: boolean }> {
    const vehicles = await this.activeVehicles(subscription.organizationId);
    const computed = computePlatformInvoice(planOf(plan), { billingPeriod: subscription.billingPeriod as BillingPeriod }, vehicles, period, first, await this.taxRates());
    const terms = await this.settings.number('billing.payment_terms_days', 0);
    const dueAt = new Date(now.getTime() + Math.max(0, terms) * DAY_MS);
    const year = Number(localDate(now, this.env.TIMEZONE).date.slice(0, 4));
    const free = computed.totalCents === 0;
    const inserted = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`platform_invoices:${year}`}))`);
      const [last] = await tx.execute<{ n: number | null }>(sql`SELECT max(substring(number from 9)::int) AS n FROM platform_invoices WHERE number LIKE ${`PF-${year}-%`}`);
      return tx.insert(schema.platformInvoices).values({
        organizationId: subscription.organizationId, subscriptionId: subscription.id, number: formatPlatformInvoiceNumber(year, Number(last?.n ?? 0) + 1),
        periodStart: computed.periodStart, periodEnd: computed.periodEnd, lines: computed.lines, subtotalCents: computed.subtotalCents, gstCents: computed.gstCents,
        qstCents: computed.qstCents, totalCents: computed.totalCents, status: free ? 'paid' : 'open', issuedAt: now, dueAt, paidAt: free ? now : null,
      }).onConflictDoNothing().returning();
    });
    await this.db.update(schema.subscriptions).set({ activeVehicles: vehicles }).where(eq(schema.subscriptions.id, subscription.id));
    if (!inserted[0]) {
      // Période déjà facturée (passe rejouée, deux processus) : la facture existante.
      const [existing] = await this.db.select().from(schema.platformInvoices).where(and(eq(schema.platformInvoices.subscriptionId, subscription.id), eq(schema.platformInvoices.periodStart, period.start), sql`${schema.platformInvoices.status} <> 'void'`)).limit(1);
      if (!existing) throw new AppError('PLATFORM_INVOICE_CONFLICT', 'Facture de la période introuvable après un conflit', 500);
      return { invoice: invoiceView(existing), created: false };
    }
    let row = inserted[0];
    await this.record({ action: 'platform_billing.invoice_issued', entity: 'platform_invoices', entityId: row.id, after: { number: row.number, organizationId: row.organizationId, totalCents: row.totalCents, activeVehicles: vehicles, first } });
    row = (await this.pushInvoice(row, now).catch((error: unknown) => {
      this.logger.warn({ err: error, invoiceId: row.id }, 'Facture de la plateforme non transmise au fournisseur (reprise par la passe quotidienne)');
      return null;
    })) ?? row;
    row = (await this.renderPdf(row).catch((error: unknown) => {
      this.logger.warn({ err: error, invoiceId: row.id }, 'PDF de la facture de la plateforme non produit (produit à la demande)');
      return null;
    })) ?? row;
    await this.notifyOwner(row.organizationId, 'billing.invoice_issued', { ...(await this.invoiceData(row)), platformInvoiceId: row.id, planName: plan.name, periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString() });
    return { invoice: invoiceView(row), created: true };
  }

  /** Transmet une facture au fournisseur (client créé au besoin) ; rejouable par sa clé d'idempotence. */
  async pushInvoice(row: InvoiceRow, now = new Date()): Promise<InvoiceRow | null> {
    if (row.stripeInvoiceId || row.totalCents === 0 || !UNPAID.includes(row.status as (typeof UNPAID)[number])) return null;
    const subscription = await this.subscriptionById(row.subscriptionId);
    const customerId = await this.ensureCustomer(await this.organization(row.organizationId), subscription);
    if (!customerId) throw new AppError('BILLING_PROVIDER_ERROR', 'Client de facturation indisponible chez le fournisseur', 502);
    const [rates, gst, qst] = await Promise.all([this.taxRates(), this.settings.get<unknown>('company.gst_number', ''), this.settings.get<unknown>('company.qst_number', '')]);
    const taxId = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const result = await this.billing.createInvoice({
      platformInvoiceId: row.id, number: row.number, organizationId: row.organizationId, customerId, currency: 'CAD', issuedAt: row.issuedAt, dueAt: row.dueAt, totalCents: row.totalCents,
      lines: (row.lines as PlatformInvoiceLine[]).map((l) => ({ label: l.label, amountCents: l.amountCents })),
      taxes: [{ label: `TPS (${rateLabel(rates.gstRatePpm)})`, amountCents: row.gstCents }, { label: `TVQ (${rateLabel(rates.qstRatePpm)})`, amountCents: row.qstCents }],
      taxNumbers: { gst: taxId(gst), qst: taxId(qst) },
    });
    const [updated] = await this.db.update(schema.platformInvoices).set({ stripeInvoiceId: result.invoiceId, hostedInvoiceUrl: result.hostedInvoiceUrl }).where(and(eq(schema.platformInvoices.id, row.id), isNull(schema.platformInvoices.stripeInvoiceId))).returning();
    this.logger.info({ invoiceId: row.id, provider: this.billing.name, at: now.toISOString() }, 'Facture de la plateforme transmise au fournisseur');
    return updated ?? null;
  }

  async pushInvoiceById(id: string, now = new Date()): Promise<boolean> {
    const row = await this.invoiceRow(id);
    return Boolean(await this.pushInvoice(row, now));
  }

  /** Factures émises, impayées et pas encore transmises au fournisseur (panne au moment de l'émission). */
  async unpushedInvoices(limit = 200): Promise<string[]> {
    const rows = await this.db.select({ id: schema.platformInvoices.id }).from(schema.platformInvoices)
      .where(and(isNull(schema.platformInvoices.stripeInvoiceId), inArray(schema.platformInvoices.status, [...UNPAID]), sql`${schema.platformInvoices.totalCents} > 0`))
      .orderBy(asc(schema.platformInvoices.issuedAt)).limit(limit);
    return rows.map((r) => r.id);
  }

  private async renderPdf(row: InvoiceRow): Promise<InvoiceRow> {
    const org = await this.organization(row.organizationId);
    const [legalName, address, gst, qst] = await Promise.all([
      this.settings.string('company.legal_name', 'Neomoov'), this.settings.string('company.address', 'Montréal (Québec)'),
      this.settings.get<unknown>('company.gst_number', ''), this.settings.get<unknown>('company.qst_number', ''),
    ]);
    const rates = await this.taxRates();
    const taxId = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const pdf = await renderPlatformInvoicePdf({
      invoice: invoiceView(row), rates, timeZone: this.env.TIMEZONE,
      seller: { name: legalName, address, gstNumber: taxId(gst), qstNumber: taxId(qst) },
      customer: { name: org.legalName ?? org.name, gstNumber: org.gstNumber, qstNumber: org.qstNumber },
    });
    const key = row.pdfKey ?? `platform-invoices/${row.organizationId}/${row.number}.pdf`;
    await this.storage.putObject({ key, body: pdf, contentType: 'application/pdf' });
    if (row.pdfKey) return row;
    const [updated] = await this.db.update(schema.platformInvoices).set({ pdfKey: key }).where(eq(schema.platformInvoices.id, row.id)).returning();
    return updated ?? row;
  }

  /** PDF d'une facture (produit à la demande s'il manque). */
  async pdf(id: string): Promise<{ body: Buffer; filename: string }> {
    let row = await this.invoiceRow(id);
    let file = row.pdfKey ? await this.storage.getObject(row.pdfKey) : null;
    if (!file) {
      row = await this.renderPdf(row);
      file = await this.storage.getObject(row.pdfKey!);
    }
    if (!file) throw AppError.conflict('PLATFORM_INVOICE_PDF_PENDING', 'Le PDF de la facture est en préparation : réessayez dans un instant');
    return { body: file.body, filename: `facture-${row.number}.pdf` };
  }

  private async invoiceRow(id: string): Promise<InvoiceRow> {
    const [row] = await this.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.id, id)).limit(1);
    if (!row) throw AppError.notFound('PLATFORM_INVOICE_NOT_FOUND', 'Facture de la plateforme introuvable');
    return row;
  }

  async invoices(organizationId: string): Promise<PlatformInvoiceView[]> {
    await this.organization(organizationId);
    const rows = await this.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.organizationId, organizationId)).orderBy(desc(schema.platformInvoices.issuedAt), desc(schema.platformInvoices.number));
    return rows.map(invoiceView);
  }

  /** Données communes des courriels d'une facture (montant, échéance, lien de paiement). */
  private async invoiceData(row: InvoiceRow): Promise<Record<string, unknown>> {
    const [org] = await this.db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, row.organizationId)).limit(1);
    return { number: row.number, totalCents: row.totalCents, dueAt: row.dueAt.toISOString(), hostedInvoiceUrl: row.hostedInvoiceUrl, organizationName: org?.name ?? '' };
  }

  // --- Règlements ---

  /**
   * Règlement hors plateforme (virement, chèque, Interac) noté par le personnel avec sa référence. Le fournisseur est
   * prévenu d'abord (facture marquée payée chez Stripe, sinon il prélèverait une seconde fois) ; puis réactivation si plus
   * rien n'est en retard.
   */
  async markPaid(id: string, input: { reference: string; paidAt?: string | undefined }, actor: UserActor | null, now = new Date()): Promise<PlatformInvoiceView> {
    const row = await this.invoiceRow(id);
    if (row.status === 'paid') throw AppError.conflict('PLATFORM_INVOICE_ALREADY_PAID', 'Cette facture est déjà payée');
    if (!UNPAID.includes(row.status as (typeof UNPAID)[number])) throw AppError.conflict('PLATFORM_INVOICE_NOT_PAYABLE', 'Cette facture n\'est pas à payer');
    const paidAt = input.paidAt ? new Date(input.paidAt) : now;
    if (paidAt.getTime() > now.getTime() + 300_000) throw new AppError('PAID_AT_IN_FUTURE', 'La date du règlement ne peut pas être dans le futur', 400);
    if (row.stripeInvoiceId) await this.billing.markPaidOutOfBand(row.stripeInvoiceId);
    const [updated] = await this.db.update(schema.platformInvoices).set({ status: 'paid', paidAt, paymentMethod: 'offline', paymentReference: input.reference })
      .where(and(eq(schema.platformInvoices.id, id), inArray(schema.platformInvoices.status, [...UNPAID]))).returning();
    if (!updated) throw AppError.conflict('PLATFORM_INVOICE_ALREADY_PAID', 'Cette facture vient d\'être payée');
    await this.record({ action: 'platform_billing.invoice_marked_paid', entity: 'platform_invoices', entityId: id, before: { status: row.status }, after: { status: 'paid', method: 'offline', reference: input.reference, paidAt: paidAt.toISOString(), by: actor?.userId ?? null } });
    await this.afterPayment(updated.subscriptionId, now);
    return invoiceView(updated);
  }

  /** Après un paiement : le statut suit les factures qui restent impayées (réactivation) ; une erreur n'annule pas le paiement. */
  private async afterPayment(subscriptionId: string, now: Date): Promise<void> {
    try {
      await this.applyStatus(subscriptionId, now);
    } catch (error) {
      this.logger.error({ err: error, subscriptionId }, 'Statut de l\'abonnement non recalculé après un paiement');
    }
  }

  // --- Webhook de Stripe Billing ---

  verifyWebhook(rawBody: Buffer, signature: string): Promise<BillingWebhookEvent> {
    return this.billing.verifyWebhook(rawBody, signature);
  }

  /**
   * Un événement n'est appliqué qu'une fois : il est enregistré dans `webhook_events` (identifiant préfixé `billing_`,
   * distinct des événements de paiement) après son traitement, avec son issue ; un échec ne laisse aucune trace et rend
   * une erreur à Stripe, qui renvoie l'événement plus tard (les traitements sont rejouables).
   */
  async handleWebhook(event: BillingWebhookEvent, now = new Date()): Promise<{ duplicate: boolean; status: 'processed' | 'ignored' }> {
    if (typeof event?.id !== 'string' || typeof event.type !== 'string') throw new AppError('WEBHOOK_EVENT_INVALID', 'Événement de webhook illisible', 400);
    const id = `billing_${event.id}`.slice(0, 100);
    const [seen] = await this.db.select({ status: schema.webhookEvents.status }).from(schema.webhookEvents).where(eq(schema.webhookEvents.id, id)).limit(1);
    if (seen) return { duplicate: true, status: seen.status === 'processed' ? 'processed' : 'ignored' };
    const handled = await this.applyWebhook(event, now);
    const status = handled ? 'processed' : 'ignored';
    await this.db.insert(schema.webhookEvents).values({ id, provider: `${this.billing.name}_billing`.slice(0, 20), type: event.type.slice(0, 80), payload: event as unknown as Record<string, unknown>, status, attempts: 1, processedAt: now }).onConflictDoNothing();
    return { duplicate: false, status };
  }

  private async invoiceForEvent(object: Record<string, unknown>): Promise<InvoiceRow | null> {
    const stripeId = typeof object['id'] === 'string' ? object['id'] : null;
    if (stripeId) {
      const [row] = await this.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.stripeInvoiceId, stripeId)).limit(1);
      if (row) return row;
    }
    // Facture créée chez Stripe mais identifiant non enregistré (panne entre les deux) : retrouvée par ses métadonnées.
    const platformId = (object['metadata'] as Record<string, unknown> | undefined)?.['neomoov_platform_invoice_id'];
    if (typeof platformId !== 'string' || !/^[0-9a-f-]{36}$/i.test(platformId)) return null;
    const [row] = await this.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.id, platformId)).limit(1);
    if (row && stripeId && !row.stripeInvoiceId) await this.db.update(schema.platformInvoices).set({ stripeInvoiceId: stripeId }).where(eq(schema.platformInvoices.id, row.id));
    return row ?? null;
  }

  private async applyWebhook(event: BillingWebhookEvent, now: Date): Promise<boolean> {
    const object = (event.data?.object ?? {}) as Record<string, unknown>;
    switch (event.type) {
      case 'invoice.paid': {
        const row = await this.invoiceForEvent(object);
        if (!row) return false;
        const [updated] = await this.db.update(schema.platformInvoices)
          .set({ status: 'paid', paidAt: now, paymentMethod: 'stripe', paymentReference: typeof object['payment_intent'] === 'string' ? object['payment_intent'] : null, paymentFailureCode: null })
          .where(and(eq(schema.platformInvoices.id, row.id), inArray(schema.platformInvoices.status, [...UNPAID]))).returning();
        if (!updated) return true;
        await this.record({ action: 'platform_billing.invoice_paid', entity: 'platform_invoices', entityId: row.id, before: { status: row.status }, after: { status: 'paid', method: 'stripe', eventId: event.id } });
        await this.afterPayment(row.subscriptionId, now);
        return true;
      }
      case 'invoice.payment_failed': {
        const row = await this.invoiceForEvent(object);
        if (!row) return false;
        const error = (object['last_payment_error'] ?? {}) as { code?: unknown; decline_code?: unknown };
        const code = [error.decline_code, error.code].find((c): c is string => typeof c === 'string') ?? 'payment_failed';
        const [updated] = await this.db.update(schema.platformInvoices).set({ status: 'past_due', paymentFailureCode: code.slice(0, 60) })
          .where(and(eq(schema.platformInvoices.id, row.id), inArray(schema.platformInvoices.status, [...UNPAID]))).returning();
        if (!updated) return true;
        await this.record({ action: 'platform_billing.payment_failed', entity: 'platform_invoices', entityId: row.id, before: { status: row.status }, after: { status: 'past_due', failureCode: code, eventId: event.id } });
        await this.applyStatus(row.subscriptionId, now);
        return true;
      }
      case 'invoice.voided': {
        const row = await this.invoiceForEvent(object);
        if (!row) return false;
        const [updated] = await this.db.update(schema.platformInvoices).set({ status: 'void' }).where(and(eq(schema.platformInvoices.id, row.id), inArray(schema.platformInvoices.status, [...UNPAID]))).returning();
        if (updated) {
          await this.record({ action: 'platform_billing.invoice_voided', entity: 'platform_invoices', entityId: row.id, before: { status: row.status }, after: { status: 'void', eventId: event.id } });
          await this.afterPayment(row.subscriptionId, now);
        }
        return true;
      }
      // `customer.subscription.updated` : l'abonnement est tenu par Neomoov, aucun objet Subscription chez Stripe
      // (décision du 1er octobre 2026) ; l'événement est enregistré et ignoré. Idem pour les autres types.
      default:
        return false;
    }
  }

  // --- Cycle : essais, renouvellements, relances, statuts ---

  /** Abonnements à l'essai dont l'essai est terminé. */
  async endedTrials(now: Date): Promise<string[]> {
    const rows = await this.db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.status, 'trialing'), lte(schema.subscriptions.trialEndsAt, now))).orderBy(asc(schema.subscriptions.trialEndsAt));
    return rows.map((r) => r.id);
  }

  /** Fin de l'essai : la facturation commence à la date de fin d'essai ; première facture avec les frais d'installation. */
  async endTrial(id: string, now: Date): Promise<PlatformInvoiceView | null> {
    const row = await this.subscriptionById(id);
    if (!row || row.status !== 'trialing' || !row.trialEndsAt || row.trialEndsAt > now) return null;
    return this.startBilling(row, row.trialEndsAt, now);
  }

  private async startBilling(row: SubscriptionRow, start: Date, now: Date): Promise<PlatformInvoiceView | null> {
    const end = billingPeriodEnd(start, row.billingPeriod as BillingPeriod);
    const [started] = await this.db.update(schema.subscriptions).set({ status: 'active', startedAt: start, currentPeriodStart: start, currentPeriodEnd: end, trialEndsAt: row.trialEndsAt && row.trialEndsAt < start ? row.trialEndsAt : start })
      .where(and(eq(schema.subscriptions.id, row.id), eq(schema.subscriptions.status, 'trialing'))).returning();
    if (!started) return null;
    const org = await this.organization(row.organizationId);
    await this.setOrganizationStatus(org, 'active');
    await this.syncProvider(started);
    await this.record({ action: 'platform_billing.trial_ended', entity: 'subscriptions', entityId: row.id, before: { status: 'trialing' }, after: { status: 'active', startedAt: start.toISOString() } });
    return (await this.issueInvoice(started, await this.planRow(started.planCode), { start, end }, true, now)).invoice;
  }

  /** Abonnements dont la période est échue (renouvellement d'avance de la période suivante). */
  async dueRenewals(now: Date): Promise<string[]> {
    const rows = await this.db.select({ id: schema.subscriptions.id }).from(schema.subscriptions)
      .where(and(inArray(schema.subscriptions.status, RENEWABLE), lte(schema.subscriptions.currentPeriodEnd, now))).orderBy(asc(schema.subscriptions.currentPeriodEnd));
    return rows.map((r) => r.id);
  }

  /**
   * Renouvelle un abonnement : une facture par période échue (véhicules actifs comptés à l'émission), au jour d'ancrage
   * de l'abonnement ; une passe manquée est rattrapée (24 périodes au plus). Renvoie le nombre de factures émises.
   */
  async renew(id: string, now: Date): Promise<number> {
    let row = await this.subscriptionById(id);
    let issued = 0;
    for (let i = 0; row && RENEWABLE.includes(row.status as SubscriptionStatus) && row.currentPeriodEnd <= now && i < MAX_CATCH_UP_PERIODS; i += 1) {
      const start = row.currentPeriodEnd;
      const end = billingPeriodEnd(start, row.billingPeriod as BillingPeriod, (row.startedAt ?? row.currentPeriodStart).getUTCDate());
      const plan = await this.planRow(row.planCode);
      if ((await this.issueInvoice(row, plan, { start, end }, false, now)).created) issued += 1;
      const [next] = await this.db.update(schema.subscriptions).set({ currentPeriodStart: start, currentPeriodEnd: end })
        .where(and(eq(schema.subscriptions.id, row.id), eq(schema.subscriptions.currentPeriodEnd, start))).returning();
      row = next ?? null;
    }
    if (issued) await this.record({ action: 'platform_billing.renewed', entity: 'subscriptions', entityId: id, after: { invoices: issued, at: now.toISOString() } });
    return issued;
  }

  /** Factures impayées (rappels et retards). */
  async unpaidInvoices(): Promise<string[]> {
    const rows = await this.db.select({ id: schema.platformInvoices.id }).from(schema.platformInvoices).where(inArray(schema.platformInvoices.status, [...UNPAID])).orderBy(asc(schema.platformInvoices.dueAt));
    return rows.map((r) => r.id);
  }

  /** Relance d'une facture : retard constaté après l'échéance, rappel à +3, +7 et +14 jours (chacun une seule fois). */
  async dunInvoice(id: string, now: Date, settings?: DunningSettings): Promise<DunningOutcome> {
    const row = await this.invoiceRow(id);
    const outcome: DunningOutcome = { pastDue: false, reminded: false };
    const step = dunningStep({ status: row.status as PlatformInvoiceView['status'], dueAt: row.dueAt, remindersSent: row.remindersSent }, now, settings ?? (await this.dunningSettings()));
    if (step.pastDue && row.status === 'open') {
      const [updated] = await this.db.update(schema.platformInvoices).set({ status: 'past_due' }).where(and(eq(schema.platformInvoices.id, id), eq(schema.platformInvoices.status, 'open'))).returning({ id: schema.platformInvoices.id });
      if (updated) {
        outcome.pastDue = true;
        await this.record({ action: 'platform_billing.invoice_past_due', entity: 'platform_invoices', entityId: id, before: { status: 'open' }, after: { status: 'past_due', dueAt: row.dueAt.toISOString() } });
      }
    }
    if (step.action === 'remind' && step.reminder !== null) {
      const [updated] = await this.db.update(schema.platformInvoices).set({ remindersSent: step.reminder, lastReminderAt: now })
        .where(and(eq(schema.platformInvoices.id, id), eq(schema.platformInvoices.remindersSent, row.remindersSent))).returning();
      if (updated) {
        outcome.reminded = true;
        const schedule = dunningSchedule(row.dueAt, settings ?? (await this.dunningSettings()));
        await this.notifyOwner(row.organizationId, 'billing.reminder', { ...(await this.invoiceData(updated)), platformInvoiceId: id, reminder: step.reminder, daysOverdue: step.daysOverdue, readOnlyAt: schedule.readOnlyAt.toISOString() });
        await this.record({ action: 'platform_billing.reminder_sent', entity: 'platform_invoices', entityId: id, after: { reminder: step.reminder, daysOverdue: step.daysOverdue } });
      }
    }
    return outcome;
  }

  /** Abonnements dont le statut suit les factures (relances, lecture seule, suspension, réactivation). */
  async dunnedSubscriptions(): Promise<string[]> {
    const rows = await this.db.select({ id: schema.subscriptions.id }).from(schema.subscriptions).where(inArray(schema.subscriptions.status, DUNNED)).orderBy(asc(schema.subscriptions.createdAt));
    return rows.map((r) => r.id);
  }

  /**
   * Statut d'un abonnement d'après ses factures impayées (domaine) : en retard, lecture seule à +30 jours, suspension à
   * +45 jours sauf course en cours dans l'organisation (reportée à la passe du lendemain), retour à l'actif quand tout
   * est réglé. L'organisation suit (lecture seule, suspendue, active) ; son propriétaire est prévenu.
   */
  async applyStatus(id: string, now: Date): Promise<SubscriptionTransition> {
    const row = await this.subscriptionById(id);
    const unchanged: SubscriptionTransition = { status: (row?.status ?? 'cancelled') as SubscriptionStatus, escalated: false, postponed: false, reactivated: false };
    if (!row || !DUNNED.includes(row.status as SubscriptionStatus)) return unchanged;
    const current = row.status as SubscriptionStatus;
    const unpaid = await this.db.select({ id: schema.platformInvoices.id, number: schema.platformInvoices.number, status: schema.platformInvoices.status, dueAt: schema.platformInvoices.dueAt, remindersSent: schema.platformInvoices.remindersSent })
      .from(schema.platformInvoices).where(and(eq(schema.platformInvoices.subscriptionId, id), inArray(schema.platformInvoices.status, [...UNPAID]))).orderBy(asc(schema.platformInvoices.dueAt));
    const settings = await this.dunningSettings();
    const target = targetSubscriptionStatus(current, unpaid.map((u) => ({ status: u.status as PlatformInvoiceView['status'], dueAt: u.dueAt, remindersSent: u.remindersSent })), now, settings);
    const activeRide = target === 'suspended' && current !== 'suspended' ? await this.hasActiveRide(row.organizationId) : false;
    // Finalisation du 3 octobre 2026 (proposition de la section 9, désactivée par défaut) : report trop long, suspension forcée.
    const forceDays = await this.settings.number('billing.force_suspension_after_postponed_days', 0);
    const forceSuspension = activeRide && suspensionForced(row.suspensionPostponedAt, now, forceDays);
    const transition = nextSubscriptionStatus(current, target, { activeRide, forceSuspension });
    const oldest = unpaid[0];
    if (transition.postponed) {
      await this.record({ action: 'platform_billing.suspension_postponed', entity: 'subscriptions', entityId: id, after: { reason: 'active_ride', invoice: oldest?.number ?? null, at: now.toISOString(), since: (row.suspensionPostponedAt ?? now).toISOString() } });
      if (!row.suspensionPostponedAt) await this.db.update(schema.subscriptions).set({ suspensionPostponedAt: now }).where(eq(schema.subscriptions.id, id));
    } else if (row.suspensionPostponedAt && target !== 'suspended') {
      // Plus de suspension visée (paiement) : le report prend fin.
      await this.db.update(schema.subscriptions).set({ suspensionPostponedAt: null }).where(eq(schema.subscriptions.id, id));
    }
    if (forceSuspension && transition.status === 'suspended') {
      await this.record({ action: 'platform_billing.suspension_forced', entity: 'subscriptions', entityId: id, after: { postponedSince: row.suspensionPostponedAt?.toISOString() ?? null, days: forceDays, invoice: oldest?.number ?? null } });
    }
    if (transition.status === current) return transition;
    const set: Partial<typeof schema.subscriptions.$inferInsert> = { status: transition.status, ...(transition.postponed ? {} : { suspensionPostponedAt: null }) };
    // Sortie de suspension : aucune facture pendant la suspension ; la période en cours repart du règlement.
    if (current === 'suspended' && row.currentPeriodEnd < now) Object.assign(set, { currentPeriodEnd: now, startedAt: now });
    const [updated] = await this.db.update(schema.subscriptions).set(set).where(and(eq(schema.subscriptions.id, id), eq(schema.subscriptions.status, current))).returning();
    if (!updated) return { ...transition, status: current, escalated: false, reactivated: false };
    const org = await this.organization(row.organizationId);
    await this.setOrganizationStatus(org, organizationStatusFor(transition.status));
    await this.syncProvider(updated);
    await this.record({ action: 'platform_billing.status_changed', entity: 'subscriptions', entityId: id, before: { status: current }, after: { status: transition.status, organizationStatus: organizationStatusFor(transition.status), invoice: oldest?.number ?? null, postponed: transition.postponed } });
    const template = transition.reactivated ? 'billing.reactivated' : transition.status === 'read_only' ? 'billing.read_only' : transition.status === 'suspended' ? 'billing.suspended' : null;
    if (template) {
      const invoiceRow = oldest ? await this.invoiceRow(oldest.id) : null;
      const schedule = oldest ? dunningSchedule(oldest.dueAt, settings) : null;
      await this.notifyOwner(row.organizationId, template, {
        ...(invoiceRow ? await this.invoiceData(invoiceRow) : { organizationName: org.name }), ...(invoiceRow ? { platformInvoiceId: invoiceRow.id } : {}),
        ...(schedule ? { readOnlyAt: schedule.readOnlyAt.toISOString(), suspendAt: schedule.suspendAt.toISOString() } : {}),
      });
    }
    return transition;
  }

  // --- Vues ---

  /** Revenu mensuel récurrent, abonnements par statut, impayés, lectures seules et suspensions à venir. */
  async overview(now = new Date(), horizonDays = 14): Promise<BillingOverview> {
    const subs = await this.db.select({ subscription: schema.subscriptions, plan: schema.plans }).from(schema.subscriptions).innerJoin(schema.plans, eq(schema.plans.code, schema.subscriptions.planCode));
    const counts = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as BillingOverview['subscriptions'];
    let mrr = 0;
    for (const { subscription, plan } of subs) {
      counts[subscription.status as SubscriptionStatus] += 1;
      mrr += monthlyRecurringRevenueCents(planOf(plan), { billingPeriod: subscription.billingPeriod as BillingPeriod, status: subscription.status as SubscriptionStatus, activeVehicles: subscription.activeVehicles });
    }
    const unpaid = await this.db.select({ invoice: schema.platformInvoices, organizationName: schema.organizations.name, subscriptionStatus: schema.subscriptions.status })
      .from(schema.platformInvoices)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.platformInvoices.organizationId))
      .innerJoin(schema.subscriptions, eq(schema.subscriptions.id, schema.platformInvoices.subscriptionId))
      .where(inArray(schema.platformInvoices.status, [...UNPAID])).orderBy(asc(schema.platformInvoices.dueAt));
    const settings = await this.dunningSettings();
    const horizon = now.getTime() + horizonDays * DAY_MS;
    const upcoming: BillingOverview['upcoming'] = [];
    let overdueCount = 0;
    let overdueCents = 0;
    for (const { invoice, organizationName, subscriptionStatus } of unpaid) {
      const overdue = invoice.status === 'past_due' || invoice.dueAt < now;
      if (overdue) {
        overdueCount += 1;
        overdueCents += invoice.totalCents;
      }
      if (subscriptionStatus === 'suspended' || subscriptionStatus === 'cancelled' || subscriptionStatus === 'trialing') continue;
      const schedule = dunningSchedule(invoice.dueAt, settings);
      const later = (at: Date) => (at < now ? now : at);
      const next = subscriptionStatus === 'read_only' ? { action: 'suspend' as const, at: later(schedule.suspendAt) } : { action: 'read_only' as const, at: later(schedule.readOnlyAt) };
      if (next.at.getTime() > horizon) continue;
      upcoming.push({
        organizationId: invoice.organizationId, organizationName, invoiceId: invoice.id, invoiceNumber: invoice.number, totalCents: invoice.totalCents, dueAt: invoice.dueAt.toISOString(),
        daysOverdue: Math.floor((now.getTime() - invoice.dueAt.getTime()) / DAY_MS), nextAction: next.action, at: next.at.toISOString(),
      });
    }
    upcoming.sort((a, b) => a.at.localeCompare(b.at));
    return {
      monthlyRecurringRevenueCents: mrr, subscriptions: counts,
      unpaid: { count: unpaid.length, totalCents: unpaid.reduce((sum, u) => sum + u.invoice.totalCents, 0), overdueCount, overdueCents }, upcoming,
    };
  }

  /**
   * Vue d'une organisation sur sa propre facturation : abonnement et factures, sans aucun identifiant Stripe. Route
   * `GET /v1/org/:organizationId/billing` (garde des organisations) ; appelée dans le contexte restreint de
   * l'organisation, les politiques en lecture seule de la base s'appliquent.
   */
  async billingForOrganization(organizationId: string): Promise<OrganizationBillingView> {
    const row = await this.currentSubscription(organizationId);
    const invoices = await this.db.select().from(schema.platformInvoices).where(eq(schema.platformInvoices.organizationId, organizationId)).orderBy(desc(schema.platformInvoices.issuedAt), desc(schema.platformInvoices.number));
    let subscription: OrganizationBillingView['subscription'] = null;
    if (row) {
      const { stripeCustomerId: _customer, stripeSubscriptionId: _subscription, ...view } = subscriptionView(row, await this.planRow(row.planCode));
      subscription = view;
    }
    return { subscription, invoices: invoices.map((i) => { const { stripeInvoiceId: _stripe, ...view } = invoiceView(i); return view; }) };
  }

  /**
   * Finalisation du 3 octobre 2026 : lien vers le portail client du fournisseur (Stripe Customer Portal) pour que le
   * propriétaire enregistre une carte par défaut (prélèvement automatique des factures suivantes). Retour vers My Hub
   * (`WEB_BASE_URL` et un chemin sous `/hub`). Sans client chez le fournisseur (aucun abonnement transmis) : 409.
   * Simulé sans clé Stripe (`simulated`).
   */
  async portalSession(organizationId: string, returnPath: string | undefined): Promise<BillingPortalSession> {
    const row = await this.currentSubscription(organizationId);
    if (!row?.stripeCustomerId) throw AppError.conflict('BILLING_CUSTOMER_MISSING', 'Aucun abonnement transmis au fournisseur de paiement pour cette organisation');
    const returnUrl = `${this.env.WEB_BASE_URL.replace(/\/$/, '')}${returnPath ?? '/hub/organisation'}`;
    const session = await this.billing.createPortalSession(row.stripeCustomerId, returnUrl);
    await this.record({ action: 'platform_billing.portal_opened', entity: 'subscriptions', entityId: row.id, after: { provider: this.billing.name } });
    return { url: session.url, simulated: this.billing.name === 'mock' };
  }

  // --- Avis et journal ---

  /** Propriétaire du compte de l'organisation (sinon son administrateur), destinataire des avis de facturation. */
  async owner(organizationId: string): Promise<{ userId: string; email: string | null; language: string } | null> {
    const [row] = await this.db
      .select({ userId: schema.users.id, email: schema.users.email, language: schema.users.language })
      .from(schema.memberships)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.status, 'active'), isNull(schema.roles.organizationId), inArray(schema.roles.code, ['org_owner', 'org_admin'])))
      .orderBy(sql`CASE WHEN ${schema.roles.code} = 'org_owner' THEN 0 ELSE 1 END`, asc(schema.memberships.createdAt))
      .limit(1);
    return row ? { userId: row.userId, email: row.email, language: row.language ?? 'fr' } : null;
  }

  private async notifyOwner(organizationId: string, template: string, data: Record<string, unknown>): Promise<void> {
    const owner = await this.owner(organizationId);
    if (!owner) {
      this.logger.warn({ organizationId, template }, 'Avis de facturation sans destinataire : aucun propriétaire ni administrateur actif');
      return;
    }
    await this.outbox.queue({ recipientUserId: owner.userId, channel: 'email', template, language: (owner.language === 'en' ? 'en' : 'fr') as Language, data: { ...data, organizationId } });
  }

  /** Pendant une requête : avec l'acteur, à la fin de la requête ; dans une tâche : tout de suite, signé `platform_billing`. */
  private async record(entry: AuditEntry): Promise<void> {
    if (this.audit.storage.getStore()) this.audit.record(entry);
    else await this.audit.recordSystem(entry, 'platform_billing');
  }
}
