/**
 * Répartition (section 5.4) : score des candidats, sélection d'une vague et rayons de recherche successifs.
 * Fonctions pures : l'appelant filtre les candidats (statut, catégorie, documents, pack, solde, rayon), fournit les temps
 * d'arrivée (matrice) et charge les poids depuis `settings` (`dispatch.score_weights`). Plus le score est petit, meilleur
 * est le candidat.
 */

export interface DispatchWeights {
  /** Coefficient des minutes de temps d'arrivée (0,55). */
  eta: number;
  /** Coefficient de (5 − note) × 4 (0,20). */
  rating: number;
  /** Coefficient de la pénalité d'équité (0,15). */
  fairness: number;
  /** Coefficient du déséquilibre de zone (0,10). */
  zone: number;
  /** Retranché quand le chauffeur favori demandé est disponible (100). */
  favouriteBonus: number;
  /** Retranché pour un autre favori du client (D37 : repli sur un autre favori avant le score) (50). */
  otherFavouriteBonus: number;
  /** Retranché pour un chauffeur Illimité sur une course VIP, aéroport ou entreprise (5). */
  unlimitedBonus: number;
  /** Minutes sans course après lesquelles la pénalité d'équité tombe à zéro (20). */
  fairnessDecayMinutes: number;
}

export const DEFAULT_DISPATCH_WEIGHTS: Readonly<DispatchWeights> = Object.freeze({
  eta: 0.55, rating: 0.2, fairness: 0.15, zone: 0.1, favouriteBonus: 100, otherFavouriteBonus: 50, unlimitedBonus: 5, fairnessDecayMinutes: 20,
});

const WEIGHT_KEYS = Object.keys(DEFAULT_DISPATCH_WEIGHTS) as Array<keyof DispatchWeights>;

/** Poids depuis un réglage : objet partiel, clés inconnues ignorées, valeurs absentes ou invalides remplacées par le défaut. */
export function parseDispatchWeights(value: unknown): DispatchWeights {
  const source = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const weights: DispatchWeights = { ...DEFAULT_DISPATCH_WEIGHTS };
  for (const key of WEIGHT_KEYS) {
    const raw = source[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) weights[key] = raw;
  }
  return weights;
}

export interface DispatchCandidate {
  driverId: string;
  /** Temps d'arrivée estimé en secondes (matrice), null si inconnu (chauffeur hors ligne pour une planifiée). */
  etaSeconds: number | null;
  /** Distance à vol d'oiseau en mètres, repli quand le temps d'arrivée manque. */
  distanceMeters: number | null;
  /** Note moyenne sur 5. */
  rating: number;
  /** Minutes écoulées depuis la dernière course terminée (ou depuis le passage en ligne). */
  idleMinutes: number;
  /** Déséquilibre de la zone du chauffeur, de 0 (bien servie) à 10 (sous-servie) : on évite d'y prélever un chauffeur. */
  zoneImbalance: number;
  /** Favori demandé par le client sur cette course. */
  isRequestedFavourite: boolean;
  /** Autre chauffeur favori du client (« Mes chauffeurs »). */
  isClientFavourite: boolean;
  isUnlimited: boolean;
}

export interface DispatchContext {
  /** Course VIP, aéroport ou entreprise : bonus Illimité. */
  premiumContext: boolean;
  /** Vitesse moyenne (m/s) pour estimer un temps d'arrivée à partir de la distance quand la matrice manque. */
  fallbackSpeedMps: number;
}

export interface ScoredCandidate extends DispatchCandidate {
  etaMinutes: number;
  score: number;
}

/** Pénalité d'équité : 10 pour un chauffeur qui vient de finir une course, 0 après `decayMinutes` sans course. */
export function fairnessPenalty(idleMinutes: number, decayMinutes: number): number {
  if (decayMinutes <= 0) return 0;
  return 10 * Math.max(0, 1 - Math.max(0, idleMinutes) / decayMinutes);
}

export function etaMinutesOf(candidate: Pick<DispatchCandidate, 'etaSeconds' | 'distanceMeters'>, context: DispatchContext): number {
  if (candidate.etaSeconds !== null) return Math.max(0, candidate.etaSeconds) / 60;
  if (candidate.distanceMeters !== null && context.fallbackSpeedMps > 0) return Math.max(0, candidate.distanceMeters) / context.fallbackSpeedMps / 60;
  return 0;
}

/** Formule de la section 5.4, poids paramétrés. */
export function scoreCandidate(candidate: DispatchCandidate, context: DispatchContext, weights: DispatchWeights = DEFAULT_DISPATCH_WEIGHTS): ScoredCandidate {
  const etaMinutes = etaMinutesOf(candidate, context);
  const rating = Math.min(5, Math.max(0, candidate.rating));
  const zone = Math.min(10, Math.max(0, candidate.zoneImbalance));
  let score = weights.eta * etaMinutes + weights.rating * (5 - rating) * 4 + weights.fairness * fairnessPenalty(candidate.idleMinutes, weights.fairnessDecayMinutes) + weights.zone * zone;
  if (candidate.isRequestedFavourite) score -= weights.favouriteBonus;
  else if (candidate.isClientFavourite) score -= weights.otherFavouriteBonus;
  if (candidate.isUnlimited && context.premiumContext) score -= weights.unlimitedBonus;
  return { ...candidate, etaMinutes, score: Math.round(score * 1000) / 1000 };
}

/** Candidats classés du meilleur au moins bon (score, puis temps d'arrivée, puis identifiant pour un ordre stable). */
export function scoreCandidates(candidates: readonly DispatchCandidate[], context: DispatchContext, weights: DispatchWeights = DEFAULT_DISPATCH_WEIGHTS): ScoredCandidate[] {
  return candidates.map((c) => scoreCandidate(c, context, weights)).sort((a, b) => a.score - b.score || a.etaMinutes - b.etaMinutes || a.driverId.localeCompare(b.driverId));
}

/** Les `waveSize` meilleurs candidats d'une vague. */
export function selectWave<T>(scored: readonly T[], waveSize: number): T[] {
  return scored.slice(0, Math.max(0, Math.floor(waveSize)));
}

/** Rayon de recherche en mètres ; `null` = toute la zone de service. */
export type SearchRadius = number | null;

export const DEFAULT_SEARCH_RADII: readonly SearchRadius[] = Object.freeze([2000, 5000, 10_000, null]);

/** Lit la liste des rayons depuis un réglage : nombres positifs ou null, dans l'ordre ; défaut 2, 5, 10 km puis la zone. */
export function parseSearchRadii(value: unknown): SearchRadius[] {
  if (!Array.isArray(value)) return [...DEFAULT_SEARCH_RADII];
  const radii = value.filter((v): v is SearchRadius => v === null || (typeof v === 'number' && Number.isFinite(v) && v > 0));
  return radii.length ? radii : [...DEFAULT_SEARCH_RADII];
}

/** Rayon suivant : `currentIndex` −1 (aucune recherche encore) donne le premier ; null quand les rayons sont épuisés. */
export function nextRadius(currentIndex: number, radii: readonly SearchRadius[]): { index: number; radius: SearchRadius } | null {
  const index = currentIndex + 1;
  if (index < 0 || index >= radii.length) return null;
  return { index, radius: radii[index]! };
}
