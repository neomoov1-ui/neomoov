import { describe, expect, it } from 'vitest';
import {
  chainAgenda, DEFAULT_PILOT_CRITERIA, driverAgendaQuerySchema, driverCostsInputSchema, driverOfferSchema, evaluateOffer, excludedZones, monthSchema, netProfitability,
  parsePilotCriteria, parseWatchedZones, PILOT_INFORMATION_VERSION, pilotCriteriaSchema, pilotDecisionsQuerySchema, pilotInformation, pilotMetrics,
  pilotReasonSchema, pilotSettingsUpdateSchema, pilotTimeWindowSchema, pilotZoneExclusions, ridePreferencesSchema, scheduleConflict, watchedZonesExcluded,
  withinTimeWindows, type PilotContext, type PilotCriteriaInput, type PilotOffer,
} from '../src/index.js';

const TZ = 'America/Toronto';
const at = (iso: string) => new Date(iso);
/** Lundi 5 octobre 2026, 10 h à Montréal (heure avancée, UTC-4). */
const MONDAY_10H = at('2026-10-05T14:00:00Z');

const BASE: PilotOffer = {
  rideType: 'scheduled', negotiation: false, category: 'neo_premium', driverFareCents: 3000,
  pickupMeters: null, pickupSeconds: null, tripMeters: 10_000, tripSeconds: 1200, pickupAt: MONDAY_10H,
  originZones: ['grand-montreal', 'plateau'], destinationZones: ['grand-montreal', 'centre-ville'],
  clientRating: 4.8, assistanceAnimal: false, accessibility: false,
};
const CTX: PilotContext = { timeZone: TZ, multiAppFactor: 1.25, nearMissPercent: 10, planned: [] };
const criteria = (input: PilotCriteriaInput = {}) => pilotCriteriaSchema.parse(input);
const evaluate = (input: PilotCriteriaInput, offer: Partial<PilotOffer> = {}, context: Partial<PilotContext> = {}) => evaluateOffer({ ...BASE, ...offer }, criteria(input), { ...CTX, ...context });
const codes = (input: PilotCriteriaInput, offer: Partial<PilotOffer> = {}, context: Partial<PilotContext> = {}) => evaluate(input, offer, context).reasons.map((r) => r.code);

const ZONES = [
  { code: 'grand-montreal', type: 'service_area' },
  { code: 'yul', type: 'airport' },
  { code: 'centre-ville', type: 'downtown' },
  { code: 'plateau', type: 'district' },
];

describe('Neomoov Pilote : critères', () => {
  it('valeurs par défaut : aucun filtre, marge de 30 minutes, mode multi-applications désactivé', () => {
    expect(DEFAULT_PILOT_CRITERIA).toEqual(criteria());
    expect(DEFAULT_PILOT_CRITERIA).toMatchObject({ minFareCents: null, costPerKmCents: 0, timeWindows: [], originZones: [], scheduleMarginMinutes: 30, multiAppMode: false });
    expect(Object.isFrozen(DEFAULT_PILOT_CRITERIA)).toBe(true);
  });

  it('lecture du JSON enregistré : défauts pour l\'absent, null si invalide', () => {
    expect(parsePilotCriteria(undefined)).toEqual(DEFAULT_PILOT_CRITERIA);
    expect(parsePilotCriteria(null)).toEqual(DEFAULT_PILOT_CRITERIA);
    expect(parsePilotCriteria({ minFareCents: 2000 })?.minFareCents).toBe(2000);
    expect(parsePilotCriteria({ minFareCents: -1 })).toBeNull();
    expect(parsePilotCriteria({ originZones: ['Plateau Mont-Royal'] })).toBeNull();
    expect(parsePilotCriteria({ categories: ['neo_moto'] })).toBeNull();
  });

  it('plages horaires : format HH:MM, plage non vide', () => {
    expect(pilotTimeWindowSchema.safeParse({ days: [1], from: '09:00', to: '17:00' }).success).toBe(true);
    expect(pilotTimeWindowSchema.safeParse({ days: [1], from: '09:00', to: '09:00' }).success).toBe(false);
    expect(pilotTimeWindowSchema.safeParse({ days: [1], from: '9h', to: '17:00' }).success).toBe(false);
    expect(pilotTimeWindowSchema.safeParse({ days: [], from: '09:00', to: '17:00' }).success).toBe(false);
    expect(pilotTimeWindowSchema.safeParse({ days: [7], from: '09:00', to: '17:00' }).success).toBe(false);
  });

  it('plages horaires : en heure de Montréal, y compris de nuit (après minuit, le jour du début)', () => {
    const day = [{ days: [1], from: '09:00', to: '17:00' }];
    expect(withinTimeWindows(MONDAY_10H, [], TZ)).toBe(true);
    expect(withinTimeWindows(MONDAY_10H, day, TZ)).toBe(true);
    expect(withinTimeWindows(at('2026-10-05T22:00:00Z'), day, TZ)).toBe(false); // lundi 18 h
    expect(withinTimeWindows(at('2026-10-06T14:00:00Z'), day, TZ)).toBe(false); // mardi 10 h
    const night = [{ days: [1], from: '22:00', to: '02:00' }];
    expect(withinTimeWindows(at('2026-10-06T03:00:00Z'), night, TZ)).toBe(true); // lundi 23 h
    expect(withinTimeWindows(at('2026-10-06T05:00:00Z'), night, TZ)).toBe(true); // mardi 1 h (plage du lundi)
    expect(withinTimeWindows(at('2026-10-06T07:00:00Z'), night, TZ)).toBe(false); // mardi 3 h
    expect(withinTimeWindows(at('2026-10-06T01:00:00Z'), night, TZ)).toBe(false); // lundi 21 h
  });
});

describe('Neomoov Pilote : zones admises et surveillance des exclusions', () => {
  it('une liste vide ou l\'aire de service n\'exclut rien ; sinon, toutes les autres zones connues', () => {
    expect(excludedZones([], ZONES)).toEqual([]);
    expect(excludedZones(['grand-montreal'], ZONES)).toEqual([]);
    expect(excludedZones(['plateau'], ZONES)).toEqual(['centre-ville', 'yul']);
    expect(pilotZoneExclusions({ originZones: ['plateau'], destinationZones: [] }, ZONES)).toEqual({ origin: ['centre-ville', 'yul'], destination: [] });
  });

  it('zones surveillées exclues, réglage lu sans doublon ni code invalide', () => {
    expect(watchedZonesExcluded({ origin: ['centre-ville', 'yul'], destination: ['yul'] }, ['yul', 'vieux-montreal'])).toEqual(['yul']);
    expect(watchedZonesExcluded({ origin: [], destination: [] }, ['yul'])).toEqual([]);
    expect(parseWatchedZones('yul')).toEqual([]);
    expect(parseWatchedZones(['yul', 'yul', 'Zone Invalide', 3, 'plateau'])).toEqual(['yul', 'plateau']);
  });
});

describe('Neomoov Pilote : gain net et réservations planifiées', () => {
  it('gain net au kilomètre et à l\'heure, approche comprise, coût variable retranché', () => {
    expect(pilotMetrics(BASE, 0)).toEqual({ netCents: 3000, netPerKmCents: 300, netPerHourCents: 9000, totalMeters: 10_000, totalSeconds: 1200 });
    expect(pilotMetrics({ ...BASE, pickupMeters: 3000, pickupSeconds: 420 }, 50)).toEqual({ netCents: 2350, netPerKmCents: 181, netPerHourCents: 5222, totalMeters: 13_000, totalSeconds: 1620 });
    expect(pilotMetrics({ ...BASE, tripMeters: null, tripSeconds: null }, 50)).toEqual({ netCents: 3000, netPerKmCents: null, netPerHourCents: null, totalMeters: null, totalSeconds: null });
    expect(pilotMetrics({ ...BASE, tripMeters: 0, tripSeconds: 0 }, 50)).toMatchObject({ netPerKmCents: null, netPerHourCents: null, totalMeters: 0, totalSeconds: 0 });
  });

  it('chevauchement avec une réservation planifiée, marge comprise', () => {
    const planned = [{ startsAt: at('2026-10-05T14:30:00Z'), endsAt: at('2026-10-05T15:00:00Z') }];
    expect(scheduleConflict(BASE, 30, planned)).toEqual(planned[0]!.startsAt);
    expect(scheduleConflict(BASE, 0, planned)).toBeNull();
    expect(scheduleConflict({ pickupAt: at('2026-10-05T14:29:00Z'), tripSeconds: null }, 0, planned)).toBeNull();
    expect(scheduleConflict({ pickupAt: at('2026-10-05T14:29:00Z'), tripSeconds: null }, 2, planned)).toEqual(planned[0]!.startsAt);
    expect(scheduleConflict(BASE, 30, [])).toBeNull();
  });
});

describe('Neomoov Pilote : évaluation des offres', () => {
  it('aucun critère : acceptée, score vert', () => {
    expect(evaluate({})).toMatchObject({ decision: 'accept', score: 'green', reasons: [{ code: 'criteria_met' }] });
  });

  it('critères illisibles : jamais d\'acceptation automatique', () => {
    expect(evaluateOffer(BASE, null, CTX)).toMatchObject({ decision: 'manual', score: 'yellow', reasons: [{ code: 'criteria_invalid' }], metrics: { netCents: 3000 } });
  });

  it('montant minimal : manqué de peu (jaune) ou nettement (rouge)', () => {
    expect(evaluate({ minFareCents: 3000 }).decision).toBe('accept');
    expect(evaluate({ minFareCents: 3200 })).toMatchObject({ decision: 'manual', score: 'yellow', reasons: [{ code: 'fare_below_min', params: { value: 3000, min: 3200 } }] });
    expect(evaluate({ minFareCents: 4000 })).toMatchObject({ decision: 'reject', score: 'red' });
    expect(evaluate({ minFareCents: 3200 }, {}, { nearMissPercent: -5 }).decision).toBe('reject');
  });

  it('gain net minimal au kilomètre et à l\'heure', () => {
    expect(evaluate({ costPerKmCents: 50, minNetPerKmCents: 300 })).toMatchObject({ decision: 'reject', reasons: [{ code: 'net_per_km_below_min', params: { value: 250, min: 300 } }] });
    expect(evaluate({ minNetPerHourCents: 9500 })).toMatchObject({ decision: 'manual', reasons: [{ code: 'net_per_hour_below_min', params: { value: 9000, min: 9500 } }] });
    expect(evaluate({ minNetPerKmCents: 300, minNetPerHourCents: 9000 }).decision).toBe('accept');
  });

  it('donnée manquante pour un critère fixé : décision manuelle', () => {
    const result = evaluate({ minNetPerKmCents: 100, minNetPerHourCents: 100, maxDurationMinutes: 60 }, { tripMeters: null, tripSeconds: null });
    expect(result).toMatchObject({ decision: 'manual', reasons: [{ code: 'data_missing', params: { fields: ['distance', 'duration'] } }] });
  });

  it('approche : exigée pour une course immédiate, ignorée pour une réservation sans position', () => {
    const immediate = { rideType: 'immediate' as const, pickupMeters: 3000, pickupSeconds: 420 };
    expect(evaluate({ maxPickupMeters: 2000 }, immediate)).toMatchObject({ decision: 'reject', reasons: [{ code: 'pickup_too_far', params: { value: 3000, max: 2000 } }] });
    expect(evaluate({ maxPickupMeters: 2800 }, immediate).decision).toBe('manual');
    expect(evaluate({ maxPickupMinutes: 6 }, immediate)).toMatchObject({ decision: 'reject', reasons: [{ code: 'pickup_too_long', params: { value: 7, max: 6 } }] });
    expect(evaluate({ maxPickupMeters: 3000, maxPickupMinutes: 7 }, immediate).decision).toBe('accept');
    expect(evaluate({ maxPickupMeters: 2000, maxPickupMinutes: 5 }, { rideType: 'immediate' })).toMatchObject({ decision: 'manual', reasons: [{ code: 'data_missing', params: { fields: ['pickup'] } }] });
    expect(evaluate({ maxPickupMeters: 2000, maxPickupMinutes: 5 }).decision).toBe('accept');
  });

  it('durée maximale', () => {
    expect(evaluate({ maxDurationMinutes: 15 })).toMatchObject({ decision: 'reject', reasons: [{ code: 'duration_too_long', params: { value: 20, max: 15 } }] });
    expect(evaluate({ maxDurationMinutes: 20 }).decision).toBe('accept');
  });

  it('plages horaires, catégories et note du client (un client sans note n\'est pas écarté)', () => {
    expect(codes({ timeWindows: [{ days: [2], from: '09:00', to: '17:00' }] })).toEqual(['outside_hours']);
    expect(evaluate({ timeWindows: [{ days: [1], from: '09:00', to: '17:00' }] }).decision).toBe('accept');
    expect(evaluate({ categories: ['neo_xl'] })).toMatchObject({ decision: 'reject', reasons: [{ code: 'category_not_admitted', params: { category: 'neo_premium' } }] });
    expect(evaluate({ categories: ['neo_premium'] }).decision).toBe('accept');
    expect(evaluate({ minClientRating: 4.9 })).toMatchObject({ decision: 'reject', reasons: [{ code: 'client_rating_below_min', params: { rating: 4.8, min: 4.9 } }] });
    expect(evaluate({ minClientRating: 4.5 }).decision).toBe('accept');
    expect(evaluate({ minClientRating: 4.9 }, { clientRating: null }).decision).toBe('accept');
  });

  it('zones non admises : rejet signalé à la surveillance de la discrimination indirecte', () => {
    expect(evaluate({ originZones: ['centre-ville'] })).toMatchObject({ decision: 'reject', reasons: [{ code: 'origin_zone_not_admitted', params: { zones: ['grand-montreal', 'plateau'] }, monitored: true }] });
    expect(evaluate({ destinationZones: ['yul'] })).toMatchObject({ decision: 'reject', reasons: [{ code: 'destination_zone_not_admitted', monitored: true }] });
    expect(evaluate({ originZones: ['plateau'], destinationZones: ['centre-ville'] }).decision).toBe('accept');
  });

  it('compatibilité avec les réservations déjà planifiées', () => {
    const planned = [{ startsAt: at('2026-10-05T14:30:00Z'), endsAt: at('2026-10-05T15:00:00Z') }];
    expect(evaluate({}, {}, { planned })).toMatchObject({ decision: 'reject', reasons: [{ code: 'schedule_conflict', params: { startsAt: '2026-10-05T14:30:00.000Z' } }] });
    expect(evaluate({ scheduleMarginMinutes: 0 }, {}, { planned }).decision).toBe('accept');
  });

  it('garde-fou : animal d\'assistance ou accessibilité jamais rejetés par les critères (au pire manuel)', () => {
    const failing = { minFareCents: 9000, originZones: ['yul'] };
    expect(evaluate(failing, { assistanceAnimal: true })).toMatchObject({ decision: 'manual', score: 'yellow' });
    expect(evaluate(failing, { assistanceAnimal: true }).reasons.at(-1)).toEqual({ code: 'protected_request', params: { kinds: ['assistance_animal'] } });
    expect(evaluate(failing, { accessibility: true }).reasons.at(-1)).toEqual({ code: 'protected_request', params: { kinds: ['accessibility'] } });
    expect(evaluate(failing, { assistanceAnimal: true, accessibility: true }).reasons.at(-1)).toEqual({ code: 'protected_request', params: { kinds: ['assistance_animal', 'accessibility'] } });
    expect(evaluate({}, { assistanceAnimal: true }).decision).toBe('accept');
    expect(evaluate(failing).decision).toBe('reject');
  });

  it('mode multi-applications : immédiate toujours manuelle, planifiée acceptée, seuils minimaux relevés', () => {
    const immediate = { rideType: 'immediate' as const, pickupMeters: 1000, pickupSeconds: 180 };
    expect(evaluate({ multiAppMode: true }, immediate)).toMatchObject({ decision: 'manual', score: 'yellow', reasons: [{ code: 'multi_app_immediate' }] });
    expect(codes({ multiAppMode: true, minFareCents: 9000 }, immediate)).toEqual(['fare_below_min', 'multi_app_immediate']);
    expect(evaluate({ multiAppMode: true, minFareCents: 9000 }, immediate).decision).toBe('manual');
    expect(evaluate({ multiAppMode: true }).decision).toBe('accept');
    expect(evaluate({ minFareCents: 2500 }).decision).toBe('accept');
    expect(evaluate({ multiAppMode: true, minFareCents: 2500 })).toMatchObject({ decision: 'manual', reasons: [{ code: 'fare_below_min', params: { value: 3000, min: 3125 } }] });
    expect(evaluate({ multiAppMode: true, minFareCents: 2500 }, {}, { multiAppFactor: 0.5 }).decision).toBe('accept');
  });

  it('négociation : jamais acceptée automatiquement', () => {
    expect(evaluate({}, { negotiation: true })).toMatchObject({ decision: 'manual', reasons: [{ code: 'negotiation_offer' }] });
    expect(codes({ minFareCents: 9000 }, { negotiation: true })).toEqual(['fare_below_min']);
  });
});

describe('Neomoov Pilote : rentabilité nette', () => {
  it('revenus Neomoov et externes, coûts saisis et packs, marge et part de Neomoov', () => {
    const result = netProfitability(
      [{ fareCents: 2000, tipCents: 300 }, { fareCents: 500, tipCents: 0, fee: true }],
      { vehicle: 40_000, insurance: 15_000, maintenance: -5, phone: Number.NaN, other: 1000.4, packsCents: 5900 },
      100_000,
    );
    expect(result).toEqual({
      rides: 1,
      revenue: { neomoovCents: 2800, externalCents: 100_000, totalCents: 102_800 },
      costs: { items: { vehicle: 40_000, insurance: 15_000, energy: 0, maintenance: 0, phone: 0, other: 1000 }, packsCents: 5900, platformFeesCents: 0, totalCents: 61_900 },
      netCents: 40_900,
      marginPercent: 39.8,
      neomoovSharePercent: 2.7,
    });
  });

  it('sans revenu : net négatif possible, pourcentages nuls', () => {
    expect(netProfitability([], {}, 0)).toMatchObject({ rides: 0, netCents: 0, marginPercent: null, neomoovSharePercent: null });
    expect(netProfitability([], { packsCents: 2900 }, -10)).toMatchObject({ netCents: -2900, revenue: { externalCents: 0 }, marginPercent: null });
  });

  it('la redevance Neomoov retenue sur les courses compte dans les coûts (3 octobre 2026)', () => {
    const result = netProfitability([{ fareCents: 2000, tipCents: 0 }], { packsCents: 0, platformFeesCents: 200 }, 0);
    expect(result.costs).toMatchObject({ platformFeesCents: 200, totalCents: 200 });
    expect(result.netCents).toBe(1800);
  });
});

describe('Neomoov Pilote : agenda des réservations chaînées', () => {
  const rides = [
    { id: 'b', startsAt: at('2026-10-05T16:00:00Z'), durationSeconds: null, travelSeconds: 600 },
    { id: 'a', startsAt: at('2026-10-05T14:00:00Z'), durationSeconds: 3600, travelSeconds: 1200 },
    { id: 'c', startsAt: at('2026-10-05T16:20:00Z'), durationSeconds: 1200, travelSeconds: null },
  ];
  const options = (now: string) => ({ now: at(now), bufferSeconds: 300, alertSeconds: 900, defaultDurationSeconds: 1800 });

  it('ordre, fin estimée, départ conseillé, temps libre et enchaînement impossible', () => {
    const agenda = chainAgenda(rides, options('2026-10-05T12:00:00Z'));
    expect(agenda.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(agenda[0]).toEqual({ id: 'a', startsAt: rides[1]!.startsAt, endsAt: at('2026-10-05T15:00:00Z'), leaveAt: at('2026-10-05T13:35:00Z'), gapSeconds: null, conflict: false, status: 'later' });
    expect(agenda[1]).toMatchObject({ endsAt: at('2026-10-05T16:30:00Z'), leaveAt: at('2026-10-05T15:45:00Z'), gapSeconds: 2700, conflict: false, status: 'later' });
    expect(agenda[2]).toMatchObject({ endsAt: at('2026-10-05T16:40:00Z'), leaveAt: null, gapSeconds: -600, conflict: true, status: 'unknown' });
  });

  it('alerte de départ : bientôt, puis en retard', () => {
    expect(chainAgenda(rides, options('2026-10-05T13:25:00Z'))[0]!.status).toBe('leave_soon');
    expect(chainAgenda(rides, options('2026-10-05T13:40:00Z'))[0]!.status).toBe('late');
    expect(chainAgenda([], options('2026-10-05T13:40:00Z'))).toEqual([]);
  });
});

describe('Neomoov Pilote : information sur la décision automatisée (Loi 25, article 12.1)', () => {
  it('texte versionné, en français par défaut et en anglais, avec le délai d\'annulation sans frais', () => {
    const fr = pilotInformation(null, 59.6);
    expect(fr.version).toBe(PILOT_INFORMATION_VERSION);
    expect(fr.title).toBe('Neomoov Pilote : décision automatisée');
    expect(fr.paragraphs.join(' ')).toContain('pendant 60 secondes');
    expect(fr.paragraphs.join(' ')).toContain('une autre plateforme');
    const en = pilotInformation('en', 90);
    expect(en.title).toBe('Neomoov Pilot: automated decision');
    expect(en.paragraphs.join(' ')).toContain('for 90 seconds');
    expect(pilotInformation('fr', -5).paragraphs.join(' ')).toContain('pendant 0 secondes');
  });
});

describe('Neomoov Pilote : schémas de l\'API', () => {
  it('réglages, mois, coûts, pagination, agenda, raisons, préférence d\'animal d\'assistance, score sur l\'offre', () => {
    expect(pilotSettingsUpdateSchema.parse({ enabled: true, consentVersion: ' 2026-10-01 ', criteria: { minFareCents: 1500 } })).toMatchObject({ enabled: true, consentVersion: '2026-10-01', criteria: { minFareCents: 1500, multiAppMode: false } });
    expect(pilotSettingsUpdateSchema.safeParse({ consentVersion: '' }).success).toBe(false);
    expect(monthSchema.safeParse('2026-10').success).toBe(true);
    expect(monthSchema.safeParse('2026-13').success).toBe(false);
    expect(driverCostsInputSchema.parse({ energyCents: 12_000 })).toEqual({ vehicleCents: 0, insuranceCents: 0, energyCents: 12_000, maintenanceCents: 0, phoneCents: 0, otherCents: 0, externalRevenueCents: 0 });
    expect(driverCostsInputSchema.safeParse({ energyCents: -1 }).success).toBe(false);
    expect(pilotDecisionsQuerySchema.parse({ page: '2' })).toEqual({ page: 2, pageSize: 20 });
    expect(driverAgendaQuerySchema.parse({ lat: '45.5', lng: '-73.6' })).toEqual({ lat: 45.5, lng: -73.6 });
    expect(pilotReasonSchema.safeParse({ code: 'origin_zone_not_admitted', params: { zones: ['yul'] }, monitored: true }).success).toBe(true);
    expect(pilotReasonSchema.safeParse({ code: 'inconnu' }).success).toBe(false);
    expect(ridePreferencesSchema.parse({ assistanceAnimal: true }).assistanceAnimal).toBe(true);
    expect(driverOfferSchema.shape.pilotScore.safeParse(undefined).success).toBe(true);
    expect(driverOfferSchema.shape.pilotScore.safeParse(null).success).toBe(true);
  });
});
