/**
 * Facturation de la plateforme (étape 25) dans My Hub : formules, vue d'ensemble, cycle quotidien à la demande,
 * abonnement d'une organisation, factures de la plateforme, PDF et règlement hors plateforme. Personnel de la
 * plateforme seulement (`billing.view`, `billing.manage`). Typé par les schémas de `@neomoov/domain`.
 */
import type { BillingOverview, BillingRunReport, PlatformInvoiceView, PlatformPlanView, SubscriptionUpsert, SubscriptionView } from '@neomoov/domain';
import type { Transport } from './resources.js';

const id = (value: string) => encodeURIComponent(value);

/** Résultat d'une création ou d'un changement de formule (`POST /admin/organizations/:id/subscription`). */
export interface SubscriptionUpsertResult {
  created: boolean;
  subscription: SubscriptionView;
  invoice: PlatformInvoiceView | null;
}

export function platformBillingResource(t: Transport) {
  return {
    plans: () => t.get<PlatformPlanView[]>('/admin/billing/plans'),
    /** Revenu mensuel récurrent, abonnements par statut, impayés, lectures seules et suspensions à venir d'ici l'horizon (jours). */
    overview: (horizonDays?: number) => t.get<BillingOverview>('/admin/billing/overview', horizonDays ? { query: { horizonDays } } : undefined),
    /** Lance tout de suite le cycle quotidien (essais, renouvellements, relances, lecture seule, suspension, réactivation). */
    run: () => t.post<BillingRunReport>('/admin/billing/run', {}),
    /** Abonnement en cours d'une organisation ; 404 `SUBSCRIPTION_NOT_FOUND` sans abonnement. */
    subscription: (organizationId: string) => t.get<SubscriptionView>(`/admin/organizations/${id(organizationId)}/subscription`),
    upsertSubscription: (organizationId: string, body: SubscriptionUpsert) => t.post<SubscriptionUpsertResult>(`/admin/organizations/${id(organizationId)}/subscription`, body),
    cancelSubscription: (organizationId: string, reason: string) => t.post<SubscriptionView>(`/admin/organizations/${id(organizationId)}/subscription/cancel`, { reason }),
    invoices: (organizationId: string) => t.get<PlatformInvoiceView[]>(`/admin/organizations/${id(organizationId)}/platform-invoices`),
    /** Chemin du PDF d'une facture de la plateforme : à charger avec le jeton, jamais par un lien public. */
    invoicePdfPath: (invoiceId: string) => `/admin/platform-invoices/${id(invoiceId)}/pdf`,
    /** Règlement hors plateforme (virement, chèque, Interac) avec sa référence ; réactive l'organisation si plus rien n'est en retard. */
    markPaid: (invoiceId: string, body: { reference: string; paidAt?: string }) => t.post<PlatformInvoiceView>(`/admin/platform-invoices/${id(invoiceId)}/mark-paid`, body),
  };
}
