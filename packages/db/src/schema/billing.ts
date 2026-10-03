/** Section 4.7 : facturation, taxes et conformité. */

import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { drivers } from './drivers.js';
import { complianceEntityTypeEnum, dataRequestTypeEnum, incidentSeverityEnum, incidentStatusEnum, incidentTypeEnum, paymentMethodEnum, sanctionTypeEnum, sevStatusEnum } from './enums.js';
import { users } from './identity.js';
import { rides } from './rides.js';

/**
 * Factures certifiées. Le numéro est séquentiel sans trou par fournisseur (chauffeur) : une séquence PostgreSQL
 * par chauffeur, créée par la fonction `next_invoice_number(driver_id)` de la migration 0001.
 */
export const invoices = pgTable('invoices', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  /** Numéro global lisible (NM-0001841) et numéro séquentiel du fournisseur. */
  number: varchar('number', { length: 20 }).notNull(),
  supplierSequence: integer('supplier_sequence').notNull(),
  supplierName: varchar('supplier_name', { length: 150 }).notNull(),
  supplierGstNumber: varchar('supplier_gst_number', { length: 20 }),
  supplierQstNumber: varchar('supplier_qst_number', { length: 20 }),
  lines: jsonb('lines').notNull(),
  fareCents: cents('fare_cents').notNull(),
  serviceFeeCents: cents('service_fee_cents').notNull(),
  regulatoryFeeCents: cents('regulatory_fee_cents').notNull(),
  gstCents: cents('gst_cents').notNull(),
  qstCents: cents('qst_cents').notNull(),
  tipCents: cents('tip_cents').notNull().default(0),
  totalCents: cents('total_cents').notNull(),
  paymentMethod: paymentMethodEnum('payment_method').notNull(),
  sevTransactionId: varchar('sev_transaction_id', { length: 100 }),
  sevStatus: sevStatusEnum('sev_status').notNull().default('pending'),
  pdfKey: varchar('pdf_key', { length: 300 }),
  qrPayload: text('qr_payload'),
  creditNoteOfId: uuid('credit_note_of_id'),
  /** Course terminée, frais d'annulation, frais de non-présentation, ou note de crédit (remboursement). */
  kind: varchar('kind', { length: 20 }).notNull().default('ride'),
  issuedAt: tz('issued_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('invoices_number_unique').on(t.number),
  uniqueIndex('invoices_supplier_sequence_unique').on(t.driverId, t.supplierSequence),
  uniqueIndex('invoices_ride_unique').on(t.rideId).where(sql`${t.creditNoteOfId} IS NULL`),
  index('invoices_sev_status_idx').on(t.sevStatus).where(sql`${t.sevStatus} IN ('pending', 'error')`),
  check('invoices_kind', sql`${t.kind} IN ('ride', 'cancellation', 'no_show', 'credit_note')`),
  check('invoices_amounts_positive', sql`${t.fareCents} >= 0 AND ${t.totalCents} >= 0 AND ${t.gstCents} >= 0 AND ${t.qstCents} >= 0`),
]);

export const sevTransmissions = pgTable('sev_transmissions', {
  id: id(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  adapter: varchar('adapter', { length: 30 }).notNull(),
  request: jsonb('request'),
  response: jsonb('response'),
  status: sevStatusEnum('status').notNull(),
  attempt: integer('attempt').notNull().default(1),
  occurredAt: createdAt(),
}, (t) => [index('sev_transmissions_invoice_idx').on(t.invoiceId, t.attempt)]);

export const redevanceLedger = pgTable('redevance_ledger', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id),
  amountCents: cents('amount_cents').notNull(),
  /** Période de remise, AAAA-MM. */
  remittancePeriod: varchar('remittance_period', { length: 7 }).notNull(),
  remittedAt: tz('remitted_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('redevance_ledger_ride_unique').on(t.rideId), index('redevance_ledger_period_idx').on(t.remittancePeriod), check('redevance_ledger_positive', sql`${t.amountCents} >= 0`)]);

export const taxLedger = pgTable('tax_ledger', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  fareGstCents: cents('fare_gst_cents').notNull(),
  fareQstCents: cents('fare_qst_cents').notNull(),
  feeGstCents: cents('fee_gst_cents').notNull(),
  feeQstCents: cents('fee_qst_cents').notNull(),
  period: varchar('period', { length: 7 }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('tax_ledger_ride_unique').on(t.rideId), index('tax_ledger_period_idx').on(t.period), index('tax_ledger_driver_period_idx').on(t.driverId, t.period), check('tax_ledger_positive', sql`${t.fareGstCents} >= 0 AND ${t.fareQstCents} >= 0 AND ${t.feeGstCents} >= 0 AND ${t.feeQstCents} >= 0`)]);

/**
 * Redevance Neomoov (3 octobre 2026) : une ligne par course terminée, écrite dans la transaction de fin de course, taux et
 * montant figés à ce moment (un changement de taux ne touche jamais une course déjà terminée). Le relevé hebdomadaire en
 * tire la ligne `platform_fee` (retenue sur le versement par carte, ajoutée à la dette en paiement direct). Distincte du
 * registre de la redevance gouvernementale (`redevance_ledger`). Montant = arrondi(assiette × taux / 10 000), vérifié par
 * la base.
 */
export const platformFees = pgTable('platform_fees', {
  id: id(),
  rideId: uuid('ride_id').notNull().references(() => rides.id),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  /** Assiette : tarif complet du chauffeur (hors taxes, redevance gouvernementale, frais de service, péages et pourboire). */
  baseCents: cents('base_cents').notNull(),
  rateBps: integer('rate_bps').notNull(),
  amountCents: cents('amount_cents').notNull(),
  /** `platform` : payée par carte (retenue sur le versement) ; `direct` : payée au chauffeur (ajoutée à sa dette). */
  paymentChannel: varchar('payment_channel', { length: 10 }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('platform_fees_ride_unique').on(t.rideId),
  index('platform_fees_driver_idx').on(t.driverId, t.createdAt),
  index('platform_fees_created_idx').on(t.createdAt),
  check('platform_fees_rate_range', sql`${t.rateBps} BETWEEN 500 AND 1000`),
  check('platform_fees_amounts', sql`${t.baseCents} >= 0 AND ${t.amountCents} >= 0 AND ${t.amountCents} = (${t.baseCents}::bigint * ${t.rateBps} + 5000) / 10000`),
  check('platform_fees_channel', sql`${t.paymentChannel} IN ('platform', 'direct')`),
]);

export const geolocationExports = pgTable('geolocation_exports', {
  id: id(),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  format: varchar('format', { length: 20 }).notNull(),
  fileKey: varchar('file_key', { length: 300 }),
  rideCount: integer('ride_count').notNull().default(0),
  transmittedAt: tz('transmitted_at'),
  acknowledgement: text('acknowledgement'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('geolocation_exports_period_unique').on(t.periodStart, t.periodEnd, t.format)]);

export const complianceChecks = pgTable('compliance_checks', {
  id: id(),
  entityType: complianceEntityTypeEnum('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  type: varchar('type', { length: 40 }).notNull(),
  dueOn: date('due_on').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  remindersSent: integer('reminders_sent').notNull().default(0),
  suspensionAppliedAt: tz('suspension_applied_at'),
  resolvedAt: tz('resolved_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('compliance_checks_entity_idx').on(t.entityType, t.entityId), index('compliance_checks_due_idx').on(t.dueOn).where(sql`${t.status} = 'pending'`), check('compliance_checks_status', sql`${t.status} IN ('pending', 'resolved', 'overdue')`)]);

export const incidents = pgTable('incidents', {
  id: id(),
  rideId: uuid('ride_id').references(() => rides.id),
  /** Organisation de l'incident (étape 20) : celle de la course ; nulle pour la plateforme. */
  organizationId: uuid('organization_id').default(sql`app_scope_organization_id()`),
  type: incidentTypeEnum('type').notNull(),
  severity: incidentSeverityEnum('severity').notNull().default('medium'),
  reportedByUserId: uuid('reported_by_user_id'),
  reportedByKind: varchar('reported_by_kind', { length: 20 }).notNull(),
  description: text('description').notNull(),
  attachments: jsonb('attachments').notNull().default(sql`'[]'::jsonb`),
  status: incidentStatusEnum('status').notNull().default('open'),
  decision: text('decision'),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedAt: tz('decided_at'),
  /** Incident de confidentialité (Loi 25) : registre et déclaration à la CAI s'il y a lieu. */
  privacyBreach: jsonb('privacy_breach'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('incidents_status_idx').on(t.status, t.severity), index('incidents_ride_idx').on(t.rideId), index('incidents_org_idx').on(t.organizationId, t.status), check('incidents_reporter_kind', sql`${t.reportedByKind} IN ('client', 'driver', 'operator', 'system', 'agent')`)]);

export const sanctions = pgTable('sanctions', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  incidentId: uuid('incident_id').references(() => incidents.id),
  type: sanctionTypeEnum('type').notNull(),
  reason: text('reason').notNull(),
  startsAt: tz('starts_at').notNull().defaultNow(),
  endsAt: tz('ends_at'),
  decidedByUserId: uuid('decided_by_user_id'),
  createdAt: createdAt(),
}, (t) => [index('sanctions_driver_idx').on(t.driverId, t.startsAt)]);

/**
 * Charte d'équité (D7) : réponse ou appel du chauffeur sur une sanction, une seule demande ouverte par sanction.
 * Décision d'une personne sous 4 heures ouvrables ; l'appel, par une autre personne que celle qui a décidé la sanction.
 */
export const sanctionAppeals = pgTable('sanction_appeals', {
  id: id(),
  sanctionId: uuid('sanction_id').notNull().references(() => sanctions.id),
  driverId: uuid('driver_id').notNull().references(() => drivers.id),
  kind: varchar('kind', { length: 10 }).notNull(),
  message: text('message').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('open'),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedAt: tz('decided_at'),
  decisionNote: text('decision_note'),
  createdAt: createdAt(),
}, (t) => [
  index('sanction_appeals_status_idx').on(t.status, t.createdAt),
  index('sanction_appeals_driver_idx').on(t.driverId),
  uniqueIndex('sanction_appeals_one_open').on(t.sanctionId).where(sql`${t.status} = 'open'`),
  check('sanction_appeals_kind', sql`${t.kind} IN ('response', 'appeal')`),
  check('sanction_appeals_status', sql`${t.status} IN ('open', 'upheld', 'overturned')`),
]);

export const dataRequests = pgTable('data_requests', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: dataRequestTypeEnum('type').notNull(),
  receivedAt: tz('received_at').notNull().defaultNow(),
  dueOn: date('due_on').notNull(),
  processedAt: tz('processed_at'),
  outcome: text('outcome'),
  fileKey: varchar('file_key', { length: 300 }),
  handledByUserId: uuid('handled_by_user_id'),
}, (t) => [index('data_requests_open_idx').on(t.dueOn).where(sql`${t.processedAt} IS NULL`), index('data_requests_user_idx').on(t.userId)]);

export const retentionJobs = pgTable('retention_jobs', {
  id: id(),
  type: varchar('type', { length: 40 }).notNull(),
  executedAt: createdAt(),
  rowsProcessed: integer('rows_processed').notNull().default(0),
  details: jsonb('details'),
}, (t) => [index('retention_jobs_type_idx').on(t.type, t.executedAt)]);
