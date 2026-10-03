/**
 * Étape 25 : facturation de la plateforme (abonnements des organisations clientes), telle que My Hub la lit et l'écrit.
 * Les identifiants Stripe ne sont montrés qu'au personnel de la plateforme, jamais à l'organisation.
 */
import { z } from 'zod';
import { BILLING_PERIODS, PLATFORM_INVOICE_STATUSES, SUBSCRIPTION_STATUSES } from '../platform-billing/billing.js';
import { cents, isoDate, uuid } from './common.js';

const count = z.number().int().min(0);

export const platformPlanViewSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** Modules de permissions inclus (`planModules`). */
  modules: z.array(z.string()),
  setupFeeCents: cents,
  monthlyPriceCents: cents,
  annualPriceCents: cents,
  perActiveVehicleCents: cents,
  includedVehicles: count,
  currency: z.string(),
  active: z.boolean(),
});
export type PlatformPlanView = z.infer<typeof platformPlanViewSchema>;

export const subscriptionViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  planCode: z.string(),
  plan: platformPlanViewSchema,
  status: z.enum(SUBSCRIPTION_STATUSES),
  billingPeriod: z.enum(BILLING_PERIODS),
  /** Début de la facturation (fin de l'essai) ; nul pendant l'essai. */
  startedAt: isoDate.nullable(),
  currentPeriodStart: isoDate,
  currentPeriodEnd: isoDate,
  trialEndsAt: isoDate.nullable(),
  /** Véhicules actifs comptés à la dernière facture. */
  activeVehicles: count,
  monthlyRecurringRevenueCents: cents,
  cancelledAt: isoDate.nullable(),
  stripeCustomerId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  createdAt: isoDate,
});
export type SubscriptionView = z.infer<typeof subscriptionViewSchema>;

export const platformInvoiceLineSchema = z.object({
  code: z.enum(['setup_fee', 'subscription', 'active_vehicles']),
  label: z.string(),
  quantity: count,
  unitCents: cents,
  amountCents: cents,
});

export const platformInvoiceViewSchema = z.object({
  id: uuid,
  organizationId: uuid,
  subscriptionId: uuid,
  /** `PF-AAAA-NNNNNN`. */
  number: z.string(),
  periodStart: isoDate,
  periodEnd: isoDate,
  lines: z.array(platformInvoiceLineSchema),
  subtotalCents: cents,
  gstCents: cents,
  qstCents: cents,
  totalCents: cents,
  currency: z.string(),
  status: z.enum(PLATFORM_INVOICE_STATUSES),
  issuedAt: isoDate,
  dueAt: isoDate,
  paidAt: isoDate.nullable(),
  /** `stripe` (webhook) ou `offline` (règlement hors plateforme noté par le personnel). */
  paymentMethod: z.enum(['stripe', 'offline']).nullable(),
  paymentReference: z.string().nullable(),
  remindersSent: count,
  /** Page de paiement hébergée par Stripe, s'il y en a une. */
  hostedInvoiceUrl: z.string().nullable(),
  stripeInvoiceId: z.string().nullable(),
  pdfAvailable: z.boolean(),
  createdAt: isoDate,
});
export type PlatformInvoiceView = z.infer<typeof platformInvoiceViewSchema>;

/** Création ou changement de formule : la nouvelle formule et la période s'appliquent à la prochaine facture. */
export const subscriptionUpsertSchema = z.object({
  planCode: z.string().trim().min(1).max(40),
  /** Mensuel à la création si absente ; inchangée lors d'un changement de formule si absente. */
  billingPeriod: z.enum(BILLING_PERIODS).optional(),
  /** Essai gratuit, à la création seulement (ou pour prolonger un essai en cours) ; 0 : facturation immédiate. */
  trialDays: z.number().int().min(0).max(90).optional(),
});
export type SubscriptionUpsert = z.infer<typeof subscriptionUpsertSchema>;

export const subscriptionUpsertResultSchema = z.object({
  created: z.boolean(),
  subscription: subscriptionViewSchema,
  /** Première facture, émise tout de suite quand il n'y a pas d'essai. */
  invoice: platformInvoiceViewSchema.nullable(),
});

export const subscriptionCancelSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** Règlement hors plateforme (virement, chèque, Interac) noté par le personnel, avec sa référence. */
export const platformInvoiceMarkPaidSchema = z.object({
  reference: z.string().trim().min(2).max(120),
  paidAt: isoDate.optional(),
});

export const billingOverviewQuerySchema = z.object({
  horizonDays: z.coerce.number().int().min(1).max(90).default(14),
});

export const billingOverviewSchema = z.object({
  monthlyRecurringRevenueCents: cents,
  subscriptions: z.record(z.enum(SUBSCRIPTION_STATUSES), count),
  unpaid: z.object({ count, totalCents: cents, overdueCount: count, overdueCents: cents }),
  /** Lectures seules et suspensions dues d'ici l'horizon (ou déjà dues et reportées), par date. */
  upcoming: z.array(z.object({
    organizationId: uuid,
    organizationName: z.string(),
    invoiceId: uuid,
    invoiceNumber: z.string(),
    totalCents: cents,
    dueAt: isoDate,
    daysOverdue: z.number().int(),
    nextAction: z.enum(['read_only', 'suspend']),
    at: isoDate,
  })),
});
export type BillingOverview = z.infer<typeof billingOverviewSchema>;

export const billingRunReportSchema = z.object({
  trialsEnded: count,
  renewed: count,
  invoicesIssued: count,
  pushed: count,
  pastDue: count,
  reminders: count,
  readOnly: count,
  suspended: count,
  postponed: count,
  reactivated: count,
  errors: count,
});
export type BillingRunReport = z.infer<typeof billingRunReportSchema>;

/** Vue d'une organisation sur sa propre facturation (route `/v1/org/:organizationId/billing`, branchée à la fusion). */
export const organizationBillingSchema = z.object({
  subscription: subscriptionViewSchema.omit({ stripeCustomerId: true, stripeSubscriptionId: true }).nullable(),
  invoices: z.array(platformInvoiceViewSchema.omit({ stripeInvoiceId: true })),
});
export type OrganizationBillingView = z.infer<typeof organizationBillingSchema>;

/**
 * Finalisation du 3 octobre 2026 : lien vers le portail client de Stripe (carte par défaut, prélèvement automatique des
 * factures suivantes). Retour vers My Hub seulement (chemin relatif sous `/hub`), jamais vers une adresse fournie.
 */
export const billingPortalRequestSchema = z.object({
  returnPath: z.string().max(300).regex(/^\/hub(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\/?(\?[A-Za-z0-9._=&-]*)?$/, 'Chemin de My Hub attendu (/hub/...)').optional(),
});
export type BillingPortalRequest = z.infer<typeof billingPortalRequestSchema>;
export const billingPortalSessionSchema = z.object({
  url: z.string().url(),
  /** Vrai avec le fournisseur simulé (aucune clé Stripe) : le lien ne mène nulle part. */
  simulated: z.boolean(),
});
export type BillingPortalSession = z.infer<typeof billingPortalSessionSchema>;
