/**
 * Neomoov Pilote (étape 24, amendement v1.2 section 7) : acceptation automatique des courses Neomoov selon les critères
 * du chauffeur, score vert, jaune ou rouge de chaque offre, garde-fous. Décision D1 du fondateur : Pilote n'agit que sur
 * les courses Neomoov, jamais sur une autre plateforme (aucune lecture, aucune action). Fonctions pures : l'API lit les
 * réglages, les zones, la note du client et l'agenda du chauffeur ; le domaine décide.
 *
 * Décision : `accept` (vert : Pilote accepte pour le chauffeur s'il est activé), `manual` (jaune : le chauffeur décide),
 * `reject` (rouge : hors de ses critères ; Pilote ne refuse jamais à sa place, l'offre reste affichée).
 */
import { z } from 'zod';
import { VEHICLE_CATEGORIES, type VehicleCategory } from '../enums.js';
import { localTimeParts } from '../pricing/quote.js';

export const PILOT_DECISIONS = ['accept', 'manual', 'reject'] as const;
export type PilotDecision = (typeof PILOT_DECISIONS)[number];

export const PILOT_SCORES = ['green', 'yellow', 'red'] as const;
export type PilotScore = (typeof PILOT_SCORES)[number];

/** Raisons d'un score, traduites par les applications (`pilot.reasons.<code>`). */
export const PILOT_REASON_CODES = [
  'criteria_met', 'fare_below_min', 'net_per_km_below_min', 'net_per_hour_below_min', 'pickup_too_far', 'pickup_too_long', 'duration_too_long',
  'outside_hours', 'origin_zone_not_admitted', 'destination_zone_not_admitted', 'category_not_admitted', 'client_rating_below_min', 'schedule_conflict',
  'data_missing', 'protected_request', 'multi_app_immediate', 'negotiation_offer', 'criteria_invalid',
] as const;
export type PilotReasonCode = (typeof PILOT_REASON_CODES)[number];

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ZONE_CODE = /^[a-z0-9_-]{1,40}$/;
const zoneCode = z.string().regex(ZONE_CODE);

/** Plage horaire admise, en heure de Montréal ; `from` après `to` : la plage passe minuit (jours = jour du début). */
export const pilotTimeWindowSchema = z
  .object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), from: z.string().regex(HHMM), to: z.string().regex(HHMM) })
  .refine((w) => w.from !== w.to, { message: 'Plage horaire vide', path: ['to'] });
export type PilotTimeWindow = z.infer<typeof pilotTimeWindowSchema>;

/**
 * Critères du chauffeur. Un critère nul ou une liste vide ne filtre rien. Gain net = tarif du chauffeur (aucune
 * commission) moins son coût variable estimé par kilomètre, rapporté aux kilomètres et au temps totaux, approche comprise.
 */
export const pilotCriteriaSchema = z.object({
  minFareCents: z.number().int().min(0).max(100_000).nullable().default(null),
  minNetPerKmCents: z.number().int().min(0).max(10_000).nullable().default(null),
  minNetPerHourCents: z.number().int().min(0).max(100_000).nullable().default(null),
  /** Coût variable estimé du véhicule par kilomètre (énergie, usure), retranché du tarif pour le gain net. */
  costPerKmCents: z.number().int().min(0).max(500).default(0),
  maxPickupMeters: z.number().int().min(0).max(100_000).nullable().default(null),
  maxPickupMinutes: z.number().int().min(0).max(180).nullable().default(null),
  maxDurationMinutes: z.number().int().min(1).max(600).nullable().default(null),
  /** Plages horaires et jours ; vide : à toute heure. */
  timeWindows: z.array(pilotTimeWindowSchema).max(14).default([]),
  /** Zones de départ et d'arrivée admises (codes de zone) ; vide : toutes. Une exclusion est surveillée (discrimination indirecte). */
  originZones: z.array(zoneCode).max(30).default([]),
  destinationZones: z.array(zoneCode).max(30).default([]),
  categories: z.array(z.enum(VEHICLE_CATEGORIES)).max(VEHICLE_CATEGORIES.length).default([]),
  /** Note moyenne minimale du client (donnée par les chauffeurs) ; un client sans note n'est jamais écarté. */
  minClientRating: z.number().min(1).max(5).nullable().default(null),
  /** Marge, en minutes, à garder autour des réservations déjà planifiées. */
  scheduleMarginMinutes: z.number().int().min(0).max(240).default(30),
  /**
   * Mode « multi-applications déclaré » : réservations planifiées seulement, seuils minimaux relevés de
   * `pilot.multi_app_factor`, fenêtre de réponse allongée (`pilot.multi_app_response_seconds`).
   */
  multiAppMode: z.boolean().default(false),
});
export type PilotCriteria = z.infer<typeof pilotCriteriaSchema>;
export type PilotCriteriaInput = z.input<typeof pilotCriteriaSchema>;

export const DEFAULT_PILOT_CRITERIA: Readonly<PilotCriteria> = Object.freeze(pilotCriteriaSchema.parse({}));

/** Critères enregistrés (JSON) ; `null` si le contenu est invalide : Pilote n'accepte alors rien automatiquement. */
export function parsePilotCriteria(raw: unknown): PilotCriteria | null {
  const parsed = pilotCriteriaSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : null;
}

const minutesOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Vrai si l'instant tombe dans une des plages (heure locale) ; aucune plage : toujours. */
export function withinTimeWindows(at: Date, windows: readonly PilotTimeWindow[], timeZone: string): boolean {
  if (!windows.length) return true;
  const { weekday, hour, minute } = localTimeParts(at, timeZone);
  const now = hour * 60 + minute;
  const previous = (weekday + 6) % 7;
  return windows.some((w) => {
    const from = minutesOf(w.from);
    const to = minutesOf(w.to);
    if (from < to) return w.days.includes(weekday) && now >= from && now < to;
    return (w.days.includes(weekday) && now >= from) || (w.days.includes(previous) && now < to);
  });
}

/** Zone connue (code et type de `zones`). */
export interface PilotZone {
  code: string;
  type: string;
}

/**
 * Zones exclues par une liste de zones admises : les zones connues absentes de la liste, l'aire de service exceptée ;
 * une liste vide, ou qui contient l'aire de service, n'exclut rien.
 */
export function excludedZones(admitted: readonly string[], zones: readonly PilotZone[]): string[] {
  if (!admitted.length || zones.some((z) => z.type === 'service_area' && admitted.includes(z.code))) return [];
  return zones.filter((z) => z.type !== 'service_area' && !admitted.includes(z.code)).map((z) => z.code).sort();
}

export interface PilotZoneExclusions {
  origin: string[];
  destination: string[];
}

export function pilotZoneExclusions(criteria: Pick<PilotCriteria, 'originZones' | 'destinationZones'>, zones: readonly PilotZone[]): PilotZoneExclusions {
  return { origin: excludedZones(criteria.originZones, zones), destination: excludedZones(criteria.destinationZones, zones) };
}

/** Zones surveillées (`pilot.watched_zones`) exclues au départ ou à l'arrivée. */
export function watchedZonesExcluded(exclusions: PilotZoneExclusions, watched: readonly string[]): string[] {
  return [...new Set([...exclusions.origin, ...exclusions.destination])].filter((z) => watched.includes(z)).sort();
}

/** Réglage `pilot.watched_zones` : codes de zone valides seulement, sans doublon. */
export function parseWatchedZones(raw: unknown): string[] {
  return Array.isArray(raw) ? [...new Set(raw.filter((z): z is string => typeof z === 'string' && ZONE_CODE.test(z)))] : [];
}

/** Offre telle que Pilote l'évalue (lue par l'API sur l'offre, la course et le client). */
export interface PilotOffer {
  rideType: 'immediate' | 'scheduled';
  /** Proposition du client en négociation : jamais acceptée automatiquement. */
  negotiation: boolean;
  category: VehicleCategory;
  driverFareCents: number;
  /** Approche (distance et temps jusqu'au client) ; inconnue pour une réservation. */
  pickupMeters: number | null;
  pickupSeconds: number | null;
  /** Trajet estimé au devis. */
  tripMeters: number | null;
  tripSeconds: number | null;
  /** Heure de prise en charge (réservation) ou de l'offre (immédiate). */
  pickupAt: Date;
  /** Codes des zones qui contiennent le départ et l'arrivée. */
  originZones: readonly string[];
  destinationZones: readonly string[];
  /** Note moyenne donnée au client par les chauffeurs ; null sans note. */
  clientRating: number | null;
  /** Garde-fous : jamais refusée par les critères (au pire, décision manuelle). */
  assistanceAnimal: boolean;
  accessibility: boolean;
}

export interface PilotContext {
  timeZone: string;
  /** Facteur des seuils minimaux en mode multi-applications (`pilot.multi_app_factor`, 1,25). */
  multiAppFactor: number;
  /** Écart toléré (en %) sur un seuil chiffré pour un score jaune plutôt que rouge (`pilot.near_miss_percent`, 10). */
  nearMissPercent: number;
  /** Réservations déjà attribuées au chauffeur : début et fin estimée. */
  planned: ReadonlyArray<{ startsAt: Date; endsAt: Date }>;
}

export interface PilotReason {
  code: PilotReasonCode;
  /** Valeurs utiles à l'affichage (montants en cents, minutes, mètres, codes de zone, date ISO). */
  params?: Record<string, number | string | string[]>;
  /** Signalée à la surveillance de la discrimination indirecte (exclusion de zone). */
  monitored?: true;
}

export interface PilotMetrics {
  netCents: number;
  netPerKmCents: number | null;
  netPerHourCents: number | null;
  totalMeters: number | null;
  totalSeconds: number | null;
}

export interface PilotEvaluation {
  decision: PilotDecision;
  score: PilotScore;
  reasons: PilotReason[];
  metrics: PilotMetrics;
}

const SCORE_OF: Record<PilotDecision, PilotScore> = { accept: 'green', manual: 'yellow', reject: 'red' };

/** Gain net, au kilomètre et à l'heure, approche comprise ; null quand le trajet est inconnu ou nul. */
export function pilotMetrics(offer: Pick<PilotOffer, 'driverFareCents' | 'pickupMeters' | 'pickupSeconds' | 'tripMeters' | 'tripSeconds'>, costPerKmCents: number): PilotMetrics {
  const totalMeters = offer.tripMeters === null ? null : offer.tripMeters + (offer.pickupMeters ?? 0);
  const totalSeconds = offer.tripSeconds === null ? null : offer.tripSeconds + (offer.pickupSeconds ?? 0);
  const netCents = offer.driverFareCents - (totalMeters === null ? 0 : Math.round((costPerKmCents * totalMeters) / 1000));
  return {
    netCents,
    netPerKmCents: totalMeters ? Math.round((netCents * 1000) / totalMeters) : null,
    netPerHourCents: totalSeconds ? Math.round((netCents * 3600) / totalSeconds) : null,
    totalMeters,
    totalSeconds,
  };
}

/** Première réservation planifiée qui chevauche la course (marge comprise), ou null. */
export function scheduleConflict(offer: Pick<PilotOffer, 'pickupAt' | 'tripSeconds'>, marginMinutes: number, planned: PilotContext['planned']): Date | null {
  const margin = Math.max(0, marginMinutes) * 60_000;
  const start = offer.pickupAt.getTime();
  const end = start + Math.max(0, offer.tripSeconds ?? 0) * 1000;
  const hit = planned.find((p) => start < p.endsAt.getTime() + margin && p.startsAt.getTime() < end + margin);
  return hit ? hit.startsAt : null;
}

/**
 * Évalue une offre selon les critères du chauffeur. Un critère chiffré manqué de peu (`nearMissPercent`) ou une donnée
 * manquante donne `manual` ; tout autre critère manqué donne `reject`. Garde-fous : une demande avec animal d'assistance
 * ou besoin d'accessibilité n'est jamais rejetée par les critères (au pire `manual`) ; en mode multi-applications, une
 * course immédiate est toujours `manual` ; une proposition de négociation n'est jamais acceptée automatiquement. Une
 * zone non admise est signalée (`monitored`) pour la surveillance de la discrimination indirecte.
 */
export function evaluateOffer(offer: PilotOffer, criteria: PilotCriteria | null, context: PilotContext): PilotEvaluation {
  const metrics = pilotMetrics(offer, criteria?.costPerKmCents ?? 0);
  if (!criteria) return { decision: 'manual', score: 'yellow', reasons: [{ code: 'criteria_invalid' }], metrics };
  const reasons: PilotReason[] = [];
  const missing = new Set<string>();
  let hard = false;
  let soft = false;
  const tolerance = Math.max(0, context.nearMissPercent) / 100;
  const factor = criteria.multiAppMode ? Math.max(1, context.multiAppFactor) : 1;
  const immediate = offer.rideType === 'immediate';
  const fail = (code: PilotReasonCode, near: boolean, params: Record<string, number>) => {
    if (near) soft = true;
    else hard = true;
    reasons.push({ code, params });
  };
  const atLeast = (code: PilotReasonCode, value: number | null, min: number | null, field: string) => {
    if (min === null) return;
    if (value === null) {
      missing.add(field);
      return;
    }
    const threshold = Math.ceil(min * factor);
    if (value < threshold) fail(code, value >= threshold * (1 - tolerance), { value, min: threshold });
  };
  const atMost = (code: PilotReasonCode, value: number | null, max: number | null, field: string, required: boolean) => {
    if (max === null) return;
    if (value === null) {
      if (required) missing.add(field);
      return;
    }
    if (value > max) fail(code, value <= max * (1 + tolerance), { value, max });
  };
  const hardReason = (reason: PilotReason) => {
    hard = true;
    reasons.push(reason);
  };

  atLeast('fare_below_min', offer.driverFareCents, criteria.minFareCents, 'fare');
  atLeast('net_per_km_below_min', metrics.netPerKmCents, criteria.minNetPerKmCents, 'distance');
  atLeast('net_per_hour_below_min', metrics.netPerHourCents, criteria.minNetPerHourCents, 'duration');
  // Approche inconnue d'une réservation : le chauffeur se rendra au départ pour l'heure dite ; exigée pour une immédiate.
  atMost('pickup_too_far', offer.pickupMeters, criteria.maxPickupMeters, 'pickup', immediate);
  atMost('pickup_too_long', offer.pickupSeconds === null ? null : Math.ceil(offer.pickupSeconds / 60), criteria.maxPickupMinutes, 'pickup', immediate);
  atMost('duration_too_long', offer.tripSeconds === null ? null : Math.ceil(offer.tripSeconds / 60), criteria.maxDurationMinutes, 'duration', true);
  if (!withinTimeWindows(offer.pickupAt, criteria.timeWindows, context.timeZone)) hardReason({ code: 'outside_hours' });
  if (criteria.originZones.length && !offer.originZones.some((z) => criteria.originZones.includes(z))) {
    hardReason({ code: 'origin_zone_not_admitted', params: { zones: [...offer.originZones] }, monitored: true });
  }
  if (criteria.destinationZones.length && !offer.destinationZones.some((z) => criteria.destinationZones.includes(z))) {
    hardReason({ code: 'destination_zone_not_admitted', params: { zones: [...offer.destinationZones] }, monitored: true });
  }
  if (criteria.categories.length && !criteria.categories.includes(offer.category)) hardReason({ code: 'category_not_admitted', params: { category: offer.category } });
  if (criteria.minClientRating !== null && offer.clientRating !== null && offer.clientRating < criteria.minClientRating) {
    hardReason({ code: 'client_rating_below_min', params: { rating: offer.clientRating, min: criteria.minClientRating } });
  }
  const conflict = scheduleConflict(offer, criteria.scheduleMarginMinutes, context.planned);
  if (conflict) hardReason({ code: 'schedule_conflict', params: { startsAt: conflict.toISOString() } });
  if (missing.size) {
    soft = true;
    reasons.push({ code: 'data_missing', params: { fields: [...missing].sort() } });
  }

  let decision: PilotDecision = hard ? 'reject' : soft ? 'manual' : 'accept';
  if (decision === 'reject' && (offer.assistanceAnimal || offer.accessibility)) {
    decision = 'manual';
    const kinds = [...(offer.assistanceAnimal ? ['assistance_animal'] : []), ...(offer.accessibility ? ['accessibility'] : [])];
    reasons.push({ code: 'protected_request', params: { kinds } });
  }
  if (criteria.multiAppMode && immediate) {
    decision = 'manual';
    reasons.push({ code: 'multi_app_immediate' });
  } else if (offer.negotiation && decision === 'accept') {
    decision = 'manual';
    reasons.push({ code: 'negotiation_offer' });
  }
  if (decision === 'accept') reasons.push({ code: 'criteria_met' });
  return { decision, score: SCORE_OF[decision], reasons, metrics };
}

// --- Critères de la flotte (finalisation du 3 octobre 2026 : « critères du chauffeur ou de la flotte », amendement v1.2 section 7) ---

/**
 * Critères Pilote d'une organisation pour ses chauffeurs : `off` (seuls les critères du chauffeur), `default` (ceux de la
 * flotte tant que le chauffeur n'a réglé aucun critère), `minimum` (les deux s'appliquent : Pilote n'accepte que ce que
 * les deux admettent). Ils ne changent que la décision de Pilote pour le chauffeur, jamais l'ordre des offres de la
 * répartition ni les chauffeurs sollicités.
 */
export const FLEET_PILOT_MODES = ['off', 'default', 'minimum'] as const;
export type FleetPilotMode = (typeof FLEET_PILOT_MODES)[number];

const fleetPilotCriteriaSchema = pilotCriteriaSchema.omit({ multiAppMode: true });

export const fleetPilotSettingsSchema = z.object({
  mode: z.enum(FLEET_PILOT_MODES).default('off'),
  /** Mêmes critères que ceux d'un chauffeur ; le mode multi-applications reste celui du chauffeur. */
  criteria: fleetPilotCriteriaSchema.default(() => fleetPilotCriteriaSchema.parse({})),
});
export type FleetPilotSettings = z.infer<typeof fleetPilotSettingsSchema>;
export type FleetPilotSettingsInput = z.input<typeof fleetPilotSettingsSchema>;

/** Réglage enregistré (`organizations.settings.pilot`) ; absent ou illisible : `off`. */
export function parseFleetPilotSettings(raw: unknown): FleetPilotSettings {
  const parsed = fleetPilotSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : fleetPilotSettingsSchema.parse({});
}

/** Le chauffeur n'a réglé aucun critère (tous ceux de départ, mode multi-applications mis à part). */
export function isDefaultPilotCriteria(criteria: PilotCriteria): boolean {
  const { multiAppMode: _mine, ...rest } = criteria;
  const { multiAppMode: _default, ...defaults } = DEFAULT_PILOT_CRITERIA;
  return JSON.stringify(rest) === JSON.stringify(defaults);
}

const DECISION_RANK: Record<PilotDecision, number> = { accept: 0, manual: 1, reject: 2 };

/**
 * Évaluation d'une offre avec les critères du chauffeur et ceux de sa flotte. `minimum` : la décision la plus prudente des
 * deux (refus, sinon décision manuelle, sinon acceptation), avec les raisons de chaque refus ou réserve ; les mesures sont
 * celles du chauffeur (son coût au kilomètre).
 */
export function evaluateOfferWithFleet(offer: PilotOffer, driverCriteria: PilotCriteria | null, fleet: FleetPilotSettings | null, context: PilotContext): PilotEvaluation {
  if (!fleet || fleet.mode === 'off' || !driverCriteria) return evaluateOffer(offer, driverCriteria, context);
  const fleetCriteria: PilotCriteria = { ...fleet.criteria, multiAppMode: driverCriteria.multiAppMode };
  if (fleet.mode === 'default') return evaluateOffer(offer, isDefaultPilotCriteria(driverCriteria) ? fleetCriteria : driverCriteria, context);
  const mine = evaluateOffer(offer, driverCriteria, context);
  const theirs = evaluateOffer(offer, fleetCriteria, context);
  const decision = DECISION_RANK[theirs.decision] > DECISION_RANK[mine.decision] ? theirs.decision : mine.decision;
  if (decision === 'accept') return mine;
  const seen = new Set<string>();
  const reasons = [...mine.reasons, ...theirs.reasons].filter((r) => {
    if (r.code === 'criteria_met') return false;
    const key = `${r.code}:${JSON.stringify(r.params ?? {})}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { decision, score: SCORE_OF[decision], reasons, metrics: mine.metrics };
}
