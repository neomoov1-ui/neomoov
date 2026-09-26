/**
 * Moteur de règles des promotions (section 5.9, prompt 08), sans effet de bord : une promotion est une donnée (table
 * `promotions`), évaluée au devis contre le contexte de la course et l'usage déjà fait, puis revalidée à la fin de
 * course. Le code ne contient aucun montant. La remise elle-même est calculée par le moteur de devis
 * (`applyPromotion`) à partir de la promotion traduite par `toQuotePromotion`.
 */
import type { PromotionType } from '../enums.js';
import type { Promotion } from '../pricing/types.js';

/** Conditions d'une promotion (colonne JSON `conditions`), toutes facultatives. */
export interface PromotionConditions {
  /** Réservée à la première course du client. */
  firstRideOnly?: boolean;
  /** Distance maximale de la course, en mètres (troisième course offerte jusqu'à 10 km). */
  maxDistanceMeters?: number;
  /** Catégories admissibles. */
  categories?: string[];
  /** Zones admissibles (code de zone de l'origine ou de la destination). */
  zones?: string[];
  /** Plage horaire à l'heure de Montréal : jours (0 dimanche à 6 samedi) et minutes du jour [début, fin[. */
  timeWindow?: { daysOfWeek?: number[]; startMinute: number; endMinute: number };
  /** Nombre maximal de clients distincts (LANCEMENT30 : 1 000 clients). */
  maxClients?: number;
  /** Appliquée sans code quand elle est admissible (troisième et dixième courses). */
  autoApply?: boolean;
}

export interface PromotionRecord {
  code: string;
  type: PromotionType;
  /** `percent` : points de base (3000 = 30 %) ; `fixed` : cents ; `nth_ride` : rang de la course ; `free_ride` : ignoré. */
  value: number;
  maxDiscountCents: number | null;
  conditions: PromotionConditions;
  waivesFees: boolean;
  globalLimit: number | null;
  perClientLimit: number;
  budgetCents: number | null;
  spentCents: number;
  validFrom: Date;
  validTo: Date | null;
  active: boolean;
}

/** Usage déjà fait de la promotion (lignes `promotion_uses`, courses annulées exclues). */
export interface PromotionUsage {
  globalUses: number;
  clientUses: number;
  distinctClients: number;
}

export interface PromotionContext {
  now: Date;
  category: string;
  distanceMeters: number;
  originZone: string | null;
  destinationZone: string | null;
  /** Heure de prise en charge à Montréal : jour de la semaine (0 à 6) et minute du jour (0 à 1439). */
  pickupLocal: { dayOfWeek: number; minuteOfDay: number };
  /** Courses déjà terminées par le client (la course évaluée sera la suivante). */
  clientCompletedRides: number;
  usage: PromotionUsage;
}

export const PROMOTION_REFUSALS = [
  'inactive', 'not_started', 'expired', 'budget_exhausted', 'global_limit', 'client_limit', 'max_clients', 'first_ride_only', 'wrong_rank', 'distance', 'category', 'zone', 'time_window',
] as const;
export type PromotionRefusal = (typeof PROMOTION_REFUSALS)[number];

export type PromotionEvaluation = { ok: true; promotion: Promotion } | { ok: false; reason: PromotionRefusal };

/** Traduction pour le moteur de devis (qui calcule la remise et vérifie aussi distance, catégorie et rang). */
export function toQuotePromotion(record: PromotionRecord): Promotion {
  const c = record.conditions;
  const common = {
    code: record.code,
    ...(c.maxDistanceMeters !== undefined ? { maxDistanceMeters: c.maxDistanceMeters } : {}),
    ...(c.categories ? { categories: c.categories } : {}),
    ...(record.maxDiscountCents !== null ? { maxDiscountCents: record.maxDiscountCents } : {}),
  };
  switch (record.type) {
    case 'percent':
      return { ...common, kind: 'percent', percentBps: record.value };
    case 'fixed':
      return { ...common, kind: 'fixed', fixedCents: record.value };
    case 'nth_ride':
      return { ...common, kind: 'free_ride', nthRide: record.value, waivesFees: record.waivesFees };
    case 'free_ride':
      return { ...common, kind: 'free_ride', waivesFees: record.waivesFees };
  }
}

/** Évalue une promotion : la première règle non respectée donne le motif du refus. */
export function evaluatePromotion(record: PromotionRecord, ctx: PromotionContext): PromotionEvaluation {
  const refuse = (reason: PromotionRefusal): PromotionEvaluation => ({ ok: false, reason });
  const c = record.conditions;
  if (!record.active) return refuse('inactive');
  if (ctx.now < record.validFrom) return refuse('not_started');
  if (record.validTo && ctx.now >= record.validTo) return refuse('expired');
  if (record.budgetCents !== null && record.spentCents >= record.budgetCents) return refuse('budget_exhausted');
  if (record.globalLimit !== null && ctx.usage.globalUses >= record.globalLimit) return refuse('global_limit');
  if (ctx.usage.clientUses >= record.perClientLimit) return refuse('client_limit');
  // Limite de clients distincts : un client qui a déjà utilisé la promotion en fait déjà partie.
  if (c.maxClients !== undefined && ctx.usage.clientUses === 0 && ctx.usage.distinctClients >= c.maxClients) return refuse('max_clients');
  if (c.firstRideOnly && ctx.clientCompletedRides > 0) return refuse('first_ride_only');
  if (record.type === 'nth_ride' && ctx.clientCompletedRides + 1 !== record.value) return refuse('wrong_rank');
  if (c.maxDistanceMeters !== undefined && ctx.distanceMeters > c.maxDistanceMeters) return refuse('distance');
  if (c.categories && !c.categories.includes(ctx.category)) return refuse('category');
  if (c.zones && !c.zones.some((z) => z === ctx.originZone || z === ctx.destinationZone)) return refuse('zone');
  if (c.timeWindow && !inWindow(c.timeWindow, ctx.pickupLocal)) return refuse('time_window');
  return { ok: true, promotion: toQuotePromotion(record) };
}

function inWindow(window: NonNullable<PromotionConditions['timeWindow']>, at: PromotionContext['pickupLocal']): boolean {
  if (window.daysOfWeek && !window.daysOfWeek.includes(at.dayOfWeek)) return false;
  // Plage qui passe minuit (22 h à 2 h) : début après la fin.
  return window.startMinute <= window.endMinute ? at.minuteOfDay >= window.startMinute && at.minuteOfDay < window.endMinute : at.minuteOfDay >= window.startMinute || at.minuteOfDay < window.endMinute;
}

/**
 * Promotion appliquée sans code (troisième, dixième course) : la première admissible dans l'ordre donné (celui des
 * données). Une promotion avec code demandée par le client passe avant (le moteur n'en applique qu'une par course).
 */
export function pickAutoPromotion(records: readonly PromotionRecord[], contextFor: (record: PromotionRecord) => PromotionContext): { record: PromotionRecord; promotion: Promotion } | null {
  for (const record of records) {
    if (!record.conditions.autoApply) continue;
    const evaluation = evaluatePromotion(record, contextFor(record));
    if (evaluation.ok) return { record, promotion: evaluation.promotion };
  }
  return null;
}
