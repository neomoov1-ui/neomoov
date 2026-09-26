import { describe, expect, it } from 'vitest';
import { creditsSchema, favoriteSchema, guaranteeDecisionSchema, promotionValidateSchema, promotionValidationSchema, referralApplySchema, referralSchema } from '../src/index.js';

describe('schémas de l\'étape 8', () => {
  it('code promo en majuscules, validation avec motif stable', () => {
    expect(promotionValidateSchema.parse({ code: ' lancement30 ' })).toEqual({ code: 'LANCEMENT30' });
    expect(promotionValidationSchema.safeParse({ code: 'X', valid: false, reason: 'unknown_code', name: null, discountCents: null }).success).toBe(true);
    expect(promotionValidationSchema.safeParse({ code: 'X', valid: false, reason: 'autre', name: null, discountCents: null }).success).toBe(false);
  });

  it('crédits, parrainage, favori', () => {
    expect(creditsSchema.safeParse({ availableCents: 1000, credits: [{ id: '00000000-0000-4000-8000-000000000001', origin: 'refund', amountCents: 1000, remainingCents: 1000, reference: 'NM-1', expiresAt: null, createdAt: new Date().toISOString() }] }).success).toBe(true);
    expect(referralApplySchema.parse({ code: 'ab12cd' })).toEqual({ code: 'AB12CD' });
    expect(referralSchema.safeParse({ code: 'AB12CD', link: 'https://neomoov.net/p/AB12CD', kind: 'client', referrerRewardCents: 1000, referredRewardCents: 1000, thresholdRides: 1, stats: { invited: 0, completed: 0, earnedCents: 0 }, referredBy: null }).success).toBe(true);
    expect(favoriteSchema.safeParse({ driverId: '00000000-0000-4000-8000-000000000001', firstName: 'Léa', rating: 4.9, ridesTogether: 3, vehicle: null, available: true, since: new Date().toISOString() }).success).toBe(true);
  });

  it('garantie modèle : un refus ne met pas le chauffeur en faute ; valeurs par défaut', () => {
    expect(guaranteeDecisionSchema.parse({ outcome: 'validated', decision: 'Véhicule non conforme' })).toEqual({ outcome: 'validated', decision: 'Véhicule non conforme', driverAtFault: false, refundMode: 'refund' });
    expect(guaranteeDecisionSchema.safeParse({ outcome: 'rejected', decision: 'Photo conforme', driverAtFault: true }).success).toBe(false);
    expect(guaranteeDecisionSchema.safeParse({ outcome: 'validated', decision: 'Faute', driverAtFault: true, refundMode: 'credit' }).success).toBe(true);
  });
});
