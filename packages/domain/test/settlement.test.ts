import { describe, expect, it } from 'vitest';
import {
  buildStatement, classifyRideForStatement, computeQuote, evaluateSuspension, isCredit, isInPeriod, localDate,
  packBillingLines, periodForGeneration, splitTaxes,
  type PricingRules, type SettlementRide, type StatementLine, type StatementPeriod, type TaxRates,
} from '../src/index.js';

const rates: TaxRates = { gstRatePpm: 50_000, qstRatePpm: 99_750 };
const TZ = 'America/Toronto';
const period: StatementPeriod = { startDate: '2026-09-14', endDate: '2026-09-20', timeZone: TZ };
const at = (iso: string): Date => new Date(iso);
const ride = (over: Partial<SettlementRide> = {}): SettlementRide => ({
  id: 'r1', status: 'completed', completedAt: at('2026-09-15T14:00:00Z'), paymentChannel: 'platform',
  fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274,
  tipCents: 0, tipChannel: 'platform', promotionCompensationCents: 0, tollCents: 0, cancellationFeeCents: 0, ...over,
});
const amounts = (lines: StatementLine[]): Array<[string, number]> => lines.map((l) => [l.kind, l.amountCents]);

describe('classification d\'une course', () => {
  it('carte via la plateforme : tarif, taxes du tarif et pourboire crédités', () => {
    expect(amounts(classifyRideForStatement(ride({ tipCents: 400 }), rates))).toEqual([['ride_fare_platform', 2455], ['fare_taxes_platform', 368], ['tip_platform', 400]]);
  });
  it('les taxes sur le tarif reviennent au chauffeur, celles sur les frais restent à Neomoov', () => {
    expect(splitTaxes(ride(), rates)).toEqual({ fareTaxesCents: 368, feeTaxesCents: 43 });
  });
  it('espèces ou Interac : frais de service, redevance et leurs taxes débités, tarif non crédité', () => {
    expect(amounts(classifyRideForStatement(ride({ paymentChannel: 'direct', tipChannel: 'direct', tipCents: 500 }), rates))).toEqual([['service_fee_direct', 200], ['regulatory_fee_direct', 90], ['fee_taxes_direct', 43]]);
  });
  it('paiement direct avec pourboire via la plateforme et promotion : pourboire et compensation crédités', () => {
    // Le client a payé en espèces le tarif réduit (1718) plus 290 de frais et 300 de taxes.
    const lines = classifyRideForStatement(ride({ paymentChannel: 'direct', tipCents: 300, promotionCompensationCents: 737, gstCents: 100, qstCents: 200 }), rates);
    expect(amounts(lines)).toEqual([['service_fee_direct', 200], ['regulatory_fee_direct', 90], ['fee_taxes_direct', 43], ['tip_platform', 300], ['promotion_compensation', 737]]);
  });
  it('péage remboursé sur une course via la plateforme', () => {
    expect(amounts(classifyRideForStatement(ride({ tollCents: 980 }), rates))).toContainEqual(['toll_reimbursement', 980]);
  });
  it('promotion de 30 % via la plateforme : le client a payé le tarif réduit, le chauffeur reçoit tout, taxes sur le tarif complet', () => {
    // Tarif 2455, remise 737 : le client a payé 1718 + 290 de frais, taxes 100 + 200.
    const r = ride({ gstCents: 100, qstCents: 200, promotionCompensationCents: 737 });
    expect(amounts(classifyRideForStatement(r, rates))).toEqual([['ride_fare_platform', 1718], ['fare_taxes_platform', 368], ['promotion_compensation', 737]]);
    // Taxes perçues 300, dont 257 sur le tarif réduit : 43 sur les frais.
    expect(splitTaxes(r, rates)).toEqual({ fareTaxesCents: 368, feeTaxesCents: 43 });
  });
  it('course offerte avec renonciation aux frais : rien payé par le client, tarif complet et ses taxes au chauffeur', () => {
    const lines = classifyRideForStatement(ride({ fareCents: 2858, serviceFeeCents: 0, regulatoryFeeCents: 0, gstCents: 0, qstCents: 0, promotionCompensationCents: 2858 }), rates);
    expect(amounts(lines)).toEqual([['fare_taxes_platform', 428], ['promotion_compensation', 2858]]);
  });
  it('les taxes sur les frais ne deviennent jamais négatives', () => {
    expect(splitTaxes(ride({ gstCents: 0, qstCents: 0, promotionCompensationCents: 0 }), rates).feeTaxesCents).toBe(0);
  });
  it('annulation ou non-présentation : frais d\'annulation crédités si perçus via la plateforme, sinon rien', () => {
    expect(amounts(classifyRideForStatement(ride({ status: 'cancelled', cancellationFeeCents: 600 }), rates))).toEqual([['cancellation_fee_platform', 600]]);
    expect(classifyRideForStatement(ride({ status: 'no_show', cancellationFeeCents: 600, paymentChannel: 'direct' }), rates)).toEqual([]);
    expect(classifyRideForStatement(ride({ status: 'cancelled' }), rates)).toEqual([]);
  });
  it('les lignes portent la course et sa date', () => {
    expect(classifyRideForStatement(ride(), rates)[0]).toMatchObject({ rideId: 'r1', occurredAt: at('2026-09-15T14:00:00Z'), label: 'Tarif de la course' });
  });
  it('cohérence avec le moteur de tarification : taxes réparties sans reste', () => {
    const rules: PricingRules = { timeZone: TZ, categories: [{ category: 'c', baseFareCents: 375, perKmCents: 170, perMinuteCents: 40, minimumFareCents: 950 }], surcharges: { nightCents: 200, nightStartHour: 23, nightEndHour: 5, airportCents: 300, childSeatCents: 300, bulkyLuggageCents: 200, perStopCents: 200, favouriteDriverCents: 300 }, flexMultiplierBps: 9000, priorityMultiplierBps: 12_500, peakWindows: [], flatRates: [], serviceFeeCents: 200, regulatoryFeeCents: 90, gstRatePpm: 50_000, qstRatePpm: 99_750, maxExtraAllowanceCents: 2000, waitFreeSeconds: 300, waitPerMinuteCents: 50 };
    for (let m = 500; m < 40_000; m += 731) {
      const q = computeQuote({ category: 'c', distanceMeters: m, durationSeconds: m / 9, pickupAt: at('2026-09-15T14:00:00Z') }, rules);
      const r = ride({ fareCents: q.fareCents, serviceFeeCents: q.serviceFeeCents, regulatoryFeeCents: q.regulatoryFeeCents, gstCents: q.gstCents, qstCents: q.qstCents });
      const { fareTaxesCents, feeTaxesCents } = splitTaxes(r, rates);
      // Sans promotion, la répartition tombe juste : l'écart d'arrondi ne dépasse jamais un cent.
      expect(Math.abs(fareTaxesCents + feeTaxesCents - (q.gstCents + q.qstCents))).toBeLessThanOrEqual(1);
      expect(feeTaxesCents).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('facturation des packs', () => {
  it('prix et taxes, jamais d\'avance : à la date d\'activation, sur le relevé qui suit', () => {
    expect(packBillingLines('pp1', 16_900, at('2026-09-14T16:30:00Z'), rates, 'Pack Élite')).toEqual([
      { kind: 'pack_billed', amountCents: 16_900, packPurchaseId: 'pp1', occurredAt: at('2026-09-14T16:30:00Z'), label: 'Pack Élite' },
      { kind: 'pack_taxes', amountCents: 2531, packPurchaseId: 'pp1', occurredAt: at('2026-09-14T16:30:00Z'), label: 'TPS et TVQ sur le pack' },
    ]);
  });
  it('un pack offert ne produit aucune ligne', () => {
    expect(packBillingLines('pp2', 0, at('2026-09-14T16:30:00Z'), rates, 'Pack Découverte')).toEqual([]);
  });
});

describe('construction du relevé', () => {
  it('net = crédits − débits, versement si positif', () => {
    const lines = [...classifyRideForStatement(ride({ tipCents: 400 }), rates), ...packBillingLines('pp1', 9900, at('2026-09-14T16:30:00Z'), rates, 'Pack Pro')];
    const s = buildStatement('d1', period, lines);
    expect(s).toMatchObject({ creditsCents: 3223, debitsCents: 11_383, netCents: -8160, payoutCents: 0, chargeCents: 8160 });
    expect(s.totalsByKind).toEqual({ pack_billed: 9900, pack_taxes: 1483, ride_fare_platform: 2455, fare_taxes_platform: 368, tip_platform: 400 });
  });
  it('le journal est trié par date', () => {
    const later: StatementLine = { kind: 'bonus', amountCents: 1000, occurredAt: at('2026-09-19T10:00:00Z') };
    const earlier: StatementLine = { kind: 'adjustment_negative', amountCents: 250, occurredAt: at('2026-09-14T10:00:00Z') };
    const s = buildStatement('d1', period, [later, earlier]);
    expect(s.lines.map((l) => l.kind)).toEqual(['adjustment_negative', 'bonus']);
    expect(s).toMatchObject({ netCents: 750, payoutCents: 750, chargeCents: 0 });
  });
  it('relevé vide : net nul', () => {
    expect(buildStatement('d1', period, [])).toMatchObject({ creditsCents: 0, debitsCents: 0, netCents: 0, payoutCents: 0, chargeCents: 0, totalsByKind: {} });
  });
  it.each([[-1], [10.5]])('une ligne à %s cents est refusée', (amountCents) => {
    expect(() => buildStatement('d1', period, [{ kind: 'bonus', amountCents, occurredAt: at('2026-09-15T10:00:00Z') }])).toThrow(RangeError);
  });
  it('chaque sorte de ligne est un crédit ou un débit', () => {
    expect(['ride_fare_platform', 'fare_taxes_platform', 'tip_platform', 'promotion_compensation', 'bonus', 'referral_credit', 'cancellation_fee_platform', 'toll_reimbursement', 'adjustment_positive'].every((k) => isCredit(k as never))).toBe(true);
    expect(['pack_billed', 'pack_taxes', 'service_fee_direct', 'regulatory_fee_direct', 'fee_taxes_direct', 'cancellation_fee_due', 'adjustment_negative'].some((k) => isCredit(k as never))).toBe(false);
  });
});

describe('jeu de 200 courses mixtes, total calculé indépendamment', () => {
  // Générateur déterministe : le test recalcule le net par une autre voie que le moteur.
  let seed = 20_260_922;
  const rand = (): number => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const rides: SettlementRide[] = [];
  for (let i = 0; i < 200; i += 1) {
    const status = pick(['completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'cancelled', 'no_show'] as const);
    const fare = 950 + Math.floor(rand() * 6000);
    const promo = rand() < 0.15 ? Math.floor(fare * 0.3) : 0;
    const sub = fare - promo + 290;
    rides.push({
      id: `r${i}`, status, completedAt: at(`2026-09-${String(14 + (i % 7)).padStart(2, '0')}T${String(6 + (i % 16)).padStart(2, '0')}:00:00Z`),
      paymentChannel: pick(['platform', 'platform', 'platform', 'direct']), fareCents: fare, serviceFeeCents: 200, regulatoryFeeCents: 90,
      gstCents: Math.round(sub * 0.05), qstCents: Math.round(sub * 0.09975), tipCents: rand() < 0.4 ? Math.floor(rand() * 800) : 0,
      tipChannel: pick(['platform', 'platform', 'direct']), promotionCompensationCents: promo, tollCents: rand() < 0.05 ? 980 : 0,
      cancellationFeeCents: status === 'completed' ? 0 : 600,
    });
  }
  const lines = [...rides.flatMap((r) => classifyRideForStatement(r, rates)), ...packBillingLines('pp', 16_900, at('2026-09-14T09:00:00Z'), rates, 'Pack Élite')];
  const statement = buildStatement('d1', period, lines);
  it('le net du moteur égale le net recalculé à la main', () => {
    let expected = -(16_900 + Math.round(16_900 * 0.05) + Math.round(16_900 * 0.09975));
    for (const r of rides) {
      if (r.status !== 'completed') { if (r.paymentChannel === 'platform') expected += r.cancellationFeeCents; continue; }
      const fullFareTaxes = Math.round(r.fareCents * 0.05) + Math.round(r.fareCents * 0.09975);
      const collected = r.fareCents - r.promotionCompensationCents;
      const collectedFareTaxes = Math.round(collected * 0.05) + Math.round(collected * 0.09975);
      if (r.paymentChannel === 'platform') expected += collected + fullFareTaxes + r.tollCents;
      else expected -= 200 + 90 + Math.max(0, r.gstCents + r.qstCents - collectedFareTaxes);
      if (r.tipChannel === 'platform') expected += r.tipCents;
      expected += r.promotionCompensationCents;
    }
    expect(statement.netCents).toBe(expected);
    expect(statement.creditsCents - statement.debitsCents).toBe(statement.netCents);
    expect(statement.lines.length).toBeGreaterThan(200);
  });
  it('les totaux par sorte se recoupent avec les crédits et les débits', () => {
    const credits = Object.entries(statement.totalsByKind).filter(([k]) => isCredit(k as never)).reduce((s, [, v]) => s + v, 0);
    const debits = Object.entries(statement.totalsByKind).filter(([k]) => !isCredit(k as never)).reduce((s, [, v]) => s + v, 0);
    expect(credits).toBe(statement.creditsCents);
    expect(debits).toBe(statement.debitsCents);
  });
});

describe('période et calendrier', () => {
  it('générée le vendredi 25 septembre à 6 h : semaine du 14 au 20 septembre', () => {
    expect(periodForGeneration(at('2026-09-25T10:00:00Z'), TZ)).toEqual(period);
  });
  it.each([
    ['lundi 21 septembre à 0 h 30, heure de Montréal', '2026-09-21T04:30:00Z', '2026-09-14', '2026-09-20'],
    ['dimanche 20 septembre à 23 h 30', '2026-09-21T03:30:00Z', '2026-09-07', '2026-09-13'],
    ['un vendredi de janvier, heure normale', '2026-01-16T11:00:00Z', '2026-01-05', '2026-01-11'],
    ['passage d\'année', '2026-01-02T11:00:00Z', '2025-12-22', '2025-12-28'],
  ])('%s', (_label, iso, start, end) => {
    expect(periodForGeneration(at(iso), TZ)).toEqual({ startDate: start, endDate: end, timeZone: TZ });
  });
  it('isInPeriod respecte les bornes locales, minuit à Montréal et non UTC', () => {
    expect(isInPeriod(at('2026-09-14T03:59:00Z'), period)).toBe(false);
    expect(isInPeriod(at('2026-09-14T04:00:00Z'), period)).toBe(true);
    expect(isInPeriod(at('2026-09-21T03:59:00Z'), period)).toBe(true);
    expect(isInPeriod(at('2026-09-21T04:00:00Z'), period)).toBe(false);
  });
  it('localDate : dimanche vaut 0', () => {
    expect(localDate(at('2026-09-20T16:00:00Z'), TZ)).toEqual({ date: '2026-09-20', weekday: 0 });
  });
});

describe('suspension pour solde', () => {
  const settings = { negativeBalanceThresholdCents: 15_000, unpaidGraceDays: 7 };
  const now = at('2026-09-29T10:00:00Z');
  it('solde positif ou nul : rien', () => {
    expect(evaluateSuspension({ balanceCents: 0, unpaidSince: null }, now, settings)).toEqual({ suspend: false, reason: null });
    expect(evaluateSuspension({ balanceCents: 5000, unpaidSince: at('2026-09-01T00:00:00Z') }, now, settings)).toEqual({ suspend: false, reason: null });
  });
  it('au-delà de 150 $ : suspension, à 150 $ exactement : non', () => {
    expect(evaluateSuspension({ balanceCents: -15_001, unpaidSince: null }, now, settings)).toEqual({ suspend: true, reason: 'threshold' });
    expect(evaluateSuspension({ balanceCents: -15_000, unpaidSince: null }, now, settings)).toEqual({ suspend: false, reason: null });
  });
  it('impayé depuis plus de 7 jours : suspension', () => {
    expect(evaluateSuspension({ balanceCents: -5000, unpaidSince: at('2026-09-21T10:00:00Z') }, now, settings)).toEqual({ suspend: true, reason: 'overdue' });
    expect(evaluateSuspension({ balanceCents: -5000, unpaidSince: at('2026-09-22T10:00:00Z') }, now, settings)).toEqual({ suspend: false, reason: null });
  });
});
