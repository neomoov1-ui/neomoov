/**
 * Étape 25 (amendement v1.2, section 8) : facturation de la plateforme. Abonnement d'une organisation cliente à une
 * formule (`plans`), et factures de la plateforme (numéro `PF-AAAA-NNNNNN`, séquence annuelle sous verrou consultatif),
 * encaissées par Stripe (identifiants gardés ici) ou réglées hors plateforme. Lignes isolées par organisation : une
 * organisation lit son abonnement et ses factures, n'écrit jamais (politique en lecture seule pour le rôle restreint).
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { plans } from './access.js';
import { organizations } from './partners.js';

export const subscriptions = pgTable('subscriptions', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  planCode: varchar('plan_code', { length: 40 }).notNull().references(() => plans.code),
  /** `trialing`, `active`, `past_due`, `read_only`, `suspended`, `cancelled`. */
  status: varchar('status', { length: 12 }).notNull().default('active'),
  billingPeriod: varchar('billing_period', { length: 10 }).notNull().default('monthly'),
  /** Début de la première période facturée (fin de l'essai) : son jour du mois ancre les renouvellements. */
  startedAt: tz('started_at'),
  /** Période en cours ; pendant l'essai, l'essai lui-même (fin = `trial_ends_at`). */
  currentPeriodStart: tz('current_period_start').notNull(),
  currentPeriodEnd: tz('current_period_end').notNull(),
  trialEndsAt: tz('trial_ends_at'),
  stripeCustomerId: varchar('stripe_customer_id', { length: 100 }),
  /** Réservé : l'abonnement est tenu par Neomoov, Stripe encaisse les factures (décision du 30 septembre 2026). */
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 100 }),
  /** Véhicules actifs comptés à la dernière facture. */
  activeVehicles: integer('active_vehicles').notNull().default(0),
  cancelledAt: tz('cancelled_at'),
  cancelReason: text('cancel_reason'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  // Un seul abonnement en cours par organisation ; les résiliés restent pour l'historique.
  uniqueIndex('subscriptions_org_current_unique').on(t.organizationId).where(sql`${t.status} <> 'cancelled'`),
  index('subscriptions_renewal_idx').on(t.status, t.currentPeriodEnd),
  check('subscriptions_status', sql`${t.status} IN ('trialing', 'active', 'past_due', 'read_only', 'suspended', 'cancelled')`),
  check('subscriptions_billing_period', sql`${t.billingPeriod} IN ('monthly', 'annual')`),
  check('subscriptions_period', sql`${t.currentPeriodEnd} > ${t.currentPeriodStart}`),
  check('subscriptions_active_vehicles', sql`${t.activeVehicles} >= 0`),
]);

export const platformInvoices = pgTable('platform_invoices', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  subscriptionId: uuid('subscription_id').notNull().references(() => subscriptions.id),
  /** `PF-AAAA-NNNNNN` : séquence par année (heure de Montréal), attribuée sous verrou consultatif. */
  number: varchar('number', { length: 20 }).notNull(),
  periodStart: tz('period_start').notNull(),
  periodEnd: tz('period_end').notNull(),
  /** Lignes calculées par le domaine (`computePlatformInvoice`) : code, libellé, quantité, prix unitaire, montant. */
  lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`),
  subtotalCents: cents('subtotal_cents').notNull(),
  gstCents: cents('gst_cents').notNull(),
  qstCents: cents('qst_cents').notNull(),
  totalCents: cents('total_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('CAD'),
  /** `draft`, `open`, `paid`, `past_due`, `void`. */
  status: varchar('status', { length: 10 }).notNull().default('open'),
  issuedAt: tz('issued_at').notNull().defaultNow(),
  dueAt: tz('due_at').notNull(),
  paidAt: tz('paid_at'),
  /** `stripe` (webhook `invoice.paid`) ou `offline` (règlement hors plateforme noté par le personnel). */
  paymentMethod: varchar('payment_method', { length: 10 }),
  paymentReference: varchar('payment_reference', { length: 120 }),
  /** Dernier échec de paiement signalé par Stripe (`card_declined`…). */
  paymentFailureCode: varchar('payment_failure_code', { length: 60 }),
  stripeInvoiceId: varchar('stripe_invoice_id', { length: 100 }),
  /** Page de paiement hébergée par Stripe. */
  hostedInvoiceUrl: text('hosted_invoice_url'),
  pdfKey: varchar('pdf_key', { length: 300 }),
  remindersSent: smallint('reminders_sent').notNull().default(0),
  lastReminderAt: tz('last_reminder_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('platform_invoices_number_unique').on(t.number),
  uniqueIndex('platform_invoices_stripe_unique').on(t.stripeInvoiceId).where(sql`${t.stripeInvoiceId} IS NOT NULL`),
  // Une facture par période d'un abonnement (renouvellement rejouable, deux processus ne facturent jamais deux fois).
  uniqueIndex('platform_invoices_period_unique').on(t.subscriptionId, t.periodStart).where(sql`${t.status} <> 'void'`),
  index('platform_invoices_org_idx').on(t.organizationId, t.issuedAt),
  index('platform_invoices_unpaid_idx').on(t.status, t.dueAt).where(sql`${t.status} IN ('open', 'past_due')`),
  check('platform_invoices_status', sql`${t.status} IN ('draft', 'open', 'paid', 'past_due', 'void')`),
  check('platform_invoices_payment_method', sql`${t.paymentMethod} IS NULL OR ${t.paymentMethod} IN ('stripe', 'offline')`),
  check('platform_invoices_amounts', sql`${t.subtotalCents} >= 0 AND ${t.gstCents} >= 0 AND ${t.qstCents} >= 0 AND ${t.totalCents} = ${t.subtotalCents} + ${t.gstCents} + ${t.qstCents}`),
  check('platform_invoices_period', sql`${t.periodEnd} > ${t.periodStart}`),
  check('platform_invoices_reminders', sql`${t.remindersSent} >= 0`),
]);
