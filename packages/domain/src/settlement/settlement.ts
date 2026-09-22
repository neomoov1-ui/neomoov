/**
 * Moteur de règlement hebdomadaire. Fonctions pures, montants en cents.
 * Référence : cahier des charges, sections 5.6, 5.8 et 5.13, et décision D26 (Neomoov ne remet pas
 * les taxes des chauffeurs : les taxes perçues sur les tarifs via la plateforme leur sont reversées).
 */

import { mulDivRound } from '../pricing/quote.js';

export type CreditKind =
  | 'ride_fare_platform' | 'fare_taxes_platform' | 'tip_platform' | 'promotion_compensation'
  | 'bonus' | 'referral_credit' | 'cancellation_fee_platform' | 'toll_reimbursement' | 'adjustment_positive';
export type DebitKind =
  | 'pack_billed' | 'pack_taxes' | 'service_fee_direct' | 'regulatory_fee_direct' | 'fee_taxes_direct'
  | 'cancellation_fee_due' | 'adjustment_negative';
export type StatementLineKind = CreditKind | DebitKind;

const CREDIT_KINDS: ReadonlySet<string> = new Set<CreditKind>([
  'ride_fare_platform', 'fare_taxes_platform', 'tip_platform', 'promotion_compensation', 'bonus',
  'referral_credit', 'cancellation_fee_platform', 'toll_reimbursement', 'adjustment_positive',
]);

export interface StatementLine {
  kind: StatementLineKind;
  /** Montant positif, en cents. Le sens (crédit ou débit) vient de `kind`. */
  amountCents: number;
  rideId?: string;
  packPurchaseId?: string;
  /** Instant de la course ou de l'événement, pour le journal des transactions. */
  occurredAt: Date;
  label?: string;
}

/** Période d'un relevé : dates locales (AAAA-MM-JJ), du lundi au dimanche inclus. */
export interface StatementPeriod { startDate: string; endDate: string; timeZone: string }

export interface TaxRates { gstRatePpm: number; qstRatePpm: number }

export type PaymentChannel = 'platform' | 'direct';

/** Ce que le moteur de règlement a besoin de connaître d'une course terminée ou annulée. */
export interface SettlementRide {
  id: string;
  status: 'completed' | 'cancelled' | 'no_show';
  completedAt: Date;
  paymentChannel: PaymentChannel;
  fareCents: number;
  serviceFeeCents: number;
  regulatoryFeeCents: number;
  gstCents: number;
  qstCents: number;
  tipCents: number;
  tipChannel: PaymentChannel;
  /** Remise de promotion accordée au client sur le tarif ; compensée au chauffeur à 100 %. */
  promotionCompensationCents: number;
  tollCents: number;
  /** Frais d'annulation facturés au client, s'il y a lieu. */
  cancellationFeeCents: number;
}

export interface Statement {
  driverId: string;
  period: StatementPeriod;
  lines: StatementLine[];
  creditsCents: number;
  debitsCents: number;
  netCents: number;
  /** Net positif : versement par Connect. */
  payoutCents: number;
  /** Net négatif : prélèvement sur la méthode enregistrée. */
  chargeCents: number;
  totalsByKind: Record<string, number>;
}

export function isCredit(kind: StatementLineKind): boolean {
  return CREDIT_KINDS.has(kind);
}

function taxesOn(amountCents: number, rates: TaxRates): number {
  return mulDivRound(amountCents, rates.gstRatePpm, 1_000_000) + mulDivRound(amountCents, rates.qstRatePpm, 1_000_000);
}

/**
 * Répartition des taxes d'une course. `fareTaxesCents` : taxes sur le tarif complet du chauffeur, qu'il doit
 * remettre lui-même (décision D26) ; elles lui sont dues même quand une promotion a réduit ce que le client
 * a payé, Neomoov absorbant l'écart. `feeTaxesCents` : part des taxes perçues qui porte sur les frais de
 * service et la redevance, et qui revient à Neomoov.
 */
export function splitTaxes(ride: SettlementRide, rates: TaxRates): { fareTaxesCents: number; feeTaxesCents: number } {
  const collectedFare = ride.fareCents - ride.promotionCompensationCents;
  const feeTaxesCents = Math.max(0, ride.gstCents + ride.qstCents - taxesOn(collectedFare, rates));
  return { fareTaxesCents: taxesOn(ride.fareCents, rates), feeTaxesCents };
}

/**
 * Lignes de relevé d'une course. Paiement via la plateforme : la part du tarif payée par le client, les taxes
 * sur le tarif complet et le pourboire sont crédités. Paiement direct (espèces, Interac, terminal) : le chauffeur
 * a déjà l'argent ; les frais de service, la redevance et leurs taxes lui sont débités. Dans les deux cas, la remise
 * de promotion lui est compensée à 100 % : le chauffeur ne finance jamais une promotion.
 */
export function classifyRideForStatement(ride: SettlementRide, rates: TaxRates): StatementLine[] {
  const at = ride.completedAt;
  const lines: StatementLine[] = [];
  const push = (kind: StatementLineKind, amountCents: number, label: string): void => {
    if (amountCents > 0) lines.push({ kind, amountCents, rideId: ride.id, occurredAt: at, label });
  };
  if (ride.status !== 'completed') {
    if (ride.paymentChannel === 'platform') push('cancellation_fee_platform', ride.cancellationFeeCents, 'Frais d\'annulation');
    return lines;
  }
  const { fareTaxesCents, feeTaxesCents } = splitTaxes(ride, rates);
  if (ride.paymentChannel === 'platform') {
    push('ride_fare_platform', ride.fareCents - ride.promotionCompensationCents, 'Tarif de la course');
    push('fare_taxes_platform', fareTaxesCents, 'TPS et TVQ sur le tarif');
    push('toll_reimbursement', ride.tollCents, 'Péage remboursé');
  } else {
    push('service_fee_direct', ride.serviceFeeCents, 'Frais de service perçus en direct');
    push('regulatory_fee_direct', ride.regulatoryFeeCents, 'Redevance perçue en direct');
    push('fee_taxes_direct', feeTaxesCents, 'Taxes sur les frais perçus en direct');
  }
  if (ride.tipChannel === 'platform') push('tip_platform', ride.tipCents, 'Pourboire');
  push('promotion_compensation', ride.promotionCompensationCents, 'Compensation de promotion');
  return lines;
}

/** Lignes d'un pack facturé sur ce relevé : le prix et ses taxes. */
export function packBillingLines(packPurchaseId: string, priceCents: number, activatedAt: Date, rates: TaxRates, label: string): StatementLine[] {
  if (priceCents === 0) return [];
  const taxes = mulDivRound(priceCents, rates.gstRatePpm, 1_000_000) + mulDivRound(priceCents, rates.qstRatePpm, 1_000_000);
  return [
    { kind: 'pack_billed', amountCents: priceCents, packPurchaseId, occurredAt: activatedAt, label },
    { kind: 'pack_taxes', amountCents: taxes, packPurchaseId, occurredAt: activatedAt, label: 'TPS et TVQ sur le pack' },
  ];
}

/** Construit le relevé : net = crédits − débits, exactement la formule de la section 5.8. */
export function buildStatement(driverId: string, period: StatementPeriod, lines: StatementLine[]): Statement {
  const bad = lines.find((l) => !Number.isInteger(l.amountCents) || l.amountCents < 0);
  if (bad) throw new RangeError(`Ligne de relevé invalide : ${bad.kind} ${bad.amountCents}`);
  const sorted = [...lines].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const totalsByKind: Record<string, number> = {};
  let creditsCents = 0, debitsCents = 0;
  for (const l of sorted) {
    totalsByKind[l.kind] = (totalsByKind[l.kind] ?? 0) + l.amountCents;
    if (isCredit(l.kind)) creditsCents += l.amountCents; else debitsCents += l.amountCents;
  }
  const netCents = creditsCents - debitsCents;
  return { driverId, period, lines: sorted, creditsCents, debitsCents, netCents, payoutCents: Math.max(0, netCents), chargeCents: Math.max(0, -netCents), totalsByKind };
}

/** Date locale AAAA-MM-JJ et jour de la semaine (0 pour dimanche) d'un instant dans un fuseau. */
export function localDate(instant: Date, timeZone: string): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(instant);
  const get = (t: string): string => parts.find((p) => p.type === t)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')) };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Période réglée par une génération faite à `generatedAt` : la semaine du lundi au dimanche la plus récente
 * entièrement écoulée. Générée le vendredi, elle couvre la semaine précédente ; les courses du vendredi au
 * dimanche vont au relevé suivant.
 */
export function periodForGeneration(generatedAt: Date, timeZone: string): StatementPeriod {
  const { date, weekday } = localDate(generatedAt, timeZone);
  const daysSinceMonday = (weekday + 6) % 7;
  const thisMonday = shiftDate(date, -daysSinceMonday);
  return { startDate: shiftDate(thisMonday, -7), endDate: shiftDate(thisMonday, -1), timeZone };
}

export function isInPeriod(instant: Date, period: StatementPeriod): boolean {
  const { date } = localDate(instant, period.timeZone);
  return date >= period.startDate && date <= period.endDate;
}

export interface BalanceSettings { negativeBalanceThresholdCents: number; unpaidGraceDays: number }

export interface DriverBalance {
  balanceCents: number;
  /** Date du premier prélèvement échoué non régularisé, ou `null`. */
  unpaidSince: Date | null;
}

/** Suspension automatique : solde négatif au-delà du seuil, ou impayé depuis plus que le délai de grâce. */
export function evaluateSuspension(balance: DriverBalance, now: Date, settings: BalanceSettings): { suspend: boolean; reason: 'threshold' | 'overdue' | null } {
  if (balance.balanceCents >= 0) return { suspend: false, reason: null };
  if (-balance.balanceCents > settings.negativeBalanceThresholdCents) return { suspend: true, reason: 'threshold' };
  if (balance.unpaidSince && now.getTime() - balance.unpaidSince.getTime() > settings.unpaidGraceDays * 86_400_000) return { suspend: true, reason: 'overdue' };
  return { suspend: false, reason: null };
}
