/**
 * Facturation de la plateforme (étape 25, amendement v1.2 section 8, décision D2) : formules Solo, Pro et Entreprise
 * vendues aux organisations clientes (frais d'installation, abonnement mensuel ou licence annuelle, véhicules actifs
 * au-delà des inclus), TPS et TVQ, relances et suspension progressive en cas d'impayé. Fonctions pures : les prix et
 * les délais sont des entrées (table `plans`, réglages `billing.*`), jamais des constantes de code.
 */
import { mulDivRound } from '../pricing/quote.js';

export const PLAN_CODES = ['solo', 'pro', 'entreprise'] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const BILLING_PERIODS = ['monthly', 'annual'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PLATFORM_INVOICE_STATUSES = ['draft', 'open', 'paid', 'past_due', 'void'] as const;
export type PlatformInvoiceStatus = (typeof PLATFORM_INVOICE_STATUSES)[number];

/** Statuts d'une organisation (table `organizations`) touchés par la facturation. */
export type OrganizationStatus = 'trial' | 'active' | 'read_only' | 'suspended' | 'closed';

/** Formule commerciale telle que stockée (`plans`) : prix en cents, devise CAD. */
export interface PlatformPlan {
  code: string;
  name: string;
  modules: readonly string[];
  setupFeeCents: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
  perActiveVehicleCents: number;
  includedVehicles: number;
  currency: 'CAD';
}

export interface PlatformSubscription {
  planCode: string;
  billingPeriod: BillingPeriod;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
  activeVehicles: number;
}

export type PlatformInvoiceLineCode = 'setup_fee' | 'subscription' | 'active_vehicles';

export interface PlatformInvoiceLine {
  code: PlatformInvoiceLineCode;
  /** Libellé en français (langue de la facture) ; la traduction anglaise se fait à l'affichage. */
  label: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface TaxRates {
  gstPpm: number;
  qstPpm: number;
}

/** Taux en vigueur au Québec, repli quand les réglages ne les donnent pas (`pricing.gst_rate_ppm`, `pricing.qst_rate_ppm`). */
export const QUEBEC_TAX_RATES: TaxRates = { gstPpm: 50_000, qstPpm: 99_750 };

export interface PlatformInvoiceComputation {
  periodStart: Date;
  periodEnd: Date;
  lines: PlatformInvoiceLine[];
  subtotalCents: number;
  gstCents: number;
  qstCents: number;
  totalCents: number;
}

export class PlatformBillingError extends Error {
  constructor(
    readonly code: 'INVALID_PERIOD' | 'INVALID_PLAN' | 'INVALID_VEHICLES',
    message: string,
  ) {
    super(message);
    this.name = 'PlatformBillingError';
  }
}

const DAY_MS = 86_400_000;

/** Fin d'une période qui commence à `start` : un mois ou un an plus tard (UTC), même jour du mois quand il existe. */
export function periodEnd(start: Date, period: BillingPeriod): Date {
  const end = new Date(start.getTime());
  if (period === 'annual') end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  // 31 janvier + 1 mois donne le 3 mars en JavaScript : on retient le dernier jour du mois visé.
  const expectedMonth = (start.getUTCMonth() + (period === 'annual' ? 12 : 1)) % 12;
  if (end.getUTCMonth() !== expectedMonth) end.setUTCDate(0);
  return end;
}

/** Nombre de mois couverts par une période de facturation (ligne des véhicules). */
export function periodMonths(period: BillingPeriod): number {
  return period === 'annual' ? 12 : 1;
}

/**
 * Facture d'une période : frais d'installation sur la première facture seulement, abonnement de la période (mensuel
 * ou licence annuelle), véhicules actifs au-delà des inclus (par mois de la période), puis TPS et TVQ calculées
 * chacune sur le sous-total (la TVQ ne s'applique plus sur la TPS depuis 2013), arrondies au cent.
 */
export function computePlatformInvoice(
  plan: PlatformPlan,
  subscription: Pick<PlatformSubscription, 'billingPeriod'>,
  activeVehicles: number,
  period: { start: Date; end: Date },
  first: boolean,
  taxes: TaxRates = QUEBEC_TAX_RATES,
): PlatformInvoiceComputation {
  if (period.end.getTime() <= period.start.getTime()) throw new PlatformBillingError('INVALID_PERIOD', 'La période de facturation doit finir après son début');
  if (!Number.isInteger(activeVehicles) || activeVehicles < 0) throw new PlatformBillingError('INVALID_VEHICLES', 'Nombre de véhicules actifs invalide');
  for (const key of ['setupFeeCents', 'monthlyPriceCents', 'annualPriceCents', 'perActiveVehicleCents', 'includedVehicles'] as const) {
    if (!Number.isInteger(plan[key]) || plan[key] < 0) throw new PlatformBillingError('INVALID_PLAN', `Formule ${plan.code} : ${key} invalide`);
  }
  const lines: PlatformInvoiceLine[] = [];
  if (first && plan.setupFeeCents > 0) lines.push({ code: 'setup_fee', label: `Frais d'installation, formule ${plan.name}`, quantity: 1, unitCents: plan.setupFeeCents, amountCents: plan.setupFeeCents });
  const annual = subscription.billingPeriod === 'annual';
  const subscriptionCents = annual ? plan.annualPriceCents : plan.monthlyPriceCents;
  lines.push({ code: 'subscription', label: annual ? `Licence annuelle, formule ${plan.name}` : `Abonnement mensuel, formule ${plan.name}`, quantity: 1, unitCents: subscriptionCents, amountCents: subscriptionCents });
  const extraVehicles = Math.max(0, activeVehicles - plan.includedVehicles);
  if (extraVehicles > 0 && plan.perActiveVehicleCents > 0) {
    const months = periodMonths(subscription.billingPeriod);
    const quantity = extraVehicles * months;
    lines.push({
      code: 'active_vehicles',
      label: `Véhicules actifs au-delà des ${plan.includedVehicles} inclus (${extraVehicles} × ${months} mois)`,
      quantity,
      unitCents: plan.perActiveVehicleCents,
      amountCents: quantity * plan.perActiveVehicleCents,
    });
  }
  const subtotalCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  const gstCents = mulDivRound(subtotalCents, taxes.gstPpm, 1_000_000);
  const qstCents = mulDivRound(subtotalCents, taxes.qstPpm, 1_000_000);
  return { periodStart: period.start, periodEnd: period.end, lines, subtotalCents, gstCents, qstCents, totalCents: subtotalCents + gstCents + qstCents };
}

/** Réglages des relances (`billing.*`) : jours après l'échéance. */
export interface DunningSettings {
  /** Rappels, en jours après l'échéance, dans l'ordre (3, 7, 14). */
  reminderDays: readonly number[];
  /** Lecture seule à partir de ce nombre de jours (30). */
  readOnlyDays: number;
  /** Suspension à partir de ce nombre de jours (45). */
  suspendedDays: number;
}

export const DEFAULT_DUNNING_SETTINGS: DunningSettings = { reminderDays: [3, 7, 14], readOnlyDays: 30, suspendedDays: 45 };

export interface DunningInvoice {
  status: PlatformInvoiceStatus;
  dueAt: Date;
  remindersSent: number;
}

export type DunningAction = 'none' | 'remind' | 'read_only' | 'suspend';

export interface DunningStep {
  action: DunningAction;
  /** Jours entiers écoulés depuis l'échéance (négatif avant l'échéance). */
  daysOverdue: number;
  /** Vrai dès que l'échéance est dépassée : la facture passe à `past_due`. */
  pastDue: boolean;
  /** Numéro du rappel à envoyer (1 à 3) quand l'action est `remind`. */
  reminder: number | null;
}

/**
 * Étape de relance d'une facture à `now` : rappels à +3, +7 et +14 jours (chacun une seule fois, compté par
 * `remindersSent`), lecture seule à +30 jours, suspension à +45 jours. Les deux dernières se répètent tant que la
 * facture reste impayée : c'est au service de ne les appliquer qu'une fois (et jamais pendant une course).
 */
export function dunningStep(invoice: DunningInvoice, now: Date, settings: DunningSettings = DEFAULT_DUNNING_SETTINGS): DunningStep {
  if (invoice.status === 'paid' || invoice.status === 'void' || invoice.status === 'draft') return { action: 'none', daysOverdue: 0, pastDue: false, reminder: null };
  const daysOverdue = Math.floor((now.getTime() - invoice.dueAt.getTime()) / DAY_MS);
  const pastDue = now.getTime() > invoice.dueAt.getTime();
  if (daysOverdue >= settings.suspendedDays) return { action: 'suspend', daysOverdue, pastDue, reminder: null };
  if (daysOverdue >= settings.readOnlyDays) return { action: 'read_only', daysOverdue, pastDue, reminder: null };
  const next = settings.reminderDays[invoice.remindersSent];
  if (next !== undefined && daysOverdue >= next) return { action: 'remind', daysOverdue, pastDue, reminder: invoice.remindersSent + 1 };
  return { action: 'none', daysOverdue, pastDue, reminder: null };
}

/** Une organisation en lecture seule, suspendue ou fermée ne peut plus écrire (garde des routes d'organisation). */
export function organizationWriteAllowed(status: OrganizationStatus | string): boolean {
  return status === 'trial' || status === 'active';
}

/** Accès d'une organisation selon son statut : suspendue ou fermée, plus rien ; lecture seule, lire seulement. */
export function organizationAccess(status: OrganizationStatus | string): { read: boolean; write: boolean } {
  if (status === 'suspended' || status === 'closed') return { read: false, write: false };
  return { read: true, write: organizationWriteAllowed(status) };
}

/** Modules d'une formule (fonctionnalités achetées), dédoublonnés et triés ; la formule est la seule source. */
export function planModules(plan: Pick<PlatformPlan, 'modules'>): string[] {
  return [...new Set(plan.modules)].sort();
}

/** Statut d'organisation qui correspond à un statut d'abonnement (après paiement, relance ou résiliation). */
export function organizationStatusFor(subscription: SubscriptionStatus): OrganizationStatus {
  switch (subscription) {
    case 'trialing':
      return 'trial';
    case 'read_only':
      return 'read_only';
    case 'suspended':
      return 'suspended';
    case 'cancelled':
      return 'closed';
    default:
      return 'active';
  }
}

/** Revenu mensuel récurrent d'un abonnement en cours : abonnement (annuel ramené au mois) et véhicules au-delà des inclus. */
export function monthlyRecurringRevenueCents(plan: PlatformPlan, subscription: Pick<PlatformSubscription, 'billingPeriod' | 'status' | 'activeVehicles'>): number {
  if (subscription.status === 'cancelled' || subscription.status === 'suspended') return 0;
  const base = subscription.billingPeriod === 'annual' ? Math.round(plan.annualPriceCents / 12) : plan.monthlyPriceCents;
  return base + Math.max(0, subscription.activeVehicles - plan.includedVehicles) * plan.perActiveVehicleCents;
}

/** Numéro de facture de plateforme : `PF-AAAA-NNNNNN`, séquence annuelle. */
export function formatPlatformInvoiceNumber(year: number, sequence: number): string {
  return `PF-${year}-${String(sequence).padStart(6, '0')}`;
}
