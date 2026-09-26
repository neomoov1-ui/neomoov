import { describe, expect, it } from 'vitest';
import { DEFAULT_QUALITY_THRESHOLDS as T, parseQualityThresholds, qualityProposal, qualityReasonText, sanctionRank } from '../src/index.js';

const metrics = (over: Partial<{ ratingAverage: number | null; ratingCount: number; lateCancellations7d: number; seriousIncidents: number }> = {}) => ({ ratingAverage: 4.9, ratingCount: 50, lateCancellations7d: 0, seriousIncidents: 0, ...over });

describe('sanctions graduées (5.11)', () => {
  it('note glissante : avertissement sous 4,60, restriction sous 4,40, suspension sous 4,20 ; rien au-dessus', () => {
    expect(qualityProposal(metrics(), T)).toBeNull();
    expect(qualityProposal(metrics({ ratingAverage: 4.6 }), T)).toBeNull();
    expect(qualityProposal(metrics({ ratingAverage: 4.55 }), T)).toEqual({ type: 'warning', reasons: ['rating_below_warning'] });
    expect(qualityProposal(metrics({ ratingAverage: 4.35 }), T)).toEqual({ type: 'restriction', reasons: ['rating_below_restriction'] });
    expect(qualityProposal(metrics({ ratingAverage: 4.1 }), T)).toEqual({ type: 'suspension', reasons: ['rating_below_suspension'] });
  });
  it('trop peu de notes : la moyenne n\'est pas jugée', () => {
    expect(qualityProposal(metrics({ ratingAverage: 3.5, ratingCount: 9 }), T)).toBeNull();
    expect(qualityProposal(metrics({ ratingAverage: null, ratingCount: 0 }), T)).toBeNull();
  });
  it('annulations tardives et incidents graves ; la sanction la plus forte l\'emporte, tous les motifs gardés', () => {
    expect(qualityProposal(metrics({ lateCancellations7d: 3 }), T)).toEqual({ type: 'restriction', reasons: ['late_cancellations'] });
    expect(qualityProposal(metrics({ lateCancellations7d: 2 }), T)).toBeNull();
    expect(qualityProposal(metrics({ seriousIncidents: 3 }), T)).toEqual({ type: 'suspension', reasons: ['serious_incidents'] });
    expect(qualityProposal(metrics({ ratingAverage: 4.5, lateCancellations7d: 4 }), T)).toEqual({ type: 'restriction', reasons: ['rating_below_warning', 'late_cancellations'] });
    expect(qualityProposal(metrics({ ratingAverage: 4.3, seriousIncidents: 5 }), T)?.type).toBe('suspension');
  });
  it('seuils réglables, valeurs invalides ignorées ; rangs des sanctions', () => {
    expect(parseQualityThresholds(null)).toEqual(T);
    expect(parseQualityThresholds({ warningBelow: 4.7, minRatings: -1, lateCancellations: 'trois' })).toEqual({ ...T, warningBelow: 4.7 });
    expect([sanctionRank('warning'), sanctionRank('restriction'), sanctionRank('suspension')]).toEqual([1, 2, 3]);
  });
  it('motif lisible, chiffres à l\'appui', () => {
    const m = metrics({ ratingAverage: 4.15, lateCancellations7d: 3, seriousIncidents: 3 });
    const text = qualityReasonText(qualityProposal(m, T)!, m, T);
    expect(text).toBe('Qualité : Suspension temporaire proposée : note de 4.15 sur 50 courses notées (seuil de suspension 4.20) ; 3 incidents graves (seuil 3) ; 3 annulations tardives en 7 jours (seuil 3)');
    const w = metrics({ ratingAverage: 4.5 });
    expect(qualityReasonText(qualityProposal(w, T)!, w, T)).toContain('Avertissement proposée : note de 4.50 sur 50 courses notées (minimum 4.60)');
    const r = metrics({ ratingAverage: 4.3 });
    expect(qualityReasonText(qualityProposal(r, T)!, r, T)).toContain('Restriction (courses VIP et aéroport retirées) proposée : note de 4.30 sur 50 courses notées (seuil de restriction 4.40)');
  });
});
