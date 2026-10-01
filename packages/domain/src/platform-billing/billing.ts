/**
 * Facturation de la plateforme (étape 25, amendement v1.2 section 8, décision D2) : formules Solo, Pro et Entreprise
 * vendues aux organisations clientes (frais d'installation, abonnement mensuel ou licence annuelle, véhicules actifs
 * au-delà des inclus), TPS et TVQ, relances et suspension progressive en cas d'impayé. Fonctions pures : les prix et
 * les délais sont des entrées (table `plans`, réglages `billing.*`), jamais des constantes de code.
 */
import { PERMISSION_MODULES } from '../access/permissions.js';
import { mulDivRound } from '../pricing/quote.js';
import type { TaxRates } from '../settlement/settlement.js';

export const BILLING_PERIODS = ['monthly', 'annual'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const PLATFORM_INVOICE_STATUSES = ['draft', 'open', 'paid', 'past_due', 'void'] as const;
export type PlatformInvoiceStatus = (typeof PLATFORM_INVOICE_STATUSES)[number];

/** Statut d'une organisation (`organizations.status`) que la facturation pose. */
type OrganizationBillingStatus = 'trial' | 'active' | 'read_only' | 'suspended' | 'closed';

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
  currency: string;
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
  /** Libellé en français (langue de la facture) ; la traduction anglaise se fait à l'affichage, par le code. */
  label: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

/** Taux en vigueur au Québec, repli quand les réglages ne les donnent pas (`pricing.gst_rate_ppm`, `pricing.qst_rate_ppm`). */
export const QUEBEC_TAX_RATES: TaxRates = { gstRatePpm: 50_000, qstRatePpm: 99_750 };

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
    readonly code: 'INVALID_PERIOD' | 'INVALID_PLAN' | 'INVALID_VEHICLES' | 'INVALID_SETTINGS',
    message: string,
  ) {
    super(message);
    this.name = 'PlatformBillingError';
  }
}

const DAY_MS = 86_400_000;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Fin d'une période qui commence à `start` : un mois ou un an plus tard (UTC), au jour d'ancrage de l'abonnement
 * (`anchorDay`, par défaut le jour de `start`), ramené au dernier jour du mois quand ce jour n'existe pas. Un abonnement
 * pris le 31 janvier se renouvelle le 28 février, puis le 31 mars : l'ancrage évite de dériver vers le 28.
 */
export function billingPeriodEnd(start: Date, period: BillingPeriod, anchorDay = start.getUTCDate()): Date {
  const months = billingPeriodMonths(period);
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = total % 12;
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return new Date(Date.UTC(year, month, day, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
}

/** Nombre de mois couverts par une période de facturation (ligne des véhicules). */
export function billingPeriodMonths(period: BillingPeriod): number {
  return period === 'annual' ? 12 : 1;
}

const PLAN_AMOUNTS = ['setupFeeCents', 'monthlyPriceCents', 'annualPriceCents', 'perActiveVehicleCents', 'includedVehicles'] as const;

/**
 * Facture d'une période, émise au début de la période (abonnement payable d'avance) : frais d'installation sur la
 * première facture seulement, abonnement de la période (mensuel ou licence annuelle), véhicules actifs au-delà des
 * inclus, comptés à l'émission et facturés pour chaque mois de la période ; puis TPS et TVQ calculées chacune sur le
 * sous-total (la TVQ ne s'applique plus sur la TPS depuis 2013), arrondies au cent.
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
  if (plan.currency !== 'CAD') throw new PlatformBillingError('INVALID_PLAN', `Formule ${plan.code} : devise ${plan.currency} non prise en charge`);
  for (const key of PLAN_AMOUNTS) {
    if (!Number.isInteger(plan[key]) || plan[key] < 0) throw new PlatformBillingError('INVALID_PLAN', `Formule ${plan.code} : ${key} invalide`);
  }
  const lines: PlatformInvoiceLine[] = [];
  if (first && plan.setupFeeCents > 0) lines.push({ code: 'setup_fee', label: `Frais d'installation, formule ${plan.name}`, quantity: 1, unitCents: plan.setupFeeCents, amountCents: plan.setupFeeCents });
  const annual = subscription.billingPeriod === 'annual';
  const subscriptionCents = annual ? plan.annualPriceCents : plan.monthlyPriceCents;
  lines.push({ code: 'subscription', label: annual ? `Licence annuelle, formule ${plan.name}` : `Abonnement mensuel, formule ${plan.name}`, quantity: 1, unitCents: subscriptionCents, amountCents: subscriptionCents });
  const extraVehicles = Math.max(0, activeVehicles - plan.includedVehicles);
  if (extraVehicles > 0 && plan.perActiveVehicleCents > 0) {
    const months = billingPeriodMonths(subscription.billingPeriod);
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
  const gstCents = mulDivRound(subtotalCents, taxes.gstRatePpm, 1_000_000);
  const qstCents = mulDivRound(subtotalCents, taxes.qstRatePpm, 1_000_000);
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

const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

/**
 * Réglages lus en base (`billing.reminder_days`, `billing.read_only_days`, `billing.suspended_days`), validés : rappels
 * strictement croissants et avant la lecture seule, elle-même avant la suspension. Une valeur absente prend le défaut ;
 * une valeur incohérente est refusée (mieux vaut une erreur visible qu'une suspension au mauvais jour).
 */
export function dunningSettingsFrom(raw: { reminderDays?: unknown; readOnlyDays?: unknown; suspendedDays?: unknown }): DunningSettings {
  const rawDays: unknown = raw.reminderDays ?? DEFAULT_DUNNING_SETTINGS.reminderDays;
  const readOnlyDays: unknown = raw.readOnlyDays ?? DEFAULT_DUNNING_SETTINGS.readOnlyDays;
  const suspendedDays: unknown = raw.suspendedDays ?? DEFAULT_DUNNING_SETTINGS.suspendedDays;
  if (!Array.isArray(rawDays) || !rawDays.every(positiveInteger)) {
    throw new PlatformBillingError('INVALID_SETTINGS', 'billing.reminder_days : jours entiers positifs, strictement croissants');
  }
  const reminderDays = rawDays as number[];
  if (reminderDays.some((d, i) => i > 0 && d <= reminderDays[i - 1]!)) {
    throw new PlatformBillingError('INVALID_SETTINGS', 'billing.reminder_days : jours entiers positifs, strictement croissants');
  }
  if (!positiveInteger(readOnlyDays) || !positiveInteger(suspendedDays) || suspendedDays <= readOnlyDays) {
    throw new PlatformBillingError('INVALID_SETTINGS', 'billing.read_only_days et billing.suspended_days : jours entiers positifs, la suspension après la lecture seule');
  }
  if (reminderDays.length && reminderDays[reminderDays.length - 1]! >= readOnlyDays) {
    throw new PlatformBillingError('INVALID_SETTINGS', 'billing.reminder_days : les rappels précèdent la lecture seule');
  }
  return { reminderDays: [...reminderDays], readOnlyDays, suspendedDays };
}

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

const unpaid = (status: PlatformInvoiceStatus) => status === 'open' || status === 'past_due';

/**
 * Étape de relance d'une facture à `now` : rappels à +3, +7 et +14 jours (chacun une seule fois, compté par
 * `remindersSent` ; un rappel manqué est rattrapé à la passe suivante, jamais deux d'un coup), lecture seule à +30
 * jours, suspension à +45 jours. Les deux dernières se répètent tant que la facture reste impayée : le service ne les
 * applique qu'une fois (et la suspension jamais pendant une course).
 */
export function dunningStep(invoice: DunningInvoice, now: Date, settings: DunningSettings = DEFAULT_DUNNING_SETTINGS): DunningStep {
  if (!unpaid(invoice.status)) return { action: 'none', daysOverdue: 0, pastDue: false, reminder: null };
  const daysOverdue = Math.floor((now.getTime() - invoice.dueAt.getTime()) / DAY_MS);
  const pastDue = now.getTime() > invoice.dueAt.getTime();
  if (daysOverdue >= settings.suspendedDays) return { action: 'suspend', daysOverdue, pastDue, reminder: null };
  if (daysOverdue >= settings.readOnlyDays) return { action: 'read_only', daysOverdue, pastDue, reminder: null };
  const next = settings.reminderDays[invoice.remindersSent];
  if (next !== undefined && daysOverdue >= next) return { action: 'remind', daysOverdue, pastDue, reminder: invoice.remindersSent + 1 };
  return { action: 'none', daysOverdue, pastDue, reminder: null };
}

/** Calendrier des relances d'une facture : dates des rappels, de la lecture seule et de la suspension (vue d'ensemble). */
export function dunningSchedule(dueAt: Date, settings: DunningSettings = DEFAULT_DUNNING_SETTINGS): { reminders: Date[]; readOnlyAt: Date; suspendAt: Date } {
  const at = (days: number) => new Date(dueAt.getTime() + days * DAY_MS);
  return { reminders: settings.reminderDays.map(at), readOnlyAt: at(settings.readOnlyDays), suspendAt: at(settings.suspendedDays) };
}

const SEVERITY: Partial<Record<SubscriptionStatus, number>> = { active: 0, past_due: 1, read_only: 2, suspended: 3 };
const BY_SEVERITY = ['active', 'past_due', 'read_only', 'suspended'] as const;

/**
 * Statut visé par un abonnement d'après ses factures impayées : la plus en retard décide (suspendu au-delà de 45 jours,
 * lecture seule au-delà de 30, en retard dès l'échéance dépassée, actif sinon). Un abonnement à l'essai ou résilié
 * garde son statut.
 */
export function targetSubscriptionStatus(current: SubscriptionStatus, invoices: readonly DunningInvoice[], now: Date, settings: DunningSettings = DEFAULT_DUNNING_SETTINGS): SubscriptionStatus {
  if (current === 'trialing' || current === 'cancelled') return current;
  let severity = 0;
  for (const invoice of invoices) {
    const step = dunningStep(invoice, now, settings);
    const level = step.action === 'suspend' ? 3 : step.action === 'read_only' ? 2 : step.pastDue ? 1 : 0;
    severity = Math.max(severity, level);
  }
  return BY_SEVERITY[severity]!;
}

export interface SubscriptionTransition {
  status: SubscriptionStatus;
  /** Plus restrictif qu'avant (lecture seule, suspension, retard). */
  escalated: boolean;
  /** Suspension due mais reportée : une course est active dans l'organisation. */
  postponed: boolean;
  /** L'organisation retrouve l'écriture (sortie de la lecture seule ou de la suspension). */
  reactivated: boolean;
}

/**
 * Passage du statut courant au statut visé. Jamais de suspension pendant une course : si une course est active dans
 * l'organisation, la suspension est reportée (la lecture seule, qui n'interrompt aucune course, s'applique quand même).
 * Un paiement ramène au statut visé par les factures qui restent impayées ; l'écriture revient sous la lecture seule.
 */
export function nextSubscriptionStatus(current: SubscriptionStatus, target: SubscriptionStatus, options: { activeRide: boolean }): SubscriptionTransition {
  const from = SEVERITY[current];
  const to = SEVERITY[target];
  if (from === undefined || to === undefined || from === to) return { status: current, escalated: false, postponed: false, reactivated: false };
  if (to > from) {
    if (target === 'suspended' && options.activeRide) {
      const status = from >= 2 ? current : 'read_only';
      return { status, escalated: status !== current, postponed: true, reactivated: false };
    }
    return { status: target, escalated: true, postponed: false, reactivated: false };
  }
  return { status: target, escalated: false, postponed: false, reactivated: from >= 2 && to < 2 };
}

/** Une organisation en lecture seule, suspendue ou fermée ne peut plus écrire (garde des routes d'organisation). */
export function organizationWriteAllowed(status: string): boolean {
  return status === 'trial' || status === 'active';
}

/** Accès d'une organisation selon son statut : suspendue ou fermée, plus rien ; lecture seule, lire seulement. */
export function organizationAccess(status: string): { read: boolean; write: boolean } {
  if (status === 'suspended' || status === 'closed') return { read: false, write: false };
  return { read: true, write: organizationWriteAllowed(status) };
}

/** Statut d'organisation qui correspond à un statut d'abonnement ; résilié : lecture seule (export des données, Loi 25). */
export function organizationStatusFor(subscription: SubscriptionStatus): OrganizationBillingStatus {
  switch (subscription) {
    case 'trialing':
      return 'trial';
    case 'read_only':
    case 'cancelled':
      return 'read_only';
    case 'suspended':
      return 'suspended';
    default:
      return 'active';
  }
}

const PLAN_MODULES: ReadonlySet<string> = new Set(PERMISSION_MODULES.filter((m) => m !== 'platform' && m !== 'self'));

/**
 * Modules d'une formule (fonctionnalités achetées) : modules de permissions connus, dédoublonnés et triés ; jamais
 * ceux réservés à la plateforme ni l'espace personnel du chauffeur. La formule est la seule source.
 */
export function planModules(plan: Pick<PlatformPlan, 'modules'>): string[] {
  return [...new Set(plan.modules)].filter((m) => PLAN_MODULES.has(m)).sort();
}

/**
 * Revenu mensuel récurrent d'un abonnement : abonnement (licence annuelle ramenée au mois) et véhicules au-delà des
 * inclus. Un essai, une suspension ou une résiliation ne rapporte rien.
 */
export function monthlyRecurringRevenueCents(plan: PlatformPlan, subscription: Pick<PlatformSubscription, 'billingPeriod' | 'status' | 'activeVehicles'>): number {
  if (subscription.status === 'trialing' || subscription.status === 'cancelled' || subscription.status === 'suspended') return 0;
  const base = subscription.billingPeriod === 'annual' ? Math.round(plan.annualPriceCents / 12) : plan.monthlyPriceCents;
  return base + Math.max(0, subscription.activeVehicles - plan.includedVehicles) * plan.perActiveVehicleCents;
}

/** Numéro de facture de plateforme : `PF-AAAA-NNNNNN`, séquence annuelle. */
export function formatPlatformInvoiceNumber(year: number, sequence: number): string {
  return `PF-${year}-${String(sequence).padStart(6, '0')}`;
}
