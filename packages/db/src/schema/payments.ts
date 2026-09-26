/** Section 4.6 : paiements, packs, règlements, promotions et crédits. */

import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { clients } from './clients.js';
import { drivers } from './drivers.js';
import { collectedByEnum, creditOriginEnum, packBillingStatusEnum, packCodeEnum, packPurchaseStatusEnum, paymentMethodEnum, paymentStatusEnum, promotionTypeEnum, statementStatusEnum } from './enums.js';
import { users } from './identity.js';
import { rides } from './rides.js';

export const payments = pgTable('payments', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id),
  clientId: uuid('client_id').references(() => clients.id),
  method: paymentMethodEnum('method').notNull(),
  /** Nature (étape 7) : `ride`, `tip` (paiement séparé), frais d'annulation ou d'absence, règlement d'un solde. */
  kind: varchar('kind', { length: 20 }).notNull().default('ride'),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 100 }),
  /** Méthode Stripe choisie à la réservation (carte enregistrée) : l'autorisation d'une planifiée est faite à l'attribution. */
  stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 100 }),
  /** Clé d'idempotence de l'opération qui a créé ce paiement : un rejeu ne crée jamais de second paiement. */
  idempotencyKey: varchar('idempotency_key', { length: 120 }),
  /** Tentatives de capture (nouvelle tentative, puis ticket et solde dû). */
  attempts: integer('attempts').notNull().default(0),
  capturedAt: tz('captured_at'),
  authorizedCents: cents('authorized_cents').notNull().default(0),
  capturedCents: cents('captured_cents').notNull().default(0),
  tipCents: cents('tip_cents').notNull().default(0),
  status: paymentStatusEnum('status').notNull().default('pending'),
  collectedBy: collectedByEnum('collected_by').notNull().default('platform'),
  /** Montant confirmé reçu par le chauffeur en paiement direct. */
  driverConfirmedCents: cents('driver_confirmed_cents'),
  failureCode: varchar('failure_code', { length: 60 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('payments_ride_idx').on(t.rideId),
  uniqueIndex('payments_intent_unique').on(t.stripePaymentIntentId).where(sql`${t.stripePaymentIntentId} IS NOT NULL`),
  uniqueIndex('payments_idempotency_unique').on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  index('payments_failed_idx').on(t.status, t.updatedAt).where(sql`${t.status} = 'failed'`),
  check('payments_amounts_positive', sql`${t.authorizedCents} >= 0 AND ${t.capturedCents} >= 0 AND ${t.tipCents} >= 0`),
  check('payments_kind', sql`${t.kind} IN ('ride', 'tip', 'cancellation_fee', 'no_show_fee', 'balance')`),
]);

export const refunds = pgTable('refunds', {
  id: id(),
  paymentId: uuid('payment_id').notNull().references(() => payments.id),
  /** `refund` : remboursement sur la carte ; `credit` : crédit sur le compte du client (5.6, au choix du client). */
  mode: varchar('mode', { length: 10 }).notNull().default('refund'),
  amountCents: cents('amount_cents').notNull(),
  reason: varchar('reason', { length: 300 }).notNull(),
  creditId: uuid('credit_id'),
  idempotencyKey: varchar('idempotency_key', { length: 120 }),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedByAgentCode: varchar('decided_by_agent_code', { length: 40 }),
  stripeRefundId: varchar('stripe_refund_id', { length: 100 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  createdAt: createdAt(),
}, (t) => [
  index('refunds_payment_idx').on(t.paymentId),
  uniqueIndex('refunds_idempotency_unique').on(t.idempotencyKey).where(sql`${t.idempotencyKey} IS NOT NULL`),
  check('refunds_amount_positive', sql`${t.amountCents} > 0`),
  check('refunds_status', sql`${t.status} IN ('pending', 'succeeded', 'failed')`),
  check('refunds_mode', sql`${t.mode} IN ('refund', 'credit')`),
]);

/**
 * Événements reçus des fournisseurs de paiement (webhook Stripe) : l'identifiant de l'événement est la clé primaire,
 * un même événement reçu plusieurs fois n'est traité qu'une fois ; un traitement en échec est repris par la file.
 */
export const webhookEvents = pgTable('webhook_events', {
  id: varchar('id', { length: 100 }).primaryKey(),
  provider: varchar('provider', { length: 20 }).notNull(),
  type: varchar('type', { length: 80 }).notNull(),
  payload: jsonb('payload').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('received'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  receivedAt: tz('received_at').notNull().defaultNow(),
  processedAt: tz('processed_at'),
}, (t) => [
  index('webhook_events_pending_idx').on(t.status, t.receivedAt).where(sql`${t.status} IN ('received', 'failed')`),
  check('webhook_events_status', sql`${t.status} IN ('received', 'processed', 'failed', 'ignored')`),
]);

export const packs = pgTable('packs', {
  code: packCodeEnum('code').primaryKey(),
  name: varchar('name', { length: 40 }).notNull(),
  ridesIncluded: integer('rides_included'),
  priceCents: cents('price_cents').notNull(),
  validityDays: integer('validity_days').notNull(),
  rolloverAllowed: boolean('rollover_allowed').notNull().default(false),
  priorities: jsonb('priorities').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
}, (t) => [check('packs_price_positive', sql`${t.priceCents} >= 0`), check('packs_rides_positive', sql`${t.ridesIncluded} IS NULL OR ${t.ridesIncluded} > 0`)]);

export const packPurchases = pgTable('pack_purchases', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  packCode: packCodeEnum('pack_code').notNull().references(() => packs.code),
  pricePaidCents: cents('price_paid_cents').notNull(),
  ridesIncluded: integer('rides_included'),
  ridesRemaining: integer('rides_remaining'),
  carriedOverRemaining: integer('carried_over_remaining').notNull().default(0),
  activatedAt: tz('activated_at').notNull(),
  expiresAt: tz('expires_at').notNull(),
  status: packPurchaseStatusEnum('status').notNull().default('active'),
  autoRenew: boolean('auto_renew').notNull().default(true),
  nextPackCode: packCodeEnum('next_pack_code'),
  rolloverDone: boolean('rollover_done').notNull().default(false),
  billing: packBillingStatusEnum('billing').notNull().default('to_bill'),
  statementId: uuid('statement_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('pack_purchases_driver_idx').on(t.driverId, t.status), index('pack_purchases_expiry_idx').on(t.expiresAt).where(sql`${t.status} = 'active'`), check('pack_purchases_positive', sql`${t.pricePaidCents} >= 0 AND ${t.carriedOverRemaining} >= 0 AND (${t.ridesRemaining} IS NULL OR ${t.ridesRemaining} >= 0)`)]);

export const packConsumptions = pgTable('pack_consumptions', {
  id: id(),
  packPurchaseId: uuid('pack_purchase_id').notNull().references(() => packPurchases.id),
  rideId: uuid('ride_id').notNull().references(() => rides.id),
  fromCarriedOver: boolean('from_carried_over').notNull().default(false),
  consumedAt: createdAt(),
}, (t) => [uniqueIndex('pack_consumptions_ride_unique').on(t.rideId), index('pack_consumptions_purchase_idx').on(t.packPurchaseId)]);

export const weeklyStatements = pgTable('weekly_statements', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  organizationId: uuid('organization_id'),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  platformFaresCents: cents('platform_fares_cents').notNull().default(0),
  platformFareTaxesCents: cents('platform_fare_taxes_cents').notNull().default(0),
  tipsCents: cents('tips_cents').notNull().default(0),
  packsBilledCents: cents('packs_billed_cents').notNull().default(0),
  directFeesCollectedCents: cents('direct_fees_collected_cents').notNull().default(0),
  creditsAndBonusesCents: cents('credits_and_bonuses_cents').notNull().default(0),
  adjustmentsCents: integer('adjustments_cents').notNull().default(0),
  creditsCents: cents('credits_cents').notNull().default(0),
  debitsCents: cents('debits_cents').notNull().default(0),
  netCents: integer('net_cents').notNull().default(0),
  status: statementStatusEnum('status').notNull().default('draft'),
  stripeTransferId: varchar('stripe_transfer_id', { length: 100 }),
  stripeChargeId: varchar('stripe_charge_id', { length: 100 }),
  failureCode: varchar('failure_code', { length: 60 }),
  attempts: integer('attempts').notNull().default(0),
  issuedAt: tz('issued_at'),
  settledAt: tz('settled_at'),
  pdfKey: varchar('pdf_key', { length: 300 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('weekly_statements_period_unique').on(t.driverId, t.periodStart), index('weekly_statements_status_idx').on(t.status, t.periodStart), check('weekly_statements_period', sql`${t.periodEnd} = ${t.periodStart} + 6`)]);

export const statementLines = pgTable('statement_lines', {
  id: id(),
  statementId: uuid('statement_id').notNull().references(() => weeklyStatements.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 40 }).notNull(),
  amountCents: cents('amount_cents').notNull(),
  rideId: uuid('ride_id'),
  packPurchaseId: uuid('pack_purchase_id'),
  label: varchar('label', { length: 120 }).notNull(),
  occurredAt: tz('occurred_at').notNull(),
}, (t) => [index('statement_lines_statement_idx').on(t.statementId), check('statement_lines_amount_positive', sql`${t.amountCents} >= 0`)]);

export const driverBalances = pgTable('driver_balances', {
  driverId: uuid('driver_id').primaryKey().references(() => drivers.id, { onDelete: 'cascade' }),
  balanceCents: integer('balance_cents').notNull().default(0),
  lastStatementId: uuid('last_statement_id'),
  unpaidSince: tz('unpaid_since'),
  suspendedForBalanceAt: tz('suspended_for_balance_at'),
  updatedAt: updatedAt(),
});

export const promotions = pgTable('promotions', {
  id: id(),
  code: varchar('code', { length: 30 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  type: promotionTypeEnum('type').notNull(),
  /** Pour `percent` : bps ; pour `fixed` : cents ; pour `nth_ride` : n. */
  value: integer('value').notNull(),
  maxDiscountCents: cents('max_discount_cents'),
  conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
  waivesFees: boolean('waives_fees').notNull().default(false),
  globalLimit: integer('global_limit'),
  perClientLimit: integer('per_client_limit').notNull().default(1),
  budgetCents: cents('budget_cents'),
  spentCents: cents('spent_cents').notNull().default(0),
  validFrom: tz('valid_from').notNull(),
  validTo: tz('valid_to'),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('promotions_code_unique').on(t.code), check('promotions_value_positive', sql`${t.value} >= 0 AND ${t.spentCents} >= 0`)]);

export const promotionUses = pgTable('promotion_uses', {
  id: id(),
  promotionId: uuid('promotion_id').notNull().references(() => promotions.id),
  clientId: uuid('client_id').notNull().references(() => clients.id),
  rideId: uuid('ride_id').references(() => rides.id),
  discountCents: cents('discount_cents').notNull(),
  driverCompensationCents: cents('driver_compensation_cents').notNull().default(0),
  usedAt: createdAt(),
}, (t) => [index('promotion_uses_promotion_idx').on(t.promotionId), index('promotion_uses_client_idx').on(t.clientId, t.promotionId), check('promotion_uses_positive', sql`${t.discountCents} >= 0 AND ${t.driverCompensationCents} >= 0`)]);

export const credits = pgTable('credits', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  amountCents: cents('amount_cents').notNull(),
  remainingCents: cents('remaining_cents').notNull(),
  origin: creditOriginEnum('origin').notNull(),
  reference: varchar('reference', { length: 100 }),
  note: text('note'),
  expiresAt: tz('expires_at'),
  createdAt: createdAt(),
}, (t) => [index('credits_user_idx').on(t.userId).where(sql`${t.remainingCents} > 0`), check('credits_positive', sql`${t.amountCents} > 0 AND ${t.remainingCents} BETWEEN 0 AND ${t.amountCents}`)]);
