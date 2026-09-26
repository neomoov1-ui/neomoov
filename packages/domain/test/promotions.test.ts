import { describe, expect, it } from 'vitest';
import {
  applyPromotion, computeQuote, evaluatePromotion, pickAutoPromotion, toQuotePromotion, type PricingRules, type PromotionContext, type PromotionRecord,
} from '../src/index.js';

const NOW = new Date('2026-10-05T15:00:00Z');
const base = (over: Partial<PromotionRecord> = {}): PromotionRecord => ({
  code: 'TEST', type: 'percent', value: 1000, maxDiscountCents: null, conditions: {}, waivesFees: false, globalLimit: null, perClientLimit: 1, budgetCents: null, spentCents: 0,
  validFrom: new Date('2026-09-01T00:00:00Z'), validTo: null, active: true, ...over,
});
const ctx = (over: Partial<PromotionContext> = {}): PromotionContext => ({
  now: NOW, category: 'neo_premium', distanceMeters: 8_000, originZone: 'plateau', destinationZone: 'centre-ville', pickupLocal: { dayOfWeek: 1, minuteOfDay: 11 * 60 },
  clientCompletedRides: 0, usage: { globalUses: 0, clientUses: 0, distinctClients: 0 }, ...over,
});
const refusal = (record: PromotionRecord, context: PromotionContext) => {
  const result = evaluatePromotion(record, context);
  return result.ok ? null : result.reason;
};

// Promotions de lancement (section 6.7 du document de référence), telles que chargées par le jeu de données initial.
const BIENVENUE3 = base({ code: 'BIENVENUE3', type: 'nth_ride', value: 3, conditions: { maxDistanceMeters: 10_000, autoApply: true }, waivesFees: true, budgetCents: 500_000 });
const MERCI10 = base({ code: 'MERCI10', type: 'nth_ride', value: 10, conditions: { autoApply: true }, waivesFees: true, budgetCents: 500_000 });
const LANCEMENT30 = base({ code: 'LANCEMENT30', type: 'percent', value: 3000, maxDiscountCents: 1500, conditions: { maxClients: 1000 }, globalLimit: 3000, perClientLimit: 3, budgetCents: 3_000_000 });

describe('promotions : une règle, un test (section 5.9)', () => {
  it('validité : inactive, pas encore commencée, expirée', () => {
    expect(refusal(base({ active: false }), ctx())).toBe('inactive');
    expect(refusal(base({ validFrom: new Date('2026-11-01T00:00:00Z') }), ctx())).toBe('not_started');
    expect(refusal(base({ validTo: new Date('2026-10-01T00:00:00Z') }), ctx())).toBe('expired');
    expect(refusal(base({ validTo: new Date('2026-12-01T00:00:00Z') }), ctx())).toBeNull();
  });

  it('budget : épuisé dès que la dépense l\'atteint', () => {
    expect(refusal(base({ budgetCents: 10_000, spentCents: 10_000 }), ctx())).toBe('budget_exhausted');
    expect(refusal(base({ budgetCents: 10_000, spentCents: 9_999 }), ctx())).toBeNull();
  });

  it('limite globale et limite par client', () => {
    expect(refusal(base({ globalLimit: 5 }), ctx({ usage: { globalUses: 5, clientUses: 0, distinctClients: 5 } }))).toBe('global_limit');
    expect(refusal(base({ perClientLimit: 2 }), ctx({ usage: { globalUses: 2, clientUses: 2, distinctClients: 1 } }))).toBe('client_limit');
    expect(refusal(base({ perClientLimit: 2 }), ctx({ usage: { globalUses: 1, clientUses: 1, distinctClients: 1 } }))).toBeNull();
  });

  it('nombre maximal de clients distincts : un nouveau client refusé, un client déjà compté accepté', () => {
    const record = base({ conditions: { maxClients: 2 }, perClientLimit: 3 });
    expect(refusal(record, ctx({ usage: { globalUses: 4, clientUses: 0, distinctClients: 2 } }))).toBe('max_clients');
    expect(refusal(record, ctx({ usage: { globalUses: 4, clientUses: 1, distinctClients: 2 } }))).toBeNull();
  });

  it('première course seulement', () => {
    const record = base({ conditions: { firstRideOnly: true } });
    expect(refusal(record, ctx({ clientCompletedRides: 0 }))).toBeNull();
    expect(refusal(record, ctx({ clientCompletedRides: 1 }))).toBe('first_ride_only');
  });

  it('n-ième course : seulement au rang exact', () => {
    const record = base({ type: 'nth_ride', value: 3 });
    expect(refusal(record, ctx({ clientCompletedRides: 1 }))).toBe('wrong_rank');
    expect(refusal(record, ctx({ clientCompletedRides: 2 }))).toBeNull();
    expect(refusal(record, ctx({ clientCompletedRides: 3 }))).toBe('wrong_rank');
  });

  it('distance maximale, catégorie, zone (origine ou destination)', () => {
    expect(refusal(base({ conditions: { maxDistanceMeters: 5_000 } }), ctx())).toBe('distance');
    expect(refusal(base({ conditions: { categories: ['neo_xl'] } }), ctx())).toBe('category');
    expect(refusal(base({ conditions: { zones: ['yul'] } }), ctx())).toBe('zone');
    expect(refusal(base({ conditions: { zones: ['yul', 'centre-ville'] } }), ctx())).toBeNull();
  });

  it('plage horaire à l\'heure de Montréal, y compris une plage qui passe minuit', () => {
    const weekdays = base({ conditions: { timeWindow: { daysOfWeek: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 16 * 60 } } });
    expect(refusal(weekdays, ctx())).toBeNull();
    expect(refusal(weekdays, ctx({ pickupLocal: { dayOfWeek: 6, minuteOfDay: 11 * 60 } }))).toBe('time_window');
    expect(refusal(weekdays, ctx({ pickupLocal: { dayOfWeek: 1, minuteOfDay: 16 * 60 } }))).toBe('time_window');
    const night = base({ conditions: { timeWindow: { startMinute: 22 * 60, endMinute: 2 * 60 } } });
    expect(refusal(night, ctx({ pickupLocal: { dayOfWeek: 5, minuteOfDay: 23 * 60 } }))).toBeNull();
    expect(refusal(night, ctx({ pickupLocal: { dayOfWeek: 6, minuteOfDay: 60 } }))).toBeNull();
    expect(refusal(night, ctx({ pickupLocal: { dayOfWeek: 6, minuteOfDay: 3 * 60 } }))).toBe('time_window');
  });

  it('traduction pour le moteur de devis : pourcentage, montant fixe, course offerte, n-ième course', () => {
    expect(toQuotePromotion(LANCEMENT30)).toEqual({ code: 'LANCEMENT30', kind: 'percent', percentBps: 3000, maxDiscountCents: 1500 });
    expect(toQuotePromotion(base({ code: 'CINQ', type: 'fixed', value: 500 }))).toEqual({ code: 'CINQ', kind: 'fixed', fixedCents: 500 });
    expect(toQuotePromotion(base({ code: 'CADEAU', type: 'free_ride', waivesFees: true, conditions: { categories: ['neo_premium'] } }))).toEqual({ code: 'CADEAU', kind: 'free_ride', waivesFees: true, categories: ['neo_premium'] });
    expect(toQuotePromotion(BIENVENUE3)).toEqual({ code: 'BIENVENUE3', kind: 'free_ride', nthRide: 3, waivesFees: true, maxDistanceMeters: 10_000 });
  });
});

const RULES: PricingRules = {
  timeZone: 'America/Toronto',
  categories: [{ category: 'neo_premium', baseFareCents: 375, perKmCents: 170, perMinuteCents: 40, minimumFareCents: 950 }],
  surcharges: { nightCents: 200, nightStartHour: 23, nightEndHour: 5, airportCents: 300, childSeatCents: 300, bulkyLuggageCents: 200, perStopCents: 200, favouriteDriverCents: 300 },
  flexMultiplierBps: 9000,
  priorityMultiplierBps: 12500,
  peakWindows: [],
  flatRates: [],
  serviceFeeCents: 200, regulatoryFeeCents: 90, gstRatePpm: 50_000, qstRatePpm: 99_750,
  maxExtraAllowanceCents: 2000, waitFreeSeconds: 300, waitPerMinuteCents: 50,
};

describe('promotions de lancement sur des cas réels', () => {
  const quote = (promotion: PromotionRecord, context: PromotionContext) => {
    const evaluation = evaluatePromotion(promotion, context);
    if (!evaluation.ok) throw new Error(evaluation.reason);
    return computeQuote({ category: 'neo_premium', distanceMeters: context.distanceMeters, durationSeconds: 900, pickupAt: NOW, promotion: evaluation.promotion, clientCompletedRides: context.clientCompletedRides }, RULES);
  };

  it('troisième course offerte jusqu\'à 10 km, frais compris ; refusée au-delà de 10 km ou à un autre rang', () => {
    const third = quote(BIENVENUE3, ctx({ clientCompletedRides: 2 }));
    expect(third.totalCents).toBe(0);
    expect(refusal(BIENVENUE3, ctx({ clientCompletedRides: 2, distanceMeters: 12_000 }))).toBe('distance');
    expect(refusal(BIENVENUE3, ctx({ clientCompletedRides: 4 }))).toBe('wrong_rank');
  });

  it('dixième course offerte, sans limite de distance', () => {
    expect(quote(MERCI10, ctx({ clientCompletedRides: 9, distanceMeters: 40_000 })).totalCents).toBe(0);
  });

  it('code de lancement : 30 % plafonné à 15 $, trois courses par client, 1 000 clients', () => {
    const q = quote(LANCEMENT30, ctx({ distanceMeters: 30_000 }));
    expect(q.promotionDiscountCents).toBe(1500);
    const small = quote(LANCEMENT30, ctx({ distanceMeters: 2_000 }));
    expect(small.promotionDiscountCents).toBeLessThan(1500);
    expect(refusal(LANCEMENT30, ctx({ usage: { globalUses: 3, clientUses: 3, distinctClients: 1 } }))).toBe('client_limit');
    expect(refusal(LANCEMENT30, ctx({ usage: { globalUses: 2500, clientUses: 0, distinctClients: 1000 } }))).toBe('max_clients');
  });

  it('remise fixe : jamais plus que le tarif', () => {
    const five = quote(base({ code: 'CINQ', type: 'fixed', value: 500 }), ctx());
    expect(five.promotionDiscountCents).toBe(500);
    const input = { category: 'neo_premium', distanceMeters: 1_000, durationSeconds: 300, pickupAt: NOW };
    expect(applyPromotion({ code: 'ENORME', kind: 'fixed', fixedCents: 1_000_000 }, input, 950)).toBe(950);
    expect(applyPromotion({ code: 'VIDE', kind: 'fixed' }, input, 950)).toBe(0);
  });

  it('application automatique sans code : la troisième puis la dixième course', () => {
    const records = [LANCEMENT30, BIENVENUE3, MERCI10];
    expect(pickAutoPromotion(records, () => ctx({ clientCompletedRides: 2 }))?.record.code).toBe('BIENVENUE3');
    expect(pickAutoPromotion(records, () => ctx({ clientCompletedRides: 9 }))?.record.code).toBe('MERCI10');
    expect(pickAutoPromotion(records, () => ctx({ clientCompletedRides: 5 }))).toBeNull();
  });
});
