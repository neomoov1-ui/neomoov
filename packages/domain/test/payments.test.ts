import { describe, expect, it } from 'vitest';
import {
  authorizationCents, captureCents, completeRideSchema, connectStatusSchema, isCardMethod, paidDirectSchema, paymentViewSchema, refundableCents, refundInputSchema, setupIntentConfirmSchema,
  tipInputSchema,
} from '../src/index.js';

describe('paiements : règles (5.6)', () => {
  it('autorise le prix maximal consenti plus 15 %, marge plafonnée à 20 $', () => {
    expect(authorizationCents(5_000)).toBe(5_750);
    expect(authorizationCents(20_000)).toBe(22_000);
    expect(authorizationCents(100_000)).toBe(102_000);
    expect(authorizationCents(0)).toBe(0);
    expect(authorizationCents(1_001)).toBe(1_151);
    expect(authorizationCents(10_000, { marginPpm: 0, marginCapCents: 0 })).toBe(10_000);
    expect(() => authorizationCents(-1)).toThrow(RangeError);
    expect(() => authorizationCents(10.5)).toThrow(RangeError);
  });

  it('capture le montant dû sans jamais dépasser l\'autorisation ; le reste devient un solde', () => {
    expect(captureCents(4_500, 5_750)).toEqual({ captureCents: 4_500, shortfallCents: 0 });
    expect(captureCents(6_000, 5_750)).toEqual({ captureCents: 5_750, shortfallCents: 250 });
    expect(captureCents(-10, 5_750)).toEqual({ captureCents: 0, shortfallCents: 0 });
    expect(captureCents(100, -5)).toEqual({ captureCents: 0, shortfallCents: 100 });
  });

  it('reste remboursable et moyens par carte', () => {
    expect(refundableCents(5_000, 1_500)).toBe(3_500);
    expect(refundableCents(1_000, 2_000)).toBe(0);
    expect(isCardMethod('card_app')).toBe(true);
    expect(isCardMethod('apple_pay')).toBe(true);
    expect(isCardMethod('cash')).toBe(false);
  });
});

describe('paiements : schémas', () => {
  it('valide pourboire, remboursement, confirmation et paiement direct', () => {
    expect(tipInputSchema.safeParse({ amountCents: 500 }).success).toBe(true);
    expect(tipInputSchema.safeParse({ amountCents: 0 }).success).toBe(false);
    expect(refundInputSchema.parse({ amountCents: 1_000, reason: 'Retard important' })).toEqual({ amountCents: 1_000, reason: 'Retard important', mode: 'refund' });
    expect(refundInputSchema.safeParse({ amountCents: 0, reason: 'Retard' }).success).toBe(false);
    expect(refundInputSchema.safeParse({ amountCents: 100, reason: 'x' }).success).toBe(false);
    expect(setupIntentConfirmSchema.parse({ setupIntentId: 'seti_123' })).toEqual({ setupIntentId: 'seti_123', makeDefault: true });
    expect(paidDirectSchema.safeParse({ method: 'cash', amountCents: 4_500 }).success).toBe(true);
    expect(paidDirectSchema.safeParse({ method: 'card_app', amountCents: 4_500 }).success).toBe(false);
    expect(completeRideSchema.parse({ paidDirect: { method: 'terminal', amountCents: 3_000 } }).paidDirect).toEqual({ method: 'terminal', amountCents: 3_000 });
  });

  it('vue d\'un paiement et état Connect', () => {
    const view = {
      id: '00000000-0000-4000-8000-000000000001', rideId: '00000000-0000-4000-8000-000000000002', kind: 'ride', method: 'card_app', status: 'captured', collectedBy: 'platform',
      authorizedCents: 5_750, capturedCents: 4_500, refundedCents: 0, driverConfirmedCents: null, card: { brand: 'visa', last4: '4242' }, failureCode: null, createdAt: new Date().toISOString(),
    };
    expect(paymentViewSchema.parse(view)).toEqual(view);
    expect(connectStatusSchema.safeParse({ linked: true, onboarded: true, payoutsEnabled: true, debitMethod: null, provider: 'mock' }).success).toBe(true);
  });
});
