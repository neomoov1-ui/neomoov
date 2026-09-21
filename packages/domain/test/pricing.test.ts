import { describe, expect, it } from 'vitest';
import {
  PricingError, computeQuote, computeWaitChargeCents, finalizeQuote, isNightTime, isPeakHours, localTimeParts,
  matchFlatRate, mulDivRound, subtotalForTotal,
  type PricingRules, type Promotion, type QuoteInput,
} from '../src/index.js';

// Jeu de règles de test, identique aux données de départ de la V1 (cahier des charges, section 5.1).
// Les plages de pointe sont un exemple : la vraie valeur vient de la table `settings`.
const rules: PricingRules = {
  timeZone: 'America/Toronto',
  categories: [
    { category: 'neo_premium', baseFareCents: 375, perKmCents: 170, perMinuteCents: 40, minimumFareCents: 950 },
    { category: 'neo_prestige', baseFareCents: 475, perKmCents: 210, perMinuteCents: 50, minimumFareCents: 1200 },
    { category: 'neo_xl', baseFareCents: 500, perKmCents: 230, perMinuteCents: 55, minimumFareCents: 1300 },
  ],
  surcharges: { nightCents: 200, nightStartHour: 23, nightEndHour: 5, airportCents: 300, childSeatCents: 300, bulkyLuggageCents: 200, perStopCents: 200, favouriteDriverCents: 300 },
  flexMultiplierBps: 9000,
  priorityMultiplierBps: 12500,
  peakWindows: [{ days: [1, 2, 3, 4, 5], startMinute: 390, endMinute: 570 }, { days: [1, 2, 3, 4, 5], startMinute: 930, endMinute: 1110 }],
  flatRates: [
    { originZone: 'centre_ville', destinationZone: 'aeroport_yul', bidirectional: true, totalCentsByCategory: { neo_premium: 5500, neo_prestige: 6900, neo_xl: 7500 } },
    { originZone: 'gare_centrale', destinationZone: 'vieux_port', bidirectional: false, totalCentsByCategory: { neo_premium: 5500 } },
  ],
  serviceFeeCents: 200, regulatoryFeeCents: 90, gstRatePpm: 50_000, qstRatePpm: 99_750,
  maxExtraAllowanceCents: 2000, waitFreeSeconds: 300, waitPerMinuteCents: 50,
};

const DAY = new Date('2026-09-22T14:00:00Z'); // mardi, 10 h à Montréal, hors pointe
const NIGHT = new Date('2026-09-23T03:30:00Z'); // mardi, 23 h 30
const PEAK = new Date('2026-09-22T12:00:00Z'); // mardi, 8 h
const base = (over: Partial<QuoteInput> = {}): QuoteInput => ({ category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, pickupAt: DAY, ...over });
const code = (fn: () => unknown): string => { try { fn(); } catch (e) { return (e as PricingError).code; } return 'AUCUNE_ERREUR'; };

describe('exemple de contrôle et grille V1', () => {
  it('Neo Premium, 8 km et 18 minutes : 24,55 $ de tarif, 31,56 $ affichés', () => {
    const q = computeQuote(base(), rules);
    expect(q).toMatchObject({ fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, subtotalCents: 2745, gstCents: 137, qstCents: 274, totalCents: 3156, driverAmountCents: 2455, flatRate: false, promotionCode: null });
    expect(q.lines.map((l) => [l.kind, l.amountCents])).toEqual([['base_fare', 375], ['distance', 1360], ['duration', 720]]);
  });
  it.each([
    ['neo_prestige', 3055, 3345, 167, 334, 3846],
    ['neo_xl', 3330, 3620, 181, 361, 4162],
  ])('%s, même trajet', (category, fare, subtotal, gst, qst, total) => {
    expect(computeQuote(base({ category }), rules)).toMatchObject({ fareCents: fare, subtotalCents: subtotal, gstCents: gst, qstCents: qst, totalCents: total });
  });
  it('le total est la somme des lignes arrondies et le prix maximal consenti ajoute la marge', () => {
    const q = computeQuote(base(), rules);
    expect(q.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(q.fareCents);
    expect(q.subtotalCents + q.gstCents + q.qstCents).toBe(q.totalCents);
    expect(q.maxConsentedCents).toBe(q.totalCents + 2000);
  });
});

describe('course minimale et arrondis', () => {
  it.each([
    ['neo_premium', 950, 285], ['neo_prestige', 1200, 365], ['neo_xl', 1300, 405],
  ])('%s, 1 km et 3 minutes : minimum appliqué', (category, fare, adjustment) => {
    const q = computeQuote(base({ category, distanceMeters: 1000, durationSeconds: 180 }), rules);
    expect(q.fareCents).toBe(fare);
    expect(q.lines.find((l) => l.kind === 'minimum_adjustment')?.amountCents).toBe(adjustment);
  });
  it('minimum Neo Premium : 14,26 $ affichés', () => {
    expect(computeQuote(base({ distanceMeters: 1000, durationSeconds: 180 }), rules)).toMatchObject({ subtotalCents: 1240, gstCents: 62, qstCents: 124, totalCents: 1426 });
  });
  it('arrondi au cent ligne par ligne', () => {
    const q = computeQuote(base({ distanceMeters: 12_340, durationSeconds: 1261 }), rules);
    expect(q.lines.map((l) => l.amountCents)).toEqual([375, 2098, 841]);
  });
  it.each([[1, 1, 2, 1], [5, 1, 2, 3], [7, 3, 2, 11], [0, 5, 3, 0]])('mulDivRound(%i, %i, %i) = %i', (a, b, d, r) => {
    expect(mulDivRound(a, b, d)).toBe(r);
  });
});

describe('suppléments', () => {
  it('nuit, de 23 h à 5 h : 2,00 $', () => {
    const q = computeQuote(base({ pickupAt: NIGHT }), rules);
    expect(q).toMatchObject({ fareCents: 2655, subtotalCents: 2945, gstCents: 147, qstCents: 294, totalCents: 3386 });
    expect(q.lines.at(-1)).toEqual({ kind: 'surcharge', code: 'night', amountCents: 200 });
  });
  it('aéroport, siège d\'enfant, bagages et deux arrêts', () => {
    const q = computeQuote(base({ airport: true, options: { childSeat: true, bulkyLuggage: true, stops: 2 } }), rules);
    expect(q.lines.filter((l) => l.kind === 'surcharge').map((l) => [l.code, l.amountCents])).toEqual([['airport', 300], ['child_seat', 300], ['bulky_luggage', 200], ['stops', 400]]);
    expect(q).toMatchObject({ fareCents: 3655, subtotalCents: 3945, gstCents: 197, qstCents: 394, totalCents: 4536 });
  });
  it.each([
    ['22 h 59', '2026-09-23T02:59:00Z', false], ['23 h 00', '2026-09-23T03:00:00Z', true],
    ['4 h 59', '2026-09-22T08:59:00Z', true], ['5 h 00', '2026-09-22T09:00:00Z', false],
    ['23 h 30 en hiver, heure normale', '2026-01-15T04:30:00Z', true], ['midi en hiver', '2026-01-15T17:00:00Z', false],
  ])('isNightTime à %s', (_label, iso, expected) => {
    expect(isNightTime(new Date(iso), rules.surcharges, rules.timeZone)).toBe(expected);
  });
});

describe('Offre Flex, Priorité et chauffeur favori', () => {
  it('Flex hors pointe : tarif × 0,90, 28,74 $ affichés', () => {
    const q = computeQuote(base({ options: { flex: true } }), rules);
    expect(q).toMatchObject({ fareCents: 2210, subtotalCents: 2500, gstCents: 125, qstCents: 249, totalCents: 2874 });
    expect(q.lines.at(-1)).toEqual({ kind: 'flex', code: 'flex', amountCents: -245 });
  });
  it('Flex refusée aux heures de pointe', () => {
    expect(code(() => computeQuote(base({ pickupAt: PEAK, options: { flex: true } }), rules))).toBe('FLEX_REFUSED_PEAK_HOURS');
  });
  it('Priorité : tarif × 1,25', () => {
    const q = computeQuote(base({ options: { priority: true } }), rules);
    expect(q).toMatchObject({ fareCents: 3069, subtotalCents: 3359, gstCents: 168, qstCents: 335, totalCents: 3862 });
    expect(q.lines.at(-1)).toEqual({ kind: 'priority', code: 'priority', amountCents: 614 });
  });
  it('Priorité reste offerte aux heures de pointe, sans aucune majoration de pointe', () => {
    expect(computeQuote(base({ pickupAt: PEAK }), rules).totalCents).toBe(3156);
    expect(computeQuote(base({ pickupAt: PEAK, options: { priority: true } }), rules).fareCents).toBe(3069);
  });
  it('Flex et Priorité ne se cumulent pas', () => {
    expect(code(() => computeQuote(base({ options: { flex: true, priority: true } }), rules))).toBe('FLEX_AND_PRIORITY_EXCLUSIVE');
  });
  it('chauffeur favori : 3,00 $ ajoutés après les multiplicateurs', () => {
    expect(computeQuote(base({ options: { favouriteDriver: true } }), rules)).toMatchObject({ fareCents: 2755, totalCents: 3501 });
    expect(computeQuote(base({ options: { flex: true, favouriteDriver: true } }), rules).fareCents).toBe(2510);
  });
  it.each([
    ['mardi 8 h', '2026-09-22T12:00:00Z', true], ['mardi 9 h 30, fin exclue', '2026-09-22T13:30:00Z', false],
    ['mardi 17 h', '2026-09-22T21:00:00Z', true], ['samedi 8 h', '2026-09-26T12:00:00Z', false],
  ])('isPeakHours, %s', (_label, iso, expected) => {
    expect(isPeakHours(new Date(iso), rules.peakWindows, rules.timeZone)).toBe(expected);
  });
  it('localTimeParts : dimanche vaut 0', () => {
    expect(localTimeParts(new Date('2026-09-27T16:05:00Z'), 'America/Toronto')).toEqual({ weekday: 0, hour: 12, minute: 5 });
  });
});

describe('forfaits', () => {
  it.each([
    ['neo_premium', 5500, 4494, 239, 477], ['neo_prestige', 6900, 5711, 300, 599], ['neo_xl', 7500, 6233, 326, 651],
  ])('aéroport, %s : le forfait fixe le prix total affiché', (category, total, fare, gst, qst) => {
    const q = computeQuote(base({ category, originZone: 'centre_ville', destinationZone: 'aeroport_yul' }), rules);
    expect(q).toMatchObject({ flatRate: true, totalCents: total, fareCents: fare, gstCents: gst, qstCents: qst, driverAmountCents: fare });
    expect(q.lines).toEqual([{ kind: 'flat_rate', code: 'centre_ville:aeroport_yul', amountCents: fare }]);
  });
  it('forfait dans les deux sens, nuit et options ignorées et signalées', () => {
    const q = computeQuote(base({ pickupAt: NIGHT, originZone: 'aeroport_yul', destinationZone: 'centre_ville', options: { flex: true, priority: true, childSeat: false, stops: 1 } }), rules);
    expect(q.totalCents).toBe(5500);
    expect(q.ignoredOptions).toEqual(['flex', 'priority', 'stops']);
  });
  it('forfait à sens unique, et catégorie sans forfait : calcul normal', () => {
    expect(matchFlatRate(rules.flatRates, 'vieux_port', 'gare_centrale')).toBeNull();
    expect(matchFlatRate(rules.flatRates, 'gare_centrale', 'vieux_port')?.bidirectional).toBe(false);
    expect(matchFlatRate(rules.flatRates, null, 'aeroport_yul')).toBeNull();
    expect(matchFlatRate(rules.flatRates, 'centre_ville', undefined)).toBeNull();
    expect(computeQuote(base({ category: 'neo_xl', originZone: 'gare_centrale', destinationZone: 'vieux_port' }), rules).flatRate).toBe(false);
  });
  it('un forfait indécomposable en lignes arrondies est refusé', () => {
    let impossible = 5000;
    while (subtotalForTotal(impossible, rules) !== null) impossible += 1;
    const broken: PricingRules = { ...rules, flatRates: [{ originZone: 'a', destinationZone: 'b', bidirectional: false, totalCentsByCategory: { neo_premium: impossible } }] };
    expect(code(() => computeQuote(base({ originZone: 'a', destinationZone: 'b' }), broken))).toBe('FLAT_RATE_NOT_DECOMPOSABLE');
  });
  it('subtotalForTotal retrouve tout sous-total, quel que soit l\'arrondi', () => {
    for (let s = 4000; s < 4400; s += 1) {
      const total = computeQuote(base(), { ...rules, categories: [{ category: 'neo_premium', baseFareCents: s - 290, perKmCents: 0, perMinuteCents: 0, minimumFareCents: 0 }] }).totalCents;
      expect(subtotalForTotal(total, rules)).not.toBeNull();
    }
  });
});

describe('promotions et crédits', () => {
  const launch: Promotion = { code: 'LANCEMENT30', kind: 'percent', percentBps: 3000 };
  const third: Promotion = { code: 'TROISIEME', kind: 'free_ride', nthRide: 3, maxDistanceMeters: 10_000, categories: ['neo_premium'] };
  it('30 % : remise sur le tarif, le chauffeur est compensé à 100 %', () => {
    expect(computeQuote(base({ promotion: launch }), rules)).toMatchObject({ promotionCode: 'LANCEMENT30', promotionDiscountCents: 737, promotionCompensationCents: 737, driverAmountCents: 2455, subtotalCents: 2008, gstCents: 100, qstCents: 200, totalCents: 2308 });
  });
  it('promotion en pourcentage sans taux : aucune remise', () => {
    expect(computeQuote(base({ promotion: { code: 'VIDE', kind: 'percent' } }), rules).promotionDiscountCents).toBe(0);
  });
  it('troisième course offerte : acceptée à 9,9 km', () => {
    const q = computeQuote(base({ distanceMeters: 9900, durationSeconds: 1200, promotion: third, clientCompletedRides: 2 }), rules);
    expect(q).toMatchObject({ fareCents: 2858, promotionDiscountCents: 2858, subtotalCents: 290, gstCents: 15, qstCents: 29, totalCents: 334, driverAmountCents: 2858 });
  });
  it('troisième course offerte avec renonciation aux frais : 0,00 $', () => {
    const q = computeQuote(base({ distanceMeters: 9900, promotion: { ...third, waivesFees: true }, clientCompletedRides: 2 }), rules);
    expect(q).toMatchObject({ serviceFeeCents: 0, regulatoryFeeCents: 0, subtotalCents: 0, totalCents: 0, amountDueCents: 0 });
  });
  it.each([
    ['refusée à 10,1 km', { distanceMeters: 10_100, clientCompletedRides: 2 }],
    ['refusée à la deuxième course', { distanceMeters: 5000, clientCompletedRides: 1 }],
    ['refusée sans historique', { distanceMeters: 5000 }],
    ['refusée pour une autre catégorie', { distanceMeters: 5000, clientCompletedRides: 2, category: 'neo_xl' }],
  ])('troisième course offerte : %s', (_label, over) => {
    expect(code(() => computeQuote(base({ promotion: third, ...over }), rules))).toBe('PROMOTION_NOT_APPLICABLE');
  });
  it.each([[1000, 1000, 2156], [5000, 3156, 0], [0, 0, 3156]])('crédits de %i cents : %i appliqués, %i à payer', (available, applied, due) => {
    expect(computeQuote(base({ creditsAvailableCents: available }), rules)).toMatchObject({ creditsAppliedCents: applied, amountDueCents: due });
  });
});

describe('entrées invalides', () => {
  it.each([
    ['distance négative', { distanceMeters: -1 }], ['distance non finie', { distanceMeters: Number.NaN }],
    ['durée négative', { durationSeconds: -5 }], ['durée non finie', { durationSeconds: Number.POSITIVE_INFINITY }],
    ['date invalide', { pickupAt: new Date('pas une date') }], ['arrêts non entiers', { options: { stops: 1.5 } }],
    ['arrêts négatifs', { options: { stops: -1 } }], ['crédits négatifs', { creditsAvailableCents: -1 }],
  ])('%s', (_label, over) => {
    expect(code(() => computeQuote(base(over), rules))).toBe('INVALID_INPUT');
  });
  it('catégorie inconnue', () => {
    expect(code(() => computeQuote(base({ category: 'neo_limo' }), rules))).toBe('UNKNOWN_CATEGORY');
    expect(() => computeQuote(base({ category: 'neo_limo' }), rules)).toThrow(PricingError);
  });
});

describe('attente et prix final', () => {
  it.each([[0, 0], [299, 0], [300, 0], [359, 0], [360, 50], [725, 350]])('%i secondes d\'attente : %i cents', (seconds, cents) => {
    expect(computeWaitChargeCents(seconds, rules)).toBe(cents);
  });
  it('sans attente facturable, le devis est inchangé', () => {
    const q = computeQuote(base(), rules);
    expect(finalizeQuote(q, 120, rules)).toBe(q);
  });
  it('7 minutes facturables : 3,50 $ de plus au tarif, taxes recalculées, crédits conservés', () => {
    const f = finalizeQuote(computeQuote(base({ creditsAvailableCents: 1000 }), rules), 725, rules);
    expect(f).toMatchObject({ fareCents: 2805, driverAmountCents: 2805, subtotalCents: 3095, gstCents: 155, qstCents: 309, totalCents: 3559, amountDueCents: 2559 });
    expect(f.lines.at(-1)).toEqual({ kind: 'wait_time', code: 'wait_time', amountCents: 350 });
  });
  it('le plafond tient pour toute une série de trajets', () => {
    for (let meters = 1000; meters <= 30_000; meters += 370) {
      const q = computeQuote(base({ distanceMeters: meters, durationSeconds: Math.round(meters / 8) }), rules);
      const f = finalizeQuote(q, 4 * 3600, rules);
      expect(f.totalCents).toBeLessThanOrEqual(q.maxConsentedCents);
      expect(f.totalCents).toBeGreaterThan(q.maxConsentedCents - 3);
      expect(f.subtotalCents + f.gstCents + f.qstCents).toBe(f.totalCents);
    }
  });
  it.each([['de jour', DAY], ['de nuit', NIGHT]])('attente très longue %s : jamais au-delà du prix maximal consenti', (_label, pickupAt) => {
    const q = computeQuote(base({ pickupAt }), rules);
    const f = finalizeQuote(q, 3 * 3600, rules);
    expect(f.totalCents).toBeLessThanOrEqual(q.maxConsentedCents);
    expect(f.totalCents).toBeGreaterThan(q.maxConsentedCents - 3);
  });
});
