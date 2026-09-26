import { describe, expect, it } from 'vitest';
import { computeQuote, isPetAllowed, PricingError, rideOptionsSchema, ridePreferencesSchema, type PricingRules, type QuoteInput } from '../src/index.js';

/** D8 (fondateur, 26 septembre 2026) : animal de compagnie en cage, Neo XL et Neo Prestige, supplément fixe. */
const rules: PricingRules = {
  timeZone: 'America/Toronto',
  categories: [
    { category: 'neo_premium', baseFareCents: 375, perKmCents: 170, perMinuteCents: 40, minimumFareCents: 950 },
    { category: 'neo_prestige', baseFareCents: 475, perKmCents: 210, perMinuteCents: 50, minimumFareCents: 1200 },
  ],
  surcharges: {
    nightCents: 200, nightStartHour: 23, nightEndHour: 5, airportCents: 300, childSeatCents: 300, bulkyLuggageCents: 200, perStopCents: 200, favouriteDriverCents: 300,
    petCents: 500, petCategories: ['neo_xl', 'neo_prestige'],
  },
  flexMultiplierBps: 9000,
  priorityMultiplierBps: 12500,
  peakWindows: [],
  flatRates: [{ originZone: 'centre-ville', destinationZone: 'yul', bidirectional: true, totalCentsByCategory: { neo_prestige: 6900 } }],
  serviceFeeCents: 200, regulatoryFeeCents: 90, gstRatePpm: 50_000, qstRatePpm: 99_750,
  maxExtraAllowanceCents: 2000, waitFreeSeconds: 300, waitPerMinuteCents: 50,
};
const input = (over: Partial<QuoteInput> = {}): QuoteInput => ({ category: 'neo_prestige', distanceMeters: 8000, durationSeconds: 1080, pickupAt: new Date('2026-09-22T14:00:00Z'), options: { pet: true }, ...over });
const code = (fn: () => unknown): string => { try { fn(); } catch (e) { return (e as PricingError).code; } return 'AUCUNE_ERREUR'; };

describe('animal de compagnie en cage (D8)', () => {
  it('ajoute le supplément au tarif du chauffeur dans une catégorie admise', () => {
    const q = computeQuote(input(), rules);
    const without = computeQuote(input({ options: {} }), rules);
    expect(q.lines).toContainEqual({ kind: 'surcharge', code: 'pet', amountCents: 500 });
    expect(q.fareCents).toBe(without.fareCents + 500);
    expect(q.driverAmountCents).toBe(q.fareCents);
    expect(isPetAllowed('neo_prestige', rules)).toBe(true);
  });
  it('refuse une catégorie qui ne l\'accepte pas, même sous un forfait', () => {
    expect(isPetAllowed('neo_premium', rules)).toBe(false);
    expect(code(() => computeQuote(input({ category: 'neo_premium' }), rules))).toBe('PET_NOT_ALLOWED');
    expect(code(() => computeQuote(input({ category: 'neo_premium', originZone: 'centre-ville', destinationZone: 'yul' }), rules))).toBe('PET_NOT_ALLOWED');
  });
  it('sous un forfait admis, le prix reste tout compris : le supplément est ignoré', () => {
    const q = computeQuote(input({ originZone: 'centre-ville', destinationZone: 'yul' }), rules);
    expect(q.totalCents).toBe(6900);
    expect(q.ignoredOptions).toContain('pet');
  });
  it('sans règle d\'animal, l\'option est refusée partout ; sans montant, supplément nul', () => {
    const none: PricingRules = { ...rules, surcharges: { ...rules.surcharges, petCents: undefined, petCategories: undefined } } as unknown as PricingRules;
    expect(isPetAllowed('neo_prestige', none)).toBe(false);
    expect(code(() => computeQuote(input(), none))).toBe('PET_NOT_ALLOWED');
    const free: PricingRules = { ...rules, surcharges: { ...rules.surcharges, petCents: undefined } } as unknown as PricingRules;
    expect(computeQuote(input(), free).lines).toContainEqual({ kind: 'surcharge', code: 'pet', amountCents: 0 });
  });
  it('schémas : option par défaut à faux, préférence facultative', () => {
    expect(rideOptionsSchema.parse({}).pet).toBe(false);
    expect(rideOptionsSchema.parse({ pet: true }).pet).toBe(true);
    expect(ridePreferencesSchema.parse({ pet: true }).pet).toBe(true);
    expect(ridePreferencesSchema.parse({}).pet).toBeUndefined();
  });
});
