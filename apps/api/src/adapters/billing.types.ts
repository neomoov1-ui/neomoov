/**
 * Facturation de la plateforme (étape 25, amendement v1.2 section 8) : fournisseur d'encaissement des abonnements des
 * organisations clientes (Stripe Billing en production, simulé ailleurs, choisi par `BILLING_PROVIDER`). Partage : Neomoov
 * tient l'abonnement, calcule, numérote et relance les factures (domaine `platform-billing`) ; le fournisseur tient le
 * client et son abonnement (formule et statut en métadonnées), reçoit chaque facture avec ses lignes et ses taxes déjà
 * calculées, l'encaisse (prélèvement automatique sur la carte par défaut, sinon page de paiement hébergée) et rapporte
 * l'issue par webhook (`invoice.paid`, `invoice.payment_failed`) sur `POST /v1/webhooks/stripe-billing`.
 */

export interface BillingCustomerInput {
  organizationId: string;
  /** Raison sociale (ou nom) de l'organisation. */
  name: string;
  /** Courriel de facturation (propriétaire du compte). */
  email: string | null;
  language: 'fr' | 'en';
}

/** Abonnement tel que le fournisseur l'affiche (métadonnées du client chez Stripe). */
export interface BillingSubscriptionInfo {
  organizationId: string;
  planCode: string;
  billingPeriod: 'monthly' | 'annual';
  status: string;
}

export interface BillingInvoiceInput {
  /** Identifiant de la facture chez Neomoov : clé d'idempotence (une facture rejouée n'est créée qu'une fois). */
  platformInvoiceId: string;
  /** `PF-AAAA-NNNNNN`. */
  number: string;
  organizationId: string;
  customerId: string;
  /** Lignes hors taxes (installation, abonnement, véhicules), montants en cents. */
  lines: Array<{ label: string; amountCents: number }>;
  /** Taxes déjà calculées (TPS, TVQ), une ligne chacune : le total chez le fournisseur est exactement celui de Neomoov. */
  taxes: Array<{ label: string; amountCents: number }>;
  totalCents: number;
  currency: 'CAD';
  dueAt: Date;
  /** Numéros de taxes de Neomoov, affichés sur la facture du fournisseur (vides tant qu'ils ne sont pas fournis). */
  taxNumbers: { gst: string | null; qst: string | null };
}

export interface BillingInvoiceResult {
  invoiceId: string;
  status: 'open' | 'paid';
  /** Page de paiement hébergée (lien des courriels de facture et de rappel). */
  hostedInvoiceUrl: string | null;
}

/** Événement de webhook vérifié : `data.object` est l'objet Stripe concerné (facture, client, abonnement). */
export interface BillingWebhookEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/**
 * Chaque écriture porte une clé d'idempotence dérivée de l'identifiant Neomoov ; une panne du fournisseur lance une
 * erreur 502 `BILLING_PROVIDER_ERROR` (la tâche quotidienne reprend les factures non transmises).
 */
export interface BillingProvider {
  readonly name: string;
  /** Client de l'organisation ; idempotent par organisation. */
  createCustomer(input: BillingCustomerInput): Promise<{ customerId: string }>;
  /** Formule, période et statut de l'abonnement, visibles chez le fournisseur (support, rapprochement). */
  syncSubscription(customerId: string, subscription: BillingSubscriptionInfo): Promise<void>;
  /** Facture calculée par Neomoov, finalisée chez le fournisseur qui l'encaisse. */
  createInvoice(input: BillingInvoiceInput): Promise<BillingInvoiceResult>;
  /** Règlement hors plateforme : la facture est marquée payée sans prélèvement (Stripe : `paid_out_of_band`). */
  markPaidOutOfBand(invoiceId: string): Promise<void>;
  /** Annule une facture encore ouverte chez le fournisseur (résiliation). */
  voidInvoice(invoiceId: string): Promise<void>;
  /** Vérifie la signature (secret propre au point de terminaison de la facturation) et renvoie l'événement. */
  verifyWebhook(rawBody: string | Buffer, signature: string): Promise<BillingWebhookEvent>;
}

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');
