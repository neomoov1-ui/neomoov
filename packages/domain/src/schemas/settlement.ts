/**
 * Règlement hebdomadaire côté My Hub (prompt 09, tâche 4) : génération et aperçu des relevés, émission, versement ou
 * prélèvement, ajustement motivé, soldes des chauffeurs. Les montants sont calculés par `settlement/settlement.ts`.
 */
import { z } from 'zod';
import { STATEMENT_STATUSES } from '../enums.js';
import { cents, isoDate, localDateString, signedCents, uuid } from './common.js';

export const statementLineViewSchema = z.object({
  kind: z.string(),
  label: z.string(),
  /** Crédit positif, débit négatif. */
  amountCents: signedCents,
  rideId: uuid.nullable(),
  packPurchaseId: uuid.nullable(),
  occurredAt: isoDate,
});
export type StatementLineView = z.infer<typeof statementLineViewSchema>;

export const statementGenerateSchema = z.object({
  /** Lundi de la semaine à régler (AAAA-MM-JJ) ; absent : la dernière semaine entièrement écoulée. */
  periodStart: localDateString.optional(),
  /** Un seul chauffeur ; absent : tous les chauffeurs qui ont au moins une ligne. */
  driverId: uuid.optional(),
  /** Aperçu : relevés calculés et renvoyés, rien n'est enregistré. */
  preview: z.boolean().default(false),
  /**
   * Avec `driverId` : crée le brouillon même sans course ni pack, pour y porter la correction d'un relevé déjà émis
   * (chauffeur sans activité la semaine suivante).
   */
  allowEmpty: z.boolean().default(false),
});
export type StatementGenerate = z.input<typeof statementGenerateSchema>;

export const statementComputedSchema = z.object({
  /** Relevé enregistré (brouillon ou déjà émis) ; `null` pour un aperçu. */
  id: uuid.nullable(),
  driverId: uuid,
  driverPublicNumber: z.string(),
  driverName: z.string().nullable(),
  status: z.enum(STATEMENT_STATUSES).nullable(),
  creditsCents: cents,
  debitsCents: cents,
  netCents: signedCents,
  lines: z.array(statementLineViewSchema),
});
export type StatementComputed = z.infer<typeof statementComputedSchema>;

export const statementGenerationSchema = z.object({
  periodStart: localDateString,
  periodEnd: localDateString,
  preview: z.boolean(),
  /** Relevés créés ou recalculés (brouillons) ; ceux déjà émis sont comptés dans `skipped`. */
  generated: z.number().int().min(0),
  skipped: z.number().int().min(0),
  statements: z.array(statementComputedSchema),
});
export type StatementGeneration = z.infer<typeof statementGenerationSchema>;

export const statementAdjustSchema = z.object({
  direction: z.enum(['credit', 'debit']),
  amountCents: z.number().int().min(1).max(10_000_000),
  /** Motif obligatoire, repris comme libellé de la ligne et au journal d'audit. */
  reason: z.string().trim().min(3).max(120),
});
export type StatementAdjust = z.infer<typeof statementAdjustSchema>;

/** Moyens d'un règlement constaté hors plateforme (relevé négatif payé par le chauffeur, ou versé à la main). */
export const OFFLINE_SETTLEMENT_METHODS = ['interac', 'bank_transfer', 'cash', 'cheque', 'other'] as const;
export type OfflineSettlementMethod = (typeof OFFLINE_SETTLEMENT_METHODS)[number];

export const statementSettleOfflineSchema = z.object({
  method: z.enum(OFFLINE_SETTLEMENT_METHODS),
  /** Référence du paiement (numéro Interac, virement, reçu), reprise au journal d'audit et au relevé. */
  reference: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
});
export type StatementSettleOffline = z.infer<typeof statementSettleOfflineSchema>;

export const offlineSettlementViewSchema = z.object({ method: z.enum(OFFLINE_SETTLEMENT_METHODS), reference: z.string(), note: z.string().nullable(), byUserId: uuid });

export const adminStatementDetailSchema = z.object({
  id: uuid,
  driverId: uuid,
  driverPublicNumber: z.string(),
  driverName: z.string().nullable(),
  periodStart: localDateString,
  periodEnd: localDateString,
  status: z.enum(STATEMENT_STATUSES),
  creditsCents: cents,
  debitsCents: cents,
  netCents: signedCents,
  issuedAt: isoDate.nullable(),
  settledAt: isoDate.nullable(),
  attempts: z.number().int().min(0),
  failureCode: z.string().nullable(),
  transferRef: z.string().nullable(),
  chargeRef: z.string().nullable(),
  /** Règlement constaté hors plateforme par les finances, sinon `null`. */
  offlineSettlement: offlineSettlementViewSchema.nullable(),
  pdfAvailable: z.boolean(),
  lines: z.array(statementLineViewSchema),
});
export type AdminStatementDetail = z.infer<typeof adminStatementDetailSchema>;

export const adminBalanceSchema = z.object({
  driverId: uuid,
  driverPublicNumber: z.string(),
  driverName: z.string().nullable(),
  /** Négatif : le chauffeur doit ce montant à Neomoov ; positif : versement en attente. */
  balanceCents: signedCents,
  unpaidSince: isoDate.nullable(),
  suspendedForBalanceAt: isoDate.nullable(),
  lastStatementId: uuid.nullable(),
});
export type AdminBalance = z.infer<typeof adminBalanceSchema>;
