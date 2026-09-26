import { describe, expect, it } from 'vitest';
import {
  driverTaxReport, driverTaxReportQuerySchema, lastDayOfMonth, ledgerEntriesForRide, ledgerExportQuerySchema, monthOf, parseLedgerPeriod, previousMonth,
  quarterOfMonth, redevanceDueCents, redevanceRemitSchema, type LedgerRide, type TaxRates,
} from '../src/index.js';

const rates: TaxRates = { gstRatePpm: 50_000, qstRatePpm: 99_750 };
const TZ = 'America/Toronto';
const ride = (over: Partial<LedgerRide> = {}): LedgerRide => ({
  id: 'r1', driverId: 'd1', completedAt: new Date('2026-09-15T14:00:00Z'), fareCents: 2455, promotionCompensationCents: 0, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274, ...over,
});

describe('périodes des registres', () => {
  it('mois : un seul mois, du premier au dernier jour', () => {
    expect(parseLedgerPeriod('2026-09')).toEqual({ code: '2026-09', kind: 'month', months: ['2026-09'], startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(parseLedgerPeriod('2028-02')?.endDate).toBe('2028-02-29');
    expect(parseLedgerPeriod('2026-02')?.endDate).toBe('2026-02-28');
  });
  it('trimestre civil : trois mois, T1 de janvier à mars, T4 d\'octobre à décembre', () => {
    expect(parseLedgerPeriod('2026-T3')).toEqual({ code: '2026-T3', kind: 'quarter', months: ['2026-07', '2026-08', '2026-09'], startDate: '2026-07-01', endDate: '2026-09-30' });
    expect(parseLedgerPeriod('2026-T1')?.months).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(parseLedgerPeriod('2026-T4')?.endDate).toBe('2026-12-31');
  });
  it('codes invalides refusés', () => {
    for (const code of ['2026-13', '2026-00', '2026-T5', '2026-Q3', '26-09', '2026-9', '']) expect(parseLedgerPeriod(code), code).toBeNull();
  });
  it('mois local d\'un instant (heure de Montréal), trimestre et mois précédent', () => {
    // 1er octobre 2026 à 03 h 30 UTC : encore le 30 septembre à Montréal.
    expect(monthOf(new Date('2026-10-01T03:30:00Z'), TZ)).toBe('2026-09');
    expect(monthOf(new Date('2026-10-01T04:30:00Z'), TZ)).toBe('2026-10');
    expect(quarterOfMonth('2026-01')).toBe('2026-T1');
    expect(quarterOfMonth('2026-06')).toBe('2026-T2');
    expect(quarterOfMonth('2026-09')).toBe('2026-T3');
    expect(quarterOfMonth('2026-12')).toBe('2026-T4');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
  });
});

describe('lignes des registres d\'une course terminée', () => {
  const settings = { rates, regulatoryFeeCents: 90, timeZone: TZ };
  it('course au tarif : redevance facturée, taxes du tarif pour le chauffeur, celles des frais pour Neomoov', () => {
    expect(ledgerEntriesForRide(ride(), settings)).toEqual({
      redevance: { rideId: 'r1', amountCents: 90, remittancePeriod: '2026-09' },
      // 2455 × 5 % = 122,75 → 123 ; × 9,975 % = 244,89 → 245 ; frais : 137 − 123 = 14, 274 − 245 = 29.
      taxes: { rideId: 'r1', driverId: 'd1', period: '2026-09', fareGstCents: 123, fareQstCents: 245, feeGstCents: 14, feeQstCents: 29 },
    });
  });
  it('promotion : taxes du chauffeur sur son tarif complet, part des frais jamais négative', () => {
    const entries = ledgerEntriesForRide(ride({ promotionCompensationCents: 737, gstCents: 100, qstCents: 200 }), settings);
    expect(entries.taxes).toMatchObject({ fareGstCents: 123, fareQstCents: 245, feeGstCents: 14, feeQstCents: 29 });
    const tiny = ledgerEntriesForRide(ride({ promotionCompensationCents: 737, gstCents: 10, qstCents: 20 }), settings);
    expect(tiny.taxes).toMatchObject({ feeGstCents: 0, feeQstCents: 0 });
  });
  it('course offerte : la redevance reste due au montant en vigueur, aucune taxe perçue sur les frais', () => {
    const entries = ledgerEntriesForRide(ride({ promotionCompensationCents: 2455, regulatoryFeeCents: 0, gstCents: 0, qstCents: 0 }), settings);
    expect(entries.redevance.amountCents).toBe(90);
    expect(entries.taxes).toMatchObject({ fareGstCents: 123, fareQstCents: 245, feeGstCents: 0, feeQstCents: 0 });
    expect(ledgerEntriesForRide(ride({ regulatoryFeeCents: null }), settings).redevance.amountCents).toBe(90);
  });
  it('période : mois de la fin de course à Montréal', () => {
    expect(ledgerEntriesForRide(ride({ completedAt: new Date('2026-10-01T02:00:00Z') }), settings).redevance.remittancePeriod).toBe('2026-09');
  });
  it('redevance due : montant facturé, sinon montant par course', () => {
    expect(redevanceDueCents(95, 90)).toBe(95);
    expect(redevanceDueCents(0, 90)).toBe(90);
    expect(redevanceDueCents(null, 90)).toBe(90);
  });
});

describe('rapport trimestriel du chauffeur', () => {
  it('un total par mois (mois sans course à zéro) et le total du trimestre', () => {
    const period = parseLedgerPeriod('2026-T3')!;
    const report = driverTaxReport(period, [
      { month: '2026-07', rideCount: 2, fareCents: 5000, gstCents: 250, qstCents: 499 },
      { month: '2026-09', rideCount: 1, fareCents: 2455, gstCents: 123, qstCents: 245 },
      { month: '2026-09', rideCount: 1, fareCents: 1000, gstCents: 50, qstCents: 100 },
    ]);
    expect(report.months).toEqual([
      { month: '2026-07', rideCount: 2, fareCents: 5000, gstCents: 250, qstCents: 499 },
      { month: '2026-08', rideCount: 0, fareCents: 0, gstCents: 0, qstCents: 0 },
      { month: '2026-09', rideCount: 2, fareCents: 3455, gstCents: 173, qstCents: 345 },
    ]);
    expect(report.totals).toEqual({ rideCount: 4, fareCents: 8455, gstCents: 423, qstCents: 844 });
  });
});

describe('schémas des registres', () => {
  it('export : type et période (mois ou trimestre)', () => {
    expect(ledgerExportQuerySchema.parse({ type: 'taxes', period: '2026-T3' })).toEqual({ type: 'taxes', period: '2026-T3' });
    expect(ledgerExportQuerySchema.safeParse({ type: 'redevance', period: '2026-13' }).success).toBe(false);
    expect(ledgerExportQuerySchema.safeParse({ type: 'tps', period: '2026-09' }).success).toBe(false);
  });
  it('remise : un mois seulement, référence facultative', () => {
    expect(redevanceRemitSchema.safeParse({ period: '2026-T3' }).success).toBe(false);
    expect(redevanceRemitSchema.parse({ period: '2026-08', reference: ' RQ-123 ' })).toEqual({ period: '2026-08', reference: 'RQ-123' });
    expect(driverTaxReportQuerySchema.safeParse({ quarter: '2026-09' }).success).toBe(false);
  });
});
