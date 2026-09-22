/**
 * Moteur des packs de courses. Fonctions pures, montants en cents, dates en instants UTC.
 * Aucun tarif ni seuil ici : ils viennent des tables `packs` et `settings`.
 * Référence : cahier des charges, section 5.7.
 */

export interface PackDefinition {
  code: string;
  /** `null` pour Illimité. */
  ridesIncluded: number | null;
  priceCents: number;
  validityDays: number;
  /** Découverte : offert (prix 0) aux 100 premiers chauffeurs et aux locataires R-LuxeEV, une fois par chauffeur. */
  discovery: boolean;
  /** Illimité : bonus de score sur les courses VIP, aéroport et entreprises. */
  priorityBonus: boolean;
}

export type PackPurchaseStatus = 'active' | 'exhausted' | 'expired' | 'cancelled';

export interface PackPurchase {
  id: string;
  driverId: string;
  packCode: string;
  ridesIncluded: number | null;
  /** Courses restantes du pack lui-même. */
  ridesRemaining: number;
  /** Courses reportées d'un pack précédent ; consommées en premier, jamais reportées une seconde fois. */
  carriedOverRemaining: number;
  activatedAt: Date;
  expiresAt: Date;
  status: PackPurchaseStatus;
  autoRenew: boolean;
  /** Pack à activer à l'épuisement quand le chauffeur change de pack. */
  nextPackCode: string | null;
  /** Vrai une fois le report de ce pack effectué ; le report n'a lieu qu'une seule fois. */
  rolloverDone: boolean;
  billing: 'to_bill' | 'billed' | 'free';
}

export interface PackSettings {
  /** Alerte `pack.low` quand il reste ce nombre de courses. */
  lowThreshold: number;
  /** Délai, en jours, pendant lequel un pack suivant reçoit le report du précédent. */
  rolloverWindowDays: number;
  discoveryFirstDrivers: number;
}

export interface DriverPackProfile {
  driverId: string;
  isRLuxeEvTenant: boolean;
  discoveryUsed: boolean;
  /** Rang d'inscription du chauffeur, à partir de 1. */
  signupRank: number;
}

export type ConsumeEvent = 'pack.low' | 'pack.exhausted';

export interface ConsumeResult {
  purchases: PackPurchase[];
  consumedFromId: string | null;
  events: ConsumeEvent[];
}

const DAY_MS = 86_400_000;

export function remainingRides(p: PackPurchase): number | null {
  return p.ridesIncluded === null ? null : p.ridesRemaining + p.carriedOverRemaining;
}

export function isUsable(p: PackPurchase, now: Date): boolean {
  if (p.status !== 'active' || p.expiresAt.getTime() <= now.getTime()) return false;
  return p.ridesIncluded === null || remainingRides(p)! > 0;
}

/** Pack actif le plus ancien non expiré et non épuisé. */
export function activePack(purchases: PackPurchase[], now: Date): PackPurchase | null {
  return [...purchases].filter((p) => isUsable(p, now)).sort((a, b) => a.activatedAt.getTime() - b.activatedAt.getTime())[0] ?? null;
}

/** Un chauffeur sans pack utilisable ni renouvellement automatique ne reçoit pas d'offres. */
export function canReceiveOffers(purchases: PackPurchase[], now: Date): { ok: boolean; reason: 'no_pack' | 'exhausted' | 'expired' | null } {
  if (activePack(purchases, now)) return { ok: true, reason: null };
  const renewing = purchases.find((p) => p.status !== 'cancelled' && p.autoRenew);
  if (renewing) return { ok: true, reason: null };
  const latest = [...purchases].filter((p) => p.status !== 'cancelled').sort((a, b) => b.activatedAt.getTime() - a.activatedAt.getTime())[0];
  if (!latest) return { ok: false, reason: 'no_pack' };
  return { ok: false, reason: latest.expiresAt.getTime() <= now.getTime() ? 'expired' : 'exhausted' };
}

/** Une course terminée consomme une unité du pack actif le plus ancien ; annulations et non-présentations ne consomment rien. */
export function consumeRide(purchases: PackPurchase[], rideStatus: string, now: Date, settings: PackSettings): ConsumeResult {
  if (rideStatus !== 'completed') return { purchases, consumedFromId: null, events: [] };
  const pack = activePack(purchases, now);
  if (!pack) return { purchases, consumedFromId: null, events: [] };
  if (pack.ridesIncluded === null) return { purchases, consumedFromId: pack.id, events: [] };
  const updated: PackPurchase = pack.carriedOverRemaining > 0
    ? { ...pack, carriedOverRemaining: pack.carriedOverRemaining - 1 }
    : { ...pack, ridesRemaining: pack.ridesRemaining - 1 };
  const left = remainingRides(updated)!;
  const events: ConsumeEvent[] = [];
  if (left === 0) { updated.status = 'exhausted'; events.push('pack.exhausted'); }
  else if (left === settings.lowThreshold) events.push('pack.low');
  return { purchases: purchases.map((p) => (p.id === pack.id ? updated : p)), consumedFromId: pack.id, events };
}

/** Passe en `expired` les packs actifs dont la date est dépassée. */
export function expirePacks(purchases: PackPurchase[], now: Date): PackPurchase[] {
  return purchases.map((p) => (p.status === 'active' && p.expiresAt.getTime() <= now.getTime() ? { ...p, status: 'expired' } : p));
}

/**
 * Report, une seule fois, des courses non utilisées d'un pack expiré sur le pack suivant du même chauffeur,
 * si celui-ci est activé dans le délai. Les courses déjà reportées ne se reportent pas une seconde fois.
 */
export function rolloverOnExpiry(expired: PackPurchase, next: PackPurchase, settings: PackSettings): { expired: PackPurchase; next: PackPurchase; rolledOver: number } {
  const none = { expired, next, rolledOver: 0 };
  if (expired.status !== 'expired' || expired.rolloverDone || expired.ridesIncluded === null || next.ridesIncluded === null) return none;
  if (expired.driverId !== next.driverId || next.status !== 'active') return none;
  const delay = next.activatedAt.getTime() - expired.expiresAt.getTime();
  if (delay < 0 || delay > settings.rolloverWindowDays * DAY_MS) return none;
  const rides = expired.ridesRemaining;
  if (rides === 0) return { expired: { ...expired, rolloverDone: true }, next, rolledOver: 0 };
  return {
    expired: { ...expired, ridesRemaining: 0, rolloverDone: true },
    next: { ...next, carriedOverRemaining: next.carriedOverRemaining + rides },
    rolledOver: rides,
  };
}

/** Renouvellement automatique : à l'épuisement, ou à l'expiration pour Illimité, si l'option est active. */
export function shouldAutoRenew(p: PackPurchase, now: Date): boolean {
  if (!p.autoRenew || p.status === 'cancelled') return false;
  if (p.ridesIncluded === null) return p.expiresAt.getTime() <= now.getTime();
  return p.status === 'exhausted' || (p.status === 'expired');
}

/** Pack à activer au renouvellement : le pack demandé en changement, sinon le même. */
export function renewalPackCode(p: PackPurchase): string {
  return p.nextPackCode ?? p.packCode;
}

/** Prix d'activation : Découverte est offert aux premiers chauffeurs et aux locataires R-LuxeEV, une seule fois. */
export function activationPriceCents(pack: PackDefinition, profile: DriverPackProfile, settings: PackSettings): { priceCents: number; free: boolean; allowed: boolean; reason: 'discovery_already_used' | null } {
  if (!pack.discovery) return { priceCents: pack.priceCents, free: false, allowed: true, reason: null };
  if (profile.discoveryUsed) return { priceCents: pack.priceCents, free: false, allowed: false, reason: 'discovery_already_used' };
  const free = profile.isRLuxeEvTenant || profile.signupRank <= settings.discoveryFirstDrivers;
  return { priceCents: free ? 0 : pack.priceCents, free, allowed: true, reason: null };
}

/** Crée un achat actif immédiatement, facturé sur le relevé suivant (jamais d'avance). */
export function activatePack(id: string, driverId: string, pack: PackDefinition, priceCents: number, now: Date, autoRenew: boolean): PackPurchase {
  return {
    id, driverId, packCode: pack.code, ridesIncluded: pack.ridesIncluded,
    ridesRemaining: pack.ridesIncluded ?? 0, carriedOverRemaining: 0,
    activatedAt: now, expiresAt: new Date(now.getTime() + pack.validityDays * DAY_MS),
    status: 'active', autoRenew, nextPackCode: null, rolloverDone: false,
    billing: priceCents === 0 ? 'free' : 'to_bill',
  };
}
