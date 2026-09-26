/**
 * Schémas des registres de la redevance et des taxes, de leurs exports et de l'export de géolocalisation (prompt 09,
 * tâches 7 et 8, section 5.13). Périodes : un mois `AAAA-MM` ou un trimestre civil `AAAA-Tn` (T1 à T4).
 */
import { z } from 'zod';
import { cents, isoDate, localDateString, uuid } from './common.js';

const count = z.number().int().min(0);

export const LEDGER_TYPES = ['redevance', 'taxes'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const monthCode = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois AAAA-MM attendu, par exemple 2026-09');
export const quarterCode = z.string().regex(/^\d{4}-T[1-4]$/, 'Trimestre AAAA-Tn attendu, par exemple 2026-T3');
export const ledgerPeriodCode = z.string().regex(/^\d{4}-(0[1-9]|1[0-2]|T[1-4])$/, 'Période AAAA-MM (mois) ou AAAA-Tn (trimestre) attendue, par exemple 2026-09 ou 2026-T3');

/** `GET /v1/admin/ledgers/exports` (CSV) et demande d'un rapport de synthèse PDF. */
export const ledgerExportQuerySchema = z.object({ type: z.enum(LEDGER_TYPES), period: ledgerPeriodCode });
export type LedgerExportQuery = z.infer<typeof ledgerExportQuerySchema>;

/** Rapport de synthèse PDF, produit par le worker (file `exports`). */
export const LEDGER_SUMMARY_STATUSES = ['pending', 'ready', 'failed'] as const;
export const ledgerSummarySchema = z.object({
  type: z.enum(LEDGER_TYPES),
  period: ledgerPeriodCode,
  status: z.enum(LEDGER_SUMMARY_STATUSES),
  requestedAt: isoDate,
  generatedAt: isoDate.nullable(),
  /** Chemin de téléchargement sous `/v1` quand le rapport est prêt. */
  downloadPath: z.string().nullable(),
  error: z.string().nullable(),
});
export type LedgerSummaryView = z.infer<typeof ledgerSummarySchema>;

/** Un mois des registres : redevance (due, facturée, remise) et taxes par nature. */
export const ledgerMonthSchema = z.object({
  period: monthCode,
  rideCount: count,
  redevanceCents: cents,
  /** Redevance facturée aux clients (plus basse que la redevance due quand Neomoov l'a absorbée). */
  redevanceBilledCents: cents,
  remittedCents: cents,
  unremittedCount: count,
  /** Dernière remise enregistrée pour ce mois. */
  remittedAt: isoDate.nullable(),
  fareGstCents: cents,
  fareQstCents: cents,
  feeGstCents: cents,
  feeQstCents: cents,
});
export type LedgerMonthView = z.infer<typeof ledgerMonthSchema>;

/** Remise de la redevance d'un mois à l'État : `remittedOn` (date locale) par défaut aujourd'hui. */
export const redevanceRemitSchema = z.object({
  period: monthCode,
  remittedOn: localDateString.optional(),
  /** Référence de la remise (numéro de confirmation), conservée au journal d'audit. */
  reference: z.string().trim().min(1).max(100).optional(),
});
export type RedevanceRemitInput = z.input<typeof redevanceRemitSchema>;
export const redevanceRemitResultSchema = z.object({
  period: monthCode,
  rideCount: count,
  amountCents: cents,
  newlyRemitted: count,
  newlyRemittedCents: cents,
  remittedAt: isoDate,
});
export type RedevanceRemitResult = z.infer<typeof redevanceRemitResultSchema>;

/** Rapport trimestriel d'un chauffeur pour ses déclarations : TPS et TVQ sur ses tarifs, par mois. */
export const driverTaxReportQuerySchema = z.object({ quarter: quarterCode.optional() });
const driverTaxTotalsSchema = z.object({ rideCount: count, fareCents: cents, gstCents: cents, qstCents: cents });
export const driverTaxReportSchema = z.object({
  quarter: quarterCode,
  startDate: localDateString,
  endDate: localDateString,
  driver: z.object({ id: uuid, publicNumber: z.string(), name: z.string().nullable(), gstNumber: z.string().nullable(), qstNumber: z.string().nullable() }),
  months: z.array(driverTaxTotalsSchema.extend({ month: monthCode })),
  totals: driverTaxTotalsSchema,
  generatedAt: isoDate,
});
export type DriverTaxReport = z.infer<typeof driverTaxReportSchema>;

/** Export mensuel de géolocalisation (section 5.13, format provisoire à confirmer avec la CTQ). */
export const geolocationExportSchema = z.object({
  id: uuid,
  period: monthCode,
  periodStart: localDateString,
  periodEnd: localDateString,
  format: z.string(),
  rideCount: count,
  fileName: z.string().nullable(),
  /** Chemin de téléchargement sous `/v1`, null si aucun fichier n'est archivé. */
  downloadPath: z.string().nullable(),
  producedAt: isoDate,
  transmittedAt: isoDate.nullable(),
  acknowledgement: z.string().nullable(),
});
export type GeolocationExportView = z.infer<typeof geolocationExportSchema>;
export const geolocationExportRunSchema = z.object({ month: monthCode });
export const geolocationExportRunResultSchema = z.object({
  month: monthCode,
  format: z.string(),
  /** `done` : fichier produit avant la réponse (mode sans Redis) ; `queued` : le worker le produira. */
  status: z.enum(['done', 'queued']),
  export: geolocationExportSchema.nullable(),
});
export type GeolocationExportRunResult = z.infer<typeof geolocationExportRunResultSchema>;
