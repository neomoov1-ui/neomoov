/**
 * Facturation certifiée (section 5.13, prompt 09 tâches 5 et 6). Fonctions pures, montants en cents : contenu d'une
 * facture de course, d'une facture de frais d'annulation ou de non-présentation, et d'une note de crédit. Les taxes par
 * nature viennent de `splitTaxDetail` (règlement) : TPS et TVQ du tarif pour le chauffeur (fournisseur du transport,
 * décision D26), des frais pour Neomoov. Rien n'est recalculé ici : les montants de la course font foi.
 */
import { splitTaxDetail, type SettlementRide, type TaxRates } from '../settlement/settlement.js';

/** Course terminée, frais d'annulation, frais de non-présentation, note de crédit (remboursement). */
export const INVOICE_KINDS = ['ride', 'cancellation', 'no_show', 'credit_note'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

/** Opération du système d'enregistrement des ventes (SEV) pour chaque nature de facture. */
export type SevOperation = 'sale' | 'cancellation' | 'credit';

/** Partie qui facture la ligne : le chauffeur (transport) ou Neomoov (frais de service, redevance, péages). */
export type InvoiceParty = 'driver' | 'platform';

export interface InvoiceLine {
  /** Code stable (lignes du devis, `wait_time`, `fare_adjustment`, `promotion`, `service_fee`…) ; le libellé vient de l'API. */
  code: string;
  /** Montant signé : une remise est négative. Sur une note de crédit, tout est positif (la nature dit le sens). */
  amountCents: number;
  party: InvoiceParty;
}

export interface TaxPair {
  gstCents: number;
  qstCents: number;
}

export interface InvoiceTaxes extends TaxPair {
  /** TPS et TVQ sur le tarif complet : taxes du chauffeur (D26). */
  fare: TaxPair;
  /** TPS et TVQ perçues sur les frais de service, la redevance et les péages : taxes de Neomoov. */
  fee: TaxPair;
  /** Taxes du tarif que Neomoov prend en charge quand une promotion a réduit le prix payé (décision du 22 septembre 2026). */
  absorbed: TaxPair;
}

export interface InvoiceAmounts {
  lines: InvoiceLine[];
  /** Part du chauffeur : tarif complet (course) ou frais d'annulation (100 % au chauffeur). */
  fareCents: number;
  serviceFeeCents: number;
  regulatoryFeeCents: number;
  tollsCents: number;
  taxes: InvoiceTaxes;
  tipCents: number;
  totalCents: number;
  creditsAppliedCents: number;
  /** Payé par le mode de paiement de la course (total moins les crédits). */
  paidCents: number;
  /** Écart d'arrondi entre la somme des lignes et le prix final, compensé par une ligne `rounding` ; 0 attendu, journalisé sinon. */
  discrepancyCents: number;
}

/** Montants d'une course terminée, tels qu'enregistrés par la fin de course (`rides`), et les lignes de son devis. */
export interface RideInvoiceInput {
  /** Tarif final complet du chauffeur (attente, négociation et favori compris), avant promotion. */
  fareCents: number;
  promotionDiscountCents: number;
  /** Frais de service réellement facturés (après remise d'alignement). */
  serviceFeeCents: number;
  regulatoryFeeCents: number;
  tollsCents: number;
  /** TPS et TVQ perçues du client. */
  gstCents: number;
  qstCents: number;
  waitChargeCents: number;
  tipCents: number;
  creditsAppliedCents: number;
  /** Prix final taxes comprises, pourboire exclu. */
  finalPriceCents: number;
  /** Lignes du devis (`quotes.lines`) : composantes du tarif et suppléments. */
  quoteLines: ReadonlyArray<{ code: string; amountCents: number }>;
}

/** Codes du devis qui ne sont pas des composantes du tarif : frais et taxes (repris des montants de la course), crédits, attente. */
const NOT_FARE_CODES = new Set(['service_fee', 'regulatory_fee', 'tolls', 'benchmark_alignment', 'gst', 'qst', 'credits', 'promotion', 'wait_time']);

const ZERO: TaxPair = { gstCents: 0, qstCents: 0 };
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

export function sevOperationFor(kind: InvoiceKind): SevOperation {
  if (kind === 'ride') return 'sale';
  if (kind === 'credit_note') return 'credit';
  return 'cancellation';
}

/** Nature de la facture due pour une course dans cet état, ou null (rien à facturer). */
export function invoiceKindForRide(state: string, cancellationFeeCents: number): Exclude<InvoiceKind, 'credit_note'> | null {
  if (state === 'completed' || state === 'rated' || state === 'disputed') return 'ride';
  if (cancellationFeeCents <= 0) return null;
  if (state === 'cancelled_by_client') return 'cancellation';
  if (state === 'no_show') return 'no_show';
  return null;
}

function assertAmounts(values: Record<string, number>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!Number.isInteger(value) || value < 0) throw new RangeError(`Montant de facture invalide : ${key} ${value}`);
  }
}

/**
 * Facture d'une course terminée. Transport (chauffeur) : composantes du tarif du devis, attente, ajustement (négociation,
 * supplément favori retiré) pour retrouver le tarif final, remise de promotion. Neomoov : frais de service, redevance,
 * péages (leurs taxes sont celles de Neomoov dans `splitTaxDetail`). Taxes perçues, détail par nature, pourboire connu à
 * l'émission ; le total est le prix final plus le pourboire.
 */
export function buildRideInvoice(input: RideInvoiceInput, rates: TaxRates): InvoiceAmounts {
  const { quoteLines, ...amounts } = input;
  assertAmounts(amounts);
  const lines: InvoiceLine[] = quoteLines
    .filter((l) => !NOT_FARE_CODES.has(l.code) && l.amountCents !== 0)
    .map((l) => ({ code: l.code, amountCents: l.amountCents, party: 'driver' as const }));
  if (input.waitChargeCents > 0) lines.push({ code: 'wait_time', amountCents: input.waitChargeCents, party: 'driver' });
  const listed = sum(lines.map((l) => l.amountCents));
  if (listed !== input.fareCents) lines.push({ code: 'fare_adjustment', amountCents: input.fareCents - listed, party: 'driver' });
  if (input.promotionDiscountCents > 0) lines.push({ code: 'promotion', amountCents: -input.promotionDiscountCents, party: 'driver' });
  lines.push({ code: 'service_fee', amountCents: input.serviceFeeCents, party: 'platform' });
  lines.push({ code: 'regulatory_fee', amountCents: input.regulatoryFeeCents, party: 'platform' });
  if (input.tollsCents > 0) lines.push({ code: 'tolls', amountCents: input.tollsCents, party: 'platform' });

  const ride: SettlementRide = {
    id: '', status: 'completed', completedAt: new Date(0), paymentChannel: 'platform', fareCents: input.fareCents, serviceFeeCents: input.serviceFeeCents,
    regulatoryFeeCents: input.regulatoryFeeCents, gstCents: input.gstCents, qstCents: input.qstCents, tipCents: input.tipCents, tipChannel: 'platform',
    promotionCompensationCents: input.promotionDiscountCents, tollCents: input.tollsCents, cancellationFeeCents: 0,
  };
  const detail = splitTaxDetail(ride, rates);
  const absorbed: TaxPair = {
    gstCents: Math.max(0, detail.fare.gstCents + detail.fee.gstCents - input.gstCents),
    qstCents: Math.max(0, detail.fare.qstCents + detail.fee.qstCents - input.qstCents),
  };

  const discrepancyCents = sum(lines.map((l) => l.amountCents)) + input.gstCents + input.qstCents - input.finalPriceCents;
  if (discrepancyCents !== 0) lines.push({ code: 'rounding', amountCents: -discrepancyCents, party: 'platform' });
  const creditsAppliedCents = Math.min(input.creditsAppliedCents, input.finalPriceCents);
  return {
    lines,
    fareCents: input.fareCents,
    serviceFeeCents: input.serviceFeeCents,
    regulatoryFeeCents: input.regulatoryFeeCents,
    tollsCents: input.tollsCents,
    taxes: { gstCents: input.gstCents, qstCents: input.qstCents, fare: detail.fare, fee: detail.fee, absorbed },
    tipCents: input.tipCents,
    totalCents: input.finalPriceCents + input.tipCents,
    creditsAppliedCents,
    paidCents: input.finalPriceCents - creditsAppliedCents + input.tipCents,
    discrepancyCents,
  };
}

/**
 * Facture de frais d'annulation ou de non-présentation : une ligne au chauffeur (100 % des frais lui reviennent, 5.2).
 * Aucune taxe n'est ajoutée en V1 : le traitement fiscal de ces frais (indemnité ou fourniture taxable) est à confirmer
 * avec le comptable (docs/sev-adapter.md).
 */
export function buildFeeInvoice(kind: 'cancellation' | 'no_show', feeCents: number): InvoiceAmounts {
  if (!Number.isInteger(feeCents) || feeCents <= 0) throw new RangeError(`Frais invalides : ${feeCents}`);
  return {
    lines: [{ code: kind === 'no_show' ? 'no_show_fee' : 'cancellation_fee', amountCents: feeCents, party: 'driver' }],
    fareCents: feeCents,
    serviceFeeCents: 0,
    regulatoryFeeCents: 0,
    tollsCents: 0,
    taxes: { ...ZERO, fare: ZERO, fee: ZERO, absorbed: ZERO },
    tipCents: 0,
    totalCents: feeCents,
    creditsAppliedCents: 0,
    paidCents: feeCents,
    discrepancyCents: 0,
  };
}

/**
 * Composantes remboursables d'une facture (le pourboire, payé à part, n'en fait pas partie) : transport payé, frais,
 * redevance, péages, et taxes réellement perçues par nature (les taxes prises en charge par Neomoov ne se remboursent pas).
 */
export interface CreditableAmounts {
  transportCents: number;
  serviceFeeCents: number;
  regulatoryFeeCents: number;
  tollsCents: number;
  fareGstCents: number;
  feeGstCents: number;
  fareQstCents: number;
  feeQstCents: number;
}

const CREDITABLE_KEYS = ['transportCents', 'serviceFeeCents', 'regulatoryFeeCents', 'tollsCents', 'fareGstCents', 'feeGstCents', 'fareQstCents', 'feeQstCents'] as const;

export function creditableOf(amounts: Pick<InvoiceAmounts, 'lines' | 'fareCents' | 'serviceFeeCents' | 'regulatoryFeeCents' | 'tollsCents' | 'taxes'>): CreditableAmounts {
  const total = (code: string) => sum(amounts.lines.filter((l) => l.code === code).map((l) => l.amountCents));
  return {
    transportCents: amounts.fareCents + total('promotion'),
    // Un arrondi éventuel (ligne `rounding`, Neomoov) suit les frais de service, pour que les composantes fassent le prix payé.
    serviceFeeCents: Math.max(0, amounts.serviceFeeCents + total('rounding')),
    regulatoryFeeCents: amounts.regulatoryFeeCents,
    tollsCents: amounts.tollsCents,
    fareGstCents: amounts.taxes.gstCents - amounts.taxes.fee.gstCents,
    feeGstCents: amounts.taxes.fee.gstCents,
    fareQstCents: amounts.taxes.qstCents - amounts.taxes.fee.qstCents,
    feeQstCents: amounts.taxes.fee.qstCents,
  };
}

/** Répartition de `total` au prorata des poids, au cent près (plus forts restes, à égalité dans l'ordre des poids). */
export function allocateProRata(total: number, weights: readonly number[]): number[] {
  const weightSum = sum(weights);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);
  if (total >= weightSum) return [...weights];
  const shares = weights.map((w) => Math.floor((w * total) / weightSum));
  const order = weights.map((w, index) => ({ index, remainder: (w * total) % weightSum })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let left = total - sum(shares);
  for (const { index } of order) {
    if (left === 0) break;
    shares[index]! += 1;
    left -= 1;
  }
  return shares;
}

/**
 * Note de crédit d'un remboursement : le montant rendu est réparti au prorata de ce qui reste à créditer sur la facture
 * d'origine (composantes moins les notes de crédit déjà émises), si bien que la somme des notes ne dépasse jamais la
 * facture. Montants positifs. Un remboursement supérieur au reste est plafonné ; l'écart est rapporté.
 */
export function buildCreditNote(original: CreditableAmounts, alreadyCredited: readonly CreditableAmounts[], refundCents: number): InvoiceAmounts & { credited: CreditableAmounts } {
  if (!Number.isInteger(refundCents) || refundCents <= 0) throw new RangeError(`Remboursement invalide : ${refundCents}`);
  const remaining = CREDITABLE_KEYS.map((key) => Math.max(0, original[key] - sum(alreadyCredited.map((c) => c[key]))));
  const shares = allocateProRata(refundCents, remaining);
  const credited = Object.fromEntries(CREDITABLE_KEYS.map((key, i) => [key, shares[i]!])) as unknown as CreditableAmounts;
  const lines: InvoiceLine[] = [
    { code: 'transport', amountCents: credited.transportCents, party: 'driver' as const },
    { code: 'service_fee', amountCents: credited.serviceFeeCents, party: 'platform' as const },
    { code: 'regulatory_fee', amountCents: credited.regulatoryFeeCents, party: 'platform' as const },
    { code: 'tolls', amountCents: credited.tollsCents, party: 'platform' as const },
  ].filter((l) => l.amountCents > 0);
  const gst = credited.fareGstCents + credited.feeGstCents;
  const qst = credited.fareQstCents + credited.feeQstCents;
  const totalCents = sum(shares);
  return {
    lines,
    fareCents: credited.transportCents,
    serviceFeeCents: credited.serviceFeeCents,
    regulatoryFeeCents: credited.regulatoryFeeCents,
    tollsCents: credited.tollsCents,
    taxes: {
      gstCents: gst, qstCents: qst,
      fare: { gstCents: credited.fareGstCents, qstCents: credited.fareQstCents },
      fee: { gstCents: credited.feeGstCents, qstCents: credited.feeQstCents },
      absorbed: ZERO,
    },
    tipCents: 0,
    totalCents,
    creditsAppliedCents: 0,
    paidCents: totalCents,
    discrepancyCents: refundCents - totalCents,
    credited,
  };
}
