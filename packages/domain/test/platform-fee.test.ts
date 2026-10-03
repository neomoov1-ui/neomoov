import { describe, expect, it } from 'vitest';
import {
  buildStatement, classifyRideForStatement, computePlatformFee, formatPlatformFeeRate, isValidPlatformFeeBps, packPriorityTier, platformFeeBpsOrDefault,
  platformFeeLabel, scoreCandidates, splitByPackPriority, PLATFORM_FEE_DEFAULT_BPS, PLATFORM_FEE_MAX_BPS, PLATFORM_FEE_MIN_BPS,
  type DispatchCandidate, type SettlementRide, type StatementLine, type TaxRates,
} from '../src/index.js';

/** Redevance Neomoov (décision du fondateur du 3 octobre 2026) et priorité des chauffeurs avec pack. */

const rates: TaxRates = { gstRatePpm: 50_000, qstRatePpm: 99_750 };
const ride = (over: Partial<SettlementRide> = {}): SettlementRide => ({
  id: 'r1', status: 'completed', completedAt: new Date('2026-10-05T14:00:00Z'), paymentChannel: 'platform',
  fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274,
  tipCents: 0, tipChannel: 'platform', promotionCompensationCents: 0, tollCents: 0, cancellationFeeCents: 0, ...over,
});
const amounts = (lines: StatementLine[]): Array<[string, number]> => lines.map((l) => [l.kind, l.amountCents]);

describe('redevance Neomoov : bornes du taux', () => {
  it('bornes de 5 % à 10 %, 10 % par défaut', () => {
    expect([PLATFORM_FEE_MIN_BPS, PLATFORM_FEE_MAX_BPS, PLATFORM_FEE_DEFAULT_BPS]).toEqual([500, 1000, 1000]);
  });
  it('un taux valide est un entier de 500 à 1000 inclus', () => {
    expect([500, 750, 1000].every(isValidPlatformFeeBps)).toBe(true);
    expect([499, 1001, 0, -500, 750.5, Number.NaN, '1000', null, undefined].some(isValidPlatformFeeBps)).toBe(false);
  });
  it('réglage global : valeur valide gardée, sinon le repli, sinon 10 %', () => {
    expect(platformFeeBpsOrDefault(800)).toBe(800);
    expect(platformFeeBpsOrDefault(1200)).toBe(1000);
    expect(platformFeeBpsOrDefault('900', 600)).toBe(600);
    expect(platformFeeBpsOrDefault(undefined, 2000)).toBe(1000);
  });
});

describe('redevance Neomoov : calcul', () => {
  it('10 % du tarif du chauffeur, arrondi au cent', () => {
    expect(computePlatformFee({ fareCents: 2455, rateBps: 1000 })).toEqual({ baseCents: 2455, rateBps: 1000, amountCents: 246 });
  });
  it('demi-cent arrondi vers le haut, sinon au plus proche', () => {
    expect(computePlatformFee({ fareCents: 2450, rateBps: 500 }).amountCents).toBe(123); // 122,5
    expect(computePlatformFee({ fareCents: 2449, rateBps: 500 }).amountCents).toBe(122); // 122,45
    expect(computePlatformFee({ fareCents: 1999, rateBps: 750 }).amountCents).toBe(150); // 149,925
  });
  it('tarif nul : redevance nulle', () => {
    expect(computePlatformFee({ fareCents: 0, rateBps: 1000 }).amountCents).toBe(0);
  });
  it('taux hors bornes ou tarif invalide : erreur, jamais un montant faux', () => {
    expect(() => computePlatformFee({ fareCents: 1000, rateBps: 499 })).toThrow(RangeError);
    expect(() => computePlatformFee({ fareCents: 1000, rateBps: 1001 })).toThrow(RangeError);
    expect(() => computePlatformFee({ fareCents: -1, rateBps: 1000 })).toThrow(RangeError);
    expect(() => computePlatformFee({ fareCents: 10.5, rateBps: 1000 })).toThrow(RangeError);
  });
  it('libellé français du taux', () => {
    expect([1000, 500, 750, 825, 505].map(formatPlatformFeeRate)).toEqual(['10 %', '5 %', '7,5 %', '8,25 %', '5,05 %']);
    expect(platformFeeLabel(750)).toBe('Redevance Neomoov (7,5 %)');
  });
});

describe('redevance Neomoov au relevé', () => {
  const fee = { amountCents: 246, rateBps: 1000 };
  it('payée par carte : retenue sur ce qui est versé au chauffeur', () => {
    const lines = classifyRideForStatement(ride({ platformFee: fee }), rates);
    expect(amounts(lines)).toEqual([['ride_fare_platform', 2455], ['fare_taxes_platform', 368], ['platform_fee', 246]]);
    expect(lines.at(-1)!.label).toBe('Redevance Neomoov (10 %)');
    const statement = buildStatement('d1', { startDate: '2026-10-05', endDate: '2026-10-11', timeZone: 'America/Toronto' }, lines);
    expect(statement).toMatchObject({ creditsCents: 2823, debitsCents: 246, netCents: 2577, payoutCents: 2577, chargeCents: 0 });
  });
  it('payée directement au chauffeur : ajoutée à ce qu\'il doit', () => {
    const lines = classifyRideForStatement(ride({ paymentChannel: 'direct', platformFee: fee }), rates);
    expect(amounts(lines)).toEqual([['service_fee_direct', 200], ['regulatory_fee_direct', 90], ['fee_taxes_direct', 43], ['platform_fee', 246]]);
    const statement = buildStatement('d1', { startDate: '2026-10-05', endDate: '2026-10-11', timeZone: 'America/Toronto' }, lines);
    expect(statement).toMatchObject({ netCents: -579, payoutCents: 0, chargeCents: 579 });
  });
  it('pas de redevance enregistrée (course antérieure) ou nulle : aucune ligne', () => {
    expect(amounts(classifyRideForStatement(ride({ platformFee: null }), rates)).map(([k]) => k)).not.toContain('platform_fee');
    expect(amounts(classifyRideForStatement(ride({ platformFee: { amountCents: 0, rateBps: 1000 } }), rates)).map(([k]) => k)).not.toContain('platform_fee');
  });
  it('annulation avec frais : jamais de redevance Neomoov', () => {
    expect(amounts(classifyRideForStatement(ride({ status: 'cancelled', cancellationFeeCents: 500, platformFee: fee }), rates))).toEqual([['cancellation_fee_platform', 500]]);
  });
});

describe('répartition : chauffeurs avec pack d\'abord', () => {
  const base: DispatchCandidate = { driverId: 'a', etaSeconds: 600, distanceMeters: 3000, rating: 4.5, idleMinutes: 30, zoneImbalance: 0, isRequestedFavourite: false, isClientFavourite: false, isUnlimited: false };
  const context = { premiumContext: false, fallbackSpeedMps: 8 };

  it('rang : sans pack après, sauf le favori demandé ; absent vaut avec pack', () => {
    expect(packPriorityTier({ hasActivePack: true, isRequestedFavourite: false })).toBe(0);
    expect(packPriorityTier({ isRequestedFavourite: false })).toBe(0);
    expect(packPriorityTier({ hasActivePack: false, isRequestedFavourite: false })).toBe(1);
    expect(packPriorityTier({ hasActivePack: false, isRequestedFavourite: true })).toBe(0);
  });
  it('un chauffeur sans pack plus proche passe après un chauffeur avec pack plus loin, sans être exclu', () => {
    const near = { ...base, driverId: 'sans-pack', etaSeconds: 60, hasActivePack: false };
    const far = { ...base, driverId: 'avec-pack', etaSeconds: 900, hasActivePack: true };
    expect(scoreCandidates([near, far], context).map((c) => c.driverId)).toEqual(['avec-pack', 'sans-pack']);
  });
  it('dans chaque groupe, le score décide comme avant', () => {
    const list = [
      { ...base, driverId: 'p2', etaSeconds: 600, hasActivePack: true },
      { ...base, driverId: 'n1', etaSeconds: 120, hasActivePack: false },
      { ...base, driverId: 'p1', etaSeconds: 300, hasActivePack: true },
      { ...base, driverId: 'n2', etaSeconds: 400, hasActivePack: false },
    ];
    expect(scoreCandidates(list, context).map((c) => c.driverId)).toEqual(['p1', 'p2', 'n1', 'n2']);
  });
  it('séparation en deux groupes, ordre conservé', () => {
    const list = [{ driverId: 'x', hasActivePack: false, isRequestedFavourite: false }, { driverId: 'y', hasActivePack: true, isRequestedFavourite: false }, { driverId: 'z', hasActivePack: false, isRequestedFavourite: true }];
    const { first, later } = splitByPackPriority(list);
    expect(first.map((c) => c.driverId)).toEqual(['y', 'z']);
    expect(later.map((c) => c.driverId)).toEqual(['x']);
  });
});
