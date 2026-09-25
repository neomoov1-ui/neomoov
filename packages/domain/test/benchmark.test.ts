import { describe, expect, it } from 'vitest';
import {
  benchmarkCheck, benchmarkTimeWindow, computeQuote, findBenchmark, PricingError, referenceOf, subtotalForTotalAtMost,
  type CompetitorBenchmark, type PricingRules, type QuoteInput,
} from '../src/index.js';

const rules: PricingRules = {
  timeZone: 'America/Toronto',
  categories: [
    { category: 'neo_premium', baseFareCents: 375, perKmCents: 170, perMinuteCents: 40, minimumFareCents: 950 },
    { category: 'neo_prestige', baseFareCents: 475, perKmCents: 210, perMinuteCents: 50, minimumFareCents: 1200 },
  ],
  surcharges: { nightCents: 200, nightStartHour: 23, nightEndHour: 5, airportCents: 300, childSeatCents: 300, bulkyLuggageCents: 200, perStopCents: 200, favouriteDriverCents: 300 },
  flexMultiplierBps: 9000,
  priorityMultiplierBps: 12500,
  peakWindows: [],
  flatRates: [{ originZone: 'centre-ville', destinationZone: 'yul', bidirectional: true, totalCentsByCategory: { neo_premium: 5500 } }],
  serviceFeeCents: 200, regulatoryFeeCents: 90, gstRatePpm: 50_000, qstRatePpm: 99_750,
  maxExtraAllowanceCents: 2000, waitFreeSeconds: 300, waitPerMinuteCents: 50,
};

const DAY = new Date('2026-09-22T14:00:00Z'); // mardi 10 h à Montréal : weekday_day
const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({ category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, pickupAt: DAY, ...over });
const code = (fn: () => unknown): string => { try { fn(); } catch (e) { return (e as PricingError).code; } return 'AUCUNE_ERREUR'; };

describe('péages (D33)', () => {
  it('ajoute une ligne « tolls » au prix affiché, jamais au tarif chauffeur', () => {
    const q = computeQuote(base({ tollsCents: 350 }), rules);
    expect(q.tollsCents).toBe(350);
    expect(q.fareCents).toBe(2455);
    expect(q.driverAmountCents).toBe(2455);
    expect(q.lines.find((l) => l.kind === 'tolls')).toEqual({ kind: 'tolls', code: 'tolls', amountCents: 350 });
    expect(q.subtotalCents).toBe(2745 + 350);
    expect(q.totalCents).toBe(3095 + 155 + 309);
    expect(q.alignmentDiscountCents).toBe(0);
  });
  it('sans péage, ni ligne ni montant ; un forfait tout compris les ignore', () => {
    expect(computeQuote(base(), rules).lines.some((l) => l.kind === 'tolls')).toBe(false);
    const flat = computeQuote(base({ originZone: 'centre-ville', destinationZone: 'yul', tollsCents: 500 }), rules);
    expect(flat.flatRate).toBe(true);
    expect(flat.tollsCents).toBe(0);
    expect(flat.totalCents).toBe(5500);
  });
  it('refuse un péage négatif ou non numérique', () => {
    expect(code(() => computeQuote(base({ tollsCents: -1 }), rules))).toBe('INVALID_INPUT');
    expect(code(() => computeQuote(base({ tollsCents: Number.NaN }), rules))).toBe('INVALID_INPUT');
  });
});

describe("plafond de remise d'une promotion", () => {
  it('LANCEMENT30 : 30 % plafonné à 15,00 $', () => {
    const promo = { code: 'LANCEMENT30', kind: 'percent' as const, percentBps: 3000, maxDiscountCents: 1500 };
    expect(computeQuote(base({ promotion: promo }), rules).promotionDiscountCents).toBe(737);
    expect(computeQuote(base({ promotion: promo, distanceMeters: 40_000, durationSeconds: 2400 }), rules).promotionDiscountCents).toBe(1500);
  });
});

describe('plages horaires des relevés', () => {
  it.each([
    ['2026-09-22T11:00:00Z', 'weekday_morning'], // mardi 7 h
    ['2026-09-22T14:00:00Z', 'weekday_day'], // mardi 10 h
    ['2026-09-22T20:00:00Z', 'weekday_evening'], // mardi 16 h
    ['2026-09-23T02:00:00Z', 'weekday_night'], // mardi 22 h
    ['2026-09-26T16:00:00Z', 'weekend_day'], // samedi 12 h
    ['2026-09-27T03:00:00Z', 'weekend_night'], // samedi 23 h
  ])('%s → %s', (iso, expected) => {
    expect(benchmarkTimeWindow(new Date(iso), 'America/Toronto')).toBe(expected);
  });
});

const NOW = new Date('2026-09-22T15:00:00Z');
const bench = (over: Partial<CompetitorBenchmark> = {}): CompetitorBenchmark => ({
  category: 'neo_premium', originZone: 'plateau', destinationZone: 'yul', timeWindow: 'weekday_day', uberPriceCents: 3000, lyftPriceCents: 3200, observedAt: new Date('2026-09-20T15:00:00Z'), ...over,
});
const context = { originZone: 'plateau', destinationZone: 'yul', pickupAt: DAY, now: NOW, timeZone: 'America/Toronto', marginPpm: 50_000 };

describe('recherche de la référence concurrente', () => {
  it('retient le concurrent le moins cher, ignore les prix absents ou nuls', () => {
    expect(referenceOf(bench())).toBe(3000);
    expect(referenceOf(bench({ uberPriceCents: null }))).toBe(3200);
    expect(referenceOf(bench({ uberPriceCents: 0, lyftPriceCents: null }))).toBeNull();
  });
  it('exige les deux zones, la catégorie et la plage horaire ; accepte le sens inverse', () => {
    const q = { category: 'neo_premium' };
    expect(findBenchmark([bench()], q, { ...context, originZone: null })).toBeNull();
    expect(findBenchmark([bench({ category: 'neo_prestige' })], q, context)).toBeNull();
    expect(findBenchmark([bench({ timeWindow: 'weekend_day' })], q, context)).toBeNull();
    expect(findBenchmark([bench({ originZone: 'yul', destinationZone: 'plateau' })], q, context)).not.toBeNull();
    expect(findBenchmark([bench({ originZone: 'yul', destinationZone: 'centre-ville' })], q, context)).toBeNull();
  });
  it('ignore les relevés périmés, futurs ou sans prix, et choisit le plus récent', () => {
    const q = { category: 'neo_premium' };
    expect(findBenchmark([bench({ observedAt: new Date('2026-09-01T15:00:00Z') })], q, context)).toBeNull();
    expect(findBenchmark([bench({ observedAt: new Date('2026-09-01T15:00:00Z') })], q, { ...context, maxAgeDays: 30 })).not.toBeNull();
    expect(findBenchmark([bench({ observedAt: new Date('2026-09-23T15:00:00Z') })], q, context)).toBeNull();
    expect(findBenchmark([bench({ uberPriceCents: null, lyftPriceCents: null })], q, context)).toBeNull();
    const older = bench({ observedAt: new Date('2026-09-15T15:00:00Z'), uberPriceCents: 2000 });
    const newer = bench({ observedAt: new Date('2026-09-21T15:00:00Z'), uberPriceCents: 2900 });
    expect(findBenchmark([older, newer], q, context)).toBe(newer);
    expect(findBenchmark([newer, older], q, context)).toBe(newer);
  });
});

describe('remise d\'alignement (D33)', () => {
  it('sans référence, le devis est inchangé', () => {
    const q = computeQuote(base(), rules);
    const r = benchmarkCheck(q, [], rules, context);
    expect(r).toEqual({ quote: q, referenceCents: null, exceeded: false });
  });
  it('sous le seuil, aucun ajustement mais la référence est renvoyée', () => {
    const q = computeQuote(base(), rules); // 31,56 $
    const r = benchmarkCheck(q, [bench({ uberPriceCents: 3400, lyftPriceCents: null })], rules, context); // seuil 32,30 $
    expect(r.exceeded).toBe(false);
    expect(r.referenceCents).toBe(3400);
    expect(r.quote).toBe(q);
  });
  it('au-dessus du seuil, réduit les frais de service jusqu\'à 0 et jamais le tarif chauffeur', () => {
    const q = computeQuote(base(), rules); // 31,56 $, frais 2,00 $
    const r = benchmarkCheck(q, [bench({ uberPriceCents: 2500, lyftPriceCents: null })], rules, context); // seuil 23,75 $, hors d'atteinte
    expect(r.exceeded).toBe(true);
    expect(r.referenceCents).toBe(2500);
    expect(r.quote.serviceFeeCents).toBe(0);
    expect(r.quote.alignmentDiscountCents).toBe(200);
    expect(r.quote.fareCents).toBe(2455);
    expect(r.quote.driverAmountCents).toBe(2455);
    expect(r.quote.subtotalCents).toBe(2545);
    expect(r.quote.totalCents).toBe(2545 + 127 + 254);
    expect(r.quote.maxConsentedCents).toBe(r.quote.totalCents + 2000);
    expect(r.quote.amountDueCents).toBe(r.quote.totalCents);
    expect(r.quote.lines.at(-1)).toEqual({ kind: 'benchmark_alignment', code: 'benchmark_alignment', amountCents: -200 });
  });
  it('remise partielle : juste ce qu\'il faut pour passer sous le seuil', () => {
    const q = computeQuote(base(), rules); // 31,56 $
    const r = benchmarkCheck(q, [bench({ uberPriceCents: 3250, lyftPriceCents: 3300 })], rules, context); // seuil 30,88 $
    expect(r.exceeded).toBe(true);
    expect(r.quote.totalCents).toBeLessThanOrEqual(3088);
    expect(r.quote.alignmentDiscountCents).toBeGreaterThan(0);
    expect(r.quote.alignmentDiscountCents).toBeLessThan(200);
    expect(r.quote.serviceFeeCents).toBe(200 - r.quote.alignmentDiscountCents);
    expect(r.quote.subtotalCents).toBe(subtotalForTotalAtMost(3088, rules));
  });
  it('frais de service déjà à 0 (course offerte) : dépassement signalé, devis inchangé', () => {
    const q = computeQuote(base({ promotion: { code: 'BIENVENUE3', kind: 'free_ride', nthRide: 3, waivesFees: true }, clientCompletedRides: 2 }), rules);
    expect(q.serviceFeeCents).toBe(0);
    const r = benchmarkCheck({ ...q, totalCents: 500, subtotalCents: 435 }, [bench({ uberPriceCents: 100, lyftPriceCents: null })], rules, context);
    expect(r.exceeded).toBe(true);
    expect(r.quote.alignmentDiscountCents).toBe(0);
    expect(r.quote.lines.some((l) => l.kind === 'benchmark_alignment')).toBe(false);
  });
  it('les crédits appliqués ne dépassent jamais le nouveau total', () => {
    const q = computeQuote(base({ creditsAvailableCents: 3150 }), rules); // total 3156, crédits 3150
    const r = benchmarkCheck(q, [bench({ uberPriceCents: 2500, lyftPriceCents: null })], rules, context);
    expect(r.quote.creditsAppliedCents).toBe(r.quote.totalCents);
    expect(r.quote.amountDueCents).toBe(0);
  });
});
