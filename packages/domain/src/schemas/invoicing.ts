/**
 * Schémas de la facturation certifiée (section 5.13, prompt 09) : document figé d'une facture, facture d'une course
 * (client, chauffeur, personnel), vérification publique par le code QR, état des transmissions au SEV (My Hub).
 */
import { z } from 'zod';
import { PAYMENT_METHODS, SEV_STATUSES, VEHICLE_CATEGORIES } from '../enums.js';
import { INVOICE_KINDS } from '../invoicing/invoice.js';
import { cents, isoDate, signedCents, uuid } from './common.js';

const count = z.number().int().min(0);

/** Numéro global lisible d'une facture ou d'une note de crédit (NM-0001841). */
export const invoiceNumberSchema = z.string().regex(/^NM-\d{7}$/);
export const invoiceKindSchema = z.enum(INVOICE_KINDS);
const taxPairSchema = z.object({ gstCents: cents, qstCents: cents });

export const invoiceLineViewSchema = z.object({
  code: z.string(),
  label: z.string(),
  amountCents: signedCents,
  /** `driver` : transport, facturé par le chauffeur ; `platform` : frais de service, redevance et péages, facturés par Neomoov. */
  party: z.enum(['driver', 'platform']),
});

/** Composantes remboursables d'une facture, ou créditées par une note de crédit (voir `CreditableAmounts`). */
export const creditableAmountsSchema = z.object({
  transportCents: cents, serviceFeeCents: cents, regulatoryFeeCents: cents, tollsCents: cents,
  fareGstCents: cents, feeGstCents: cents, fareQstCents: cents, feeQstCents: cents,
});

const supplierSchema = z.object({ publicNumber: z.string(), name: z.string(), gstNumber: z.string().nullable(), qstNumber: z.string().nullable() });
const platformSchema = z.object({ name: z.string(), address: z.string(), gstNumber: z.string().nullable(), qstNumber: z.string().nullable() });
const tripSchema = z.object({
  category: z.enum(VEHICLE_CATEGORIES),
  originAddress: z.string(),
  destinationAddress: z.string(),
  distanceMeters: z.number().int().min(0).nullable(),
  durationSeconds: z.number().int().min(0).nullable(),
  /** Fin de course, annulation ou non-présentation. */
  occurredAt: isoDate.nullable(),
});
const taxesSchema = z.object({
  gstCents: cents,
  qstCents: cents,
  gstRatePpm: count,
  qstRatePpm: count,
  /** Taxes du chauffeur sur le tarif complet (D26). */
  fare: taxPairSchema,
  /** Taxes de Neomoov sur les frais de service, la redevance et les péages. */
  fee: taxPairSchema,
  /** Taxes du tarif prises en charge par Neomoov après une promotion. */
  absorbed: taxPairSchema,
});

/**
 * Document figé à l'émission, gardé dans `invoices.lines` (JSON) : tout ce que la facture montre, pour qu'elle reste
 * identique même si la course, le chauffeur ou les réglages changent ensuite (factures conservées 7 ans).
 */
export const invoiceDocumentSchema = z.object({
  version: z.literal(1),
  ridePublicNumber: z.string(),
  supplier: supplierSchema,
  platform: platformSchema,
  customerName: z.string().nullable(),
  trip: tripSchema,
  lines: z.array(invoiceLineViewSchema),
  tollsCents: cents,
  taxes: taxesSchema,
  payment: z.object({ creditsAppliedCents: cents, paidCents: cents }),
  legalNotice: z.string(),
  creditable: creditableAmountsSchema,
  creditNote: z.object({
    refundId: uuid,
    originalInvoiceId: uuid,
    originalNumber: invoiceNumberSchema,
    mode: z.enum(['refund', 'credit']),
    reason: z.string(),
  }).nullable(),
});
export type InvoiceDocument = z.infer<typeof invoiceDocumentSchema>;

export const invoiceSummarySchema = z.object({
  id: uuid,
  number: invoiceNumberSchema,
  kind: invoiceKindSchema,
  issuedAt: isoDate,
  totalCents: cents,
  sevStatus: z.enum(SEV_STATUSES),
});
export type InvoiceSummary = z.infer<typeof invoiceSummarySchema>;

/** Facture d'une course (`GET /v1/rides/{id}/invoice`) : client, chauffeur de la course, personnel. */
export const rideInvoiceSchema = z.object({
  id: uuid,
  rideId: uuid,
  ridePublicNumber: z.string(),
  kind: invoiceKindSchema,
  number: invoiceNumberSchema,
  /** Numéro séquentiel propre au fournisseur (le chauffeur), sans trou. */
  supplierSequence: z.number().int().positive(),
  issuedAt: isoDate,
  supplier: supplierSchema.extend({ driverId: uuid }),
  platform: platformSchema,
  customerName: z.string().nullable(),
  trip: tripSchema,
  lines: z.array(invoiceLineViewSchema),
  fareCents: cents,
  serviceFeeCents: cents,
  regulatoryFeeCents: cents,
  tollsCents: cents,
  taxes: taxesSchema,
  tipCents: cents,
  totalCents: cents,
  payment: z.object({ method: z.enum(PAYMENT_METHODS), creditsAppliedCents: cents, paidCents: cents }),
  sev: z.object({ status: z.enum(SEV_STATUSES), transactionId: z.string().nullable() }),
  verificationUrl: z.string().url().nullable(),
  legalNotice: z.string(),
  /** Le PDF est produit par la file `invoicing` : `GET /v1/rides/{id}/invoice/pdf` quand il est prêt. */
  pdfAvailable: z.boolean(),
  creditNoteOf: z.object({ id: uuid, number: invoiceNumberSchema }).nullable(),
  refund: z.object({ id: uuid, mode: z.enum(['refund', 'credit']), reason: z.string() }).nullable(),
  /** Notes de crédit émises sur cette facture (remboursements), de la plus ancienne à la plus récente. */
  creditNotes: z.array(invoiceSummarySchema),
});
export type RideInvoiceView = z.infer<typeof rideInvoiceSchema>;

/** Téléchargement du PDF : la facture de la course par défaut, ou l'une de ses notes de crédit. */
export const invoicePdfQuerySchema = z.object({ documentId: uuid.optional() });

/** Jeton signé du code QR (version, identifiant, signature HMAC tronquée), en base64url. */
export const invoiceVerificationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{44}$/);

/** Vérification publique d'une facture par son code QR : le minimum, sans donnée personnelle du client. */
export const invoiceVerificationSchema = z.object({
  number: invoiceNumberSchema,
  kind: invoiceKindSchema,
  issuedAt: isoDate,
  supplierName: z.string(),
  totalCents: cents,
  sevStatus: z.enum(SEV_STATUSES),
});
export type InvoiceVerification = z.infer<typeof invoiceVerificationSchema>;

/** État des transmissions au SEV pour My Hub (`GET /v1/admin/sev/status`). */
export const sevStatusReportSchema = z.object({
  adapter: z.object({ name: z.string(), healthy: z.boolean(), latencyMs: count.nullable(), detail: z.string().nullable() }),
  maxAttempts: z.number().int().positive(),
  counts: z.object({ pending: count, sent: count, acknowledged: count, error: count }),
  lastErrors: z.array(z.object({
    invoiceId: uuid,
    number: invoiceNumberSchema,
    kind: invoiceKindSchema,
    sevStatus: z.enum(SEV_STATUSES),
    attempt: z.number().int().positive(),
    error: z.string(),
    occurredAt: isoDate,
  })),
});
export type SevStatusReport = z.infer<typeof sevStatusReportSchema>;

/** Reprise manuelle d'une transmission (`POST /v1/admin/sev/retry/{invoiceId}`). */
export const sevRetryResultSchema = z.object({
  invoiceId: uuid,
  number: invoiceNumberSchema,
  sevStatus: z.enum(SEV_STATUSES),
  transactionId: z.string().nullable(),
  attempts: count,
});
export type SevRetryResult = z.infer<typeof sevRetryResultSchema>;
