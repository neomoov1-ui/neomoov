/**
 * Registres de la redevance et des taxes (section 5.13) et périodes de leurs exports. Fonctions pures, montants en cents.
 * La période d'une ligne de registre est le mois local (heure de Montréal) de la fin de course. Un export porte sur un
 * mois (`AAAA-MM`) ou sur un trimestre civil (`AAAA-Tn` : T1 de janvier à mars, T2 d'avril à juin, T3 de juillet à
 * septembre, T4 d'octobre à décembre), la notation des déclarations trimestrielles de TPS et de TVQ.
 */

import { localDate, splitTaxDetail, type TaxRates } from './settlement.js';

export type LedgerPeriodKind = 'month' | 'quarter';

export interface LedgerPeriod {
  /** Code tel que saisi : `2026-09` ou `2026-T3`. */
  code: string;
  kind: LedgerPeriodKind;
  /** Mois couverts (AAAA-MM), dans l'ordre. */
  months: string[];
  /** Premier et dernier jour local couverts (AAAA-MM-JJ), inclus. */
  startDate: string;
  endDate: string;
}

const MONTH_CODE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const QUARTER_CODE = /^(\d{4})-T([1-4])$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Dernier jour (AAAA-MM-JJ) d'un mois AAAA-MM. */
export function lastDayOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${pad2(day)}`;
}

/** Période d'export lue depuis son code ; `null` si le code n'est ni un mois ni un trimestre valides. */
export function parseLedgerPeriod(code: string): LedgerPeriod | null {
  const month = MONTH_CODE.exec(code);
  if (month) return { code, kind: 'month', months: [code], startDate: `${code}-01`, endDate: lastDayOfMonth(code) };
  const quarter = QUARTER_CODE.exec(code);
  if (!quarter) return null;
  const year = quarter[1]!;
  const first = (Number(quarter[2]) - 1) * 3 + 1;
  const months = [first, first + 1, first + 2].map((m) => `${year}-${pad2(m)}`);
  return { code, kind: 'quarter', months, startDate: `${months[0]}-01`, endDate: lastDayOfMonth(months[2]!) };
}

/** Mois local (AAAA-MM) d'un instant. */
export function monthOf(instant: Date, timeZone: string): string {
  return localDate(instant, timeZone).date.slice(0, 7);
}

/** Trimestre civil (AAAA-Tn) d'un mois AAAA-MM. */
export function quarterOfMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return `${year}-T${Math.floor((m - 1) / 3) + 1}`;
}

/** Mois précédent (AAAA-MM). */
export function previousMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${year - 1}-12` : `${year}-${pad2(m - 1)}`;
}

/**
 * Redevance due pour une course terminée : le montant facturé au client, ou le montant par course en vigueur quand la
 * course n'en portait pas (course offerte : Neomoov absorbe la redevance, qui reste due à l'État).
 */
export function redevanceDueCents(billedCents: number | null, perRideCents: number): number {
  return billedCents !== null && billedCents > 0 ? billedCents : perRideCents;
}

/** Ce que les registres ont besoin de connaître d'une course terminée. */
export interface LedgerRide {
  id: string;
  driverId: string;
  completedAt: Date;
  /** Tarif complet du chauffeur (avant la remise de promotion, compensée par Neomoov). */
  fareCents: number;
  promotionCompensationCents: number;
  /** Redevance facturée au client (nulle sur une course offerte). */
  regulatoryFeeCents: number | null;
  gstCents: number;
  qstCents: number;
}

export interface LedgerEntries {
  redevance: { rideId: string; amountCents: number; remittancePeriod: string };
  taxes: { rideId: string; driverId: string; fareGstCents: number; fareQstCents: number; feeGstCents: number; feeQstCents: number; period: string };
}

/**
 * Lignes des deux registres pour une course terminée. Les taxes viennent de `splitTaxDetail` (TPS et TVQ du tarif pour
 * le chauffeur, fournisseur du transport, décision D26 ; celles perçues sur les frais de service et la redevance pour
 * Neomoov) ; la période est le mois local de la fin de course.
 */
export function ledgerEntriesForRide(ride: LedgerRide, settings: { rates: TaxRates; regulatoryFeeCents: number; timeZone: string }): LedgerEntries {
  const period = monthOf(ride.completedAt, settings.timeZone);
  const detail = splitTaxDetail(
    {
      id: ride.id, status: 'completed', completedAt: ride.completedAt, paymentChannel: 'platform', fareCents: ride.fareCents, serviceFeeCents: 0,
      regulatoryFeeCents: ride.regulatoryFeeCents ?? 0, gstCents: ride.gstCents, qstCents: ride.qstCents, tipCents: 0, tipChannel: 'platform',
      promotionCompensationCents: ride.promotionCompensationCents, tollCents: 0, cancellationFeeCents: 0,
    },
    settings.rates,
  );
  return {
    redevance: { rideId: ride.id, amountCents: redevanceDueCents(ride.regulatoryFeeCents, settings.regulatoryFeeCents), remittancePeriod: period },
    taxes: {
      rideId: ride.id, driverId: ride.driverId, period,
      fareGstCents: detail.fare.gstCents, fareQstCents: detail.fare.qstCents, feeGstCents: detail.fee.gstCents, feeQstCents: detail.fee.qstCents,
    },
  };
}

/** Totaux des taxes d'un chauffeur sur ses tarifs (rapport trimestriel pour ses déclarations). */
export interface DriverTaxTotals {
  rideCount: number;
  fareCents: number;
  gstCents: number;
  qstCents: number;
}

/** Rapport d'une période : un total par mois (mois sans course compris, à zéro) et le total de la période. */
export function driverTaxReport(period: LedgerPeriod, rows: Array<DriverTaxTotals & { month: string }>): { months: Array<DriverTaxTotals & { month: string }>; totals: DriverTaxTotals } {
  const zero = (): DriverTaxTotals => ({ rideCount: 0, fareCents: 0, gstCents: 0, qstCents: 0 });
  const add = (a: DriverTaxTotals, b: DriverTaxTotals): DriverTaxTotals => ({ rideCount: a.rideCount + b.rideCount, fareCents: a.fareCents + b.fareCents, gstCents: a.gstCents + b.gstCents, qstCents: a.qstCents + b.qstCents });
  const months = period.months.map((month) => ({ month, ...rows.filter((r) => r.month === month).reduce<DriverTaxTotals>((sum, r) => add(sum, r), zero()) }));
  return { months, totals: months.reduce<DriverTaxTotals>((sum, m) => add(sum, m), zero()) };
}
