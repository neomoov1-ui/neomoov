/**
 * Sanctions graduées (cahier des charges 5.11) : à partir de la note glissante sur les 50 dernières courses notées, des
 * annulations tardives sur 7 jours et des incidents graves, l'agent qualité propose un avertissement (note sous 4,60),
 * une restriction (retrait des courses VIP et aéroport : note sous 4,40 ou 3 annulations tardives en 7 jours) ou une
 * suspension (note sous 4,20 ou 3 incidents graves). La plainte de sécurité, elle, bloque aussitôt (`safety.ts`). Seule
 * la sanction la plus forte est proposée ; la suspension définitive n'est jamais proposée : elle reste humaine.
 */
import type { SanctionType } from '../enums.js';

export interface QualityMetrics {
  /** Moyenne des notes des clients sur les 50 dernières courses notées (null sans note). */
  ratingAverage: number | null;
  ratingCount: number;
  lateCancellations7d: number;
  /** Incidents graves (gravité élevée ou critique) sur les courses du chauffeur, dans la fenêtre des réglages. */
  seriousIncidents: number;
}

export interface QualityThresholds {
  warningBelow: number;
  restrictionBelow: number;
  suspensionBelow: number;
  /** Nombre de notes sous lequel la moyenne n'est pas jugée (trop peu de courses pour être représentative). */
  minRatings: number;
  lateCancellations: number;
  seriousIncidents: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = { warningBelow: 4.6, restrictionBelow: 4.4, suspensionBelow: 4.2, minRatings: 10, lateCancellations: 3, seriousIncidents: 3 };

/** Réglage `quality.thresholds` : valeurs numériques positives seulement, les autres gardent leur défaut. */
export function parseQualityThresholds(raw: unknown): QualityThresholds {
  const out = { ...DEFAULT_QUALITY_THRESHOLDS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(out) as Array<keyof QualityThresholds>) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

export const QUALITY_REASONS = ['rating_below_warning', 'rating_below_restriction', 'rating_below_suspension', 'late_cancellations', 'serious_incidents'] as const;
export type QualityReason = (typeof QUALITY_REASONS)[number];

export interface QualityProposal {
  type: SanctionType;
  reasons: QualityReason[];
}

const RANK: Record<SanctionType, number> = { warning: 1, restriction: 2, suspension: 3 };

export function sanctionRank(type: SanctionType): number {
  return RANK[type];
}

export function qualityProposal(m: QualityMetrics, t: QualityThresholds): QualityProposal | null {
  const reasons: Array<{ type: SanctionType; reason: QualityReason }> = [];
  const rated = m.ratingAverage !== null && m.ratingCount >= t.minRatings ? m.ratingAverage : null;
  if (rated !== null && rated < t.suspensionBelow) reasons.push({ type: 'suspension', reason: 'rating_below_suspension' });
  else if (rated !== null && rated < t.restrictionBelow) reasons.push({ type: 'restriction', reason: 'rating_below_restriction' });
  else if (rated !== null && rated < t.warningBelow) reasons.push({ type: 'warning', reason: 'rating_below_warning' });
  if (m.seriousIncidents >= t.seriousIncidents) reasons.push({ type: 'suspension', reason: 'serious_incidents' });
  if (m.lateCancellations7d >= t.lateCancellations) reasons.push({ type: 'restriction', reason: 'late_cancellations' });
  if (!reasons.length) return null;
  const type = reasons.reduce<SanctionType>((best, r) => (RANK[r.type] > RANK[best] ? r.type : best), 'warning');
  return { type, reasons: reasons.map((r) => r.reason) };
}

const TYPE_LABEL: Record<SanctionType, string> = { warning: 'Avertissement', restriction: 'Restriction (courses VIP et aéroport retirées)', suspension: 'Suspension temporaire' };

/** Motif lisible, chiffres à l'appui, pour la file d'approbation et la fiche du chauffeur. */
export function qualityReasonText(proposal: QualityProposal, m: QualityMetrics, t: QualityThresholds): string {
  const parts = proposal.reasons.map((reason) => {
    switch (reason) {
      case 'rating_below_suspension':
        return `note de ${m.ratingAverage!.toFixed(2)} sur ${m.ratingCount} courses notées (seuil de suspension ${t.suspensionBelow.toFixed(2)})`;
      case 'rating_below_restriction':
        return `note de ${m.ratingAverage!.toFixed(2)} sur ${m.ratingCount} courses notées (seuil de restriction ${t.restrictionBelow.toFixed(2)})`;
      case 'rating_below_warning':
        return `note de ${m.ratingAverage!.toFixed(2)} sur ${m.ratingCount} courses notées (minimum ${t.warningBelow.toFixed(2)})`;
      case 'late_cancellations':
        return `${m.lateCancellations7d} annulations tardives en 7 jours (seuil ${t.lateCancellations})`;
      case 'serious_incidents':
        return `${m.seriousIncidents} incidents graves (seuil ${t.seriousIncidents})`;
    }
  });
  return `Qualité : ${TYPE_LABEL[proposal.type]} proposée : ${parts.join(' ; ')}`;
}
