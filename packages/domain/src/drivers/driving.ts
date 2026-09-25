/**
 * Tableau de conduite (prompt 11, tâche 4) : accélérations et freinages brusques détectés côté serveur à partir des
 * positions reçues (toutes les 5 secondes ou 50 mètres), puis suggestions. Les seuils viennent des réglages
 * (`driving.thresholds`, `driving.score_targets`) ; fonctions pures.
 */

export interface DrivingSample {
  /** Instant de la mesure, en millisecondes. */
  at: number;
  lat: number;
  lng: number;
  /** Vitesse fournie par le GPS (m/s) ; à défaut, elle est déduite de la distance parcourue. */
  speedMps: number | null;
}

export interface DrivingThresholds {
  /** Accélération moyenne sur l'intervalle au-delà de laquelle elle est brusque (m/s²). */
  harshAccelerationMps2: number;
  /** Décélération moyenne sur l'intervalle au-delà de laquelle le freinage est brusque (m/s², valeur positive). */
  harshBrakingMps2: number;
  /** Intervalles plus courts ou plus longs ignorés (mesures trop rapprochées ou coupure). */
  minGapSeconds: number;
  maxGapSeconds: number;
}

export interface DrivingAnalysis {
  harshAccelerations: number;
  harshBrakings: number;
  distanceMeters: number;
  /** Intervalles exploitables, pour juger de la fiabilité de la mesure. */
  intervals: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Une suite d'intervalles consécutifs au-dessus du seuil compte pour un seul événement : un freinage appuyé mesuré sur
 * deux positions n'est pas deux freinages.
 */
export function analyseDriving(samples: readonly DrivingSample[], thresholds: DrivingThresholds): DrivingAnalysis {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const speeds: Array<number | null> = sorted.map((s, i) => {
    if (s.speedMps !== null && Number.isFinite(s.speedMps)) return s.speedMps;
    const previous = sorted[i - 1];
    if (!previous) return null;
    const seconds = (s.at - previous.at) / 1000;
    if (seconds < thresholds.minGapSeconds || seconds > thresholds.maxGapSeconds) return null;
    return distanceMeters(previous, s) / seconds;
  });
  let harshAccelerations = 0;
  let harshBrakings = 0;
  let distance = 0;
  let intervals = 0;
  let inAcceleration = false;
  let inBraking = false;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    const seconds = (b.at - a.at) / 1000;
    if (seconds <= 0 || seconds > thresholds.maxGapSeconds) {
      inAcceleration = false;
      inBraking = false;
      continue;
    }
    distance += distanceMeters(a, b);
    const v0 = speeds[i - 1];
    const v1 = speeds[i];
    if (seconds < thresholds.minGapSeconds || v0 === null || v0 === undefined || v1 === null || v1 === undefined) continue;
    intervals += 1;
    const acceleration = (v1 - v0) / seconds;
    const accelerating = acceleration >= thresholds.harshAccelerationMps2;
    const braking = -acceleration >= thresholds.harshBrakingMps2;
    if (accelerating && !inAcceleration) harshAccelerations += 1;
    if (braking && !inBraking) harshBrakings += 1;
    inAcceleration = accelerating;
    inBraking = braking;
  }
  return { harshAccelerations, harshBrakings, distanceMeters: Math.round(distance), intervals };
}

export interface ScoreTargets {
  /** Note minimale à maintenir (5.11 : 4,60) et seuil de restriction (4,40). */
  minRating: number;
  restrictionRating: number;
  minPunctualityPct: number;
  maxCancellations: number;
  /** Événements brusques tolérés pour 100 km. */
  maxHarshPer100Km: number;
}

export interface ScoreInput {
  punctualityPct: number;
  cancellationCount: number;
  harshAccelerations: number;
  harshBrakings: number;
  distanceMeters: number;
  rating: number | null;
  ratingCount: number;
}

export const SCORE_SUGGESTIONS = ['rating_restriction', 'rating_warning', 'punctuality', 'cancellations', 'smooth_acceleration', 'smooth_braking', 'keep_it_up'] as const;
export type ScoreSuggestion = (typeof SCORE_SUGGESTIONS)[number];

/** Suggestions du tableau de conduite, de la plus importante à la moins importante ; « continuez ainsi » si rien à signaler. */
export function scoreSuggestions(input: ScoreInput, targets: ScoreTargets): ScoreSuggestion[] {
  const out: ScoreSuggestion[] = [];
  if (input.rating !== null && input.ratingCount > 0) {
    if (input.rating < targets.restrictionRating) out.push('rating_restriction');
    else if (input.rating < targets.minRating) out.push('rating_warning');
  }
  if (input.punctualityPct < targets.minPunctualityPct) out.push('punctuality');
  if (input.cancellationCount > targets.maxCancellations) out.push('cancellations');
  // En dessous de 10 km, trop peu de mesures pour juger la conduite.
  if (input.distanceMeters >= 10_000) {
    const per100 = (count: number) => (count * 100_000) / input.distanceMeters;
    if (per100(input.harshAccelerations) > targets.maxHarshPer100Km) out.push('smooth_acceleration');
    if (per100(input.harshBrakings) > targets.maxHarshPer100Km) out.push('smooth_braking');
  }
  return out.length ? out : ['keep_it_up'];
}
