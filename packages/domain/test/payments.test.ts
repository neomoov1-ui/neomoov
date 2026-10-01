import { describe, expect, it } from 'vitest';
import {
  authorizationCents, captureCents, cardSessionConfirmSchema, cardSessionInfoSchema, cardSessionQuerySchema, cardSessionResultSchema, completeRideSchema, connectStatusSchema, isCardMethod,
  offlinePayoutSchema, paidDirectSchema, paymentViewSchema, payoutStatusSchema, refundableCents, refundInputSchema, setupIntentConfirmSchema, setupIntentResponseSchema, tipInputSchema,
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
    expect(connectStatusSchema.safeParse({ linked: true, onboarded: true, payoutsEnabled: true, debitMethod: null, provider: 'mock', payoutMode: 'connect' }).success).toBe(true);
    // Étape 26 : le mode de versement est obligatoire (`offline` avec Square, sans Connect).
    expect(connectStatusSchema.safeParse({ linked: false, onboarded: false, payoutsEnabled: false, debitMethod: { brand: 'visa', last4: '1111' }, provider: 'square', payoutMode: 'offline' }).success).toBe(true);
    expect(connectStatusSchema.safeParse({ linked: true, onboarded: true, payoutsEnabled: true, debitMethod: null, provider: 'mock' }).success).toBe(false);
    expect(payoutStatusSchema.safeParse({ linked: false, onboarded: false, provider: 'square', payoutMode: 'offline' }).success).toBe(true);
    expect(payoutStatusSchema.safeParse({ linked: false, onboarded: false, provider: 'square', payoutMode: 'virement' }).success).toBe(false);
  });
});

describe('paiements par Square (étape 26) : schémas', () => {
  const session = 'AQEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  it('réponse de setup-intent : SetupIntent (Stripe, simulateur) ou page de saisie (Square), sans secret', () => {
    const square = {
      provider: 'square', setupIntentId: null, clientSecret: null, customerId: 'CUST', publishableKey: null, applePayMerchantId: null, merchantCountry: 'CA', simulated: false,
      cardFormUrl: 'https://neomoov.net/carte?session=abc', squareApplicationId: 'sq0idp-x', squareLocationId: 'L1', squareEnvironment: 'production',
    };
    expect(setupIntentResponseSchema.parse(square)).toEqual(square);
    const stripe = { ...square, provider: 'stripe', setupIntentId: 'seti_1', clientSecret: 'seti_1_secret_x', publishableKey: 'pk_test', cardFormUrl: null, squareApplicationId: null, squareLocationId: null, squareEnvironment: null };
    expect(setupIntentResponseSchema.safeParse(stripe).success).toBe(true);
    expect(setupIntentResponseSchema.safeParse({ ...square, provider: 'paypal' }).success).toBe(false);
    expect(setupIntentResponseSchema.safeParse({ ...square, squareEnvironment: 'live' }).success).toBe(false);
    expect(setupIntentResponseSchema.safeParse({ ...square, cardFormUrl: 'pas une adresse' }).success).toBe(false);
  });

  it('confirmation : SetupIntent ou jeton de carte (avec vérification facultative), jamais un corps vide', () => {
    expect(setupIntentConfirmSchema.parse({ sourceId: ' cnon:abc ' })).toEqual({ sourceId: 'cnon:abc', makeDefault: true });
    expect(setupIntentConfirmSchema.parse({ sourceId: 'cnon:abc', verificationToken: 'verf:x', makeDefault: false })).toEqual({ sourceId: 'cnon:abc', verificationToken: 'verf:x', makeDefault: false });
    expect(setupIntentConfirmSchema.safeParse({ makeDefault: true }).success).toBe(false);
    expect(setupIntentConfirmSchema.safeParse({ sourceId: 'x' }).success).toBe(false);
  });

  it('session de saisie de carte : requête, informations publiques, confirmation et résultat', () => {
    expect(cardSessionQuerySchema.safeParse({ session }).success).toBe(true);
    expect(cardSessionQuerySchema.safeParse({ session: 'court' }).success).toBe(false);
    const info = { provider: 'square', purpose: 'driver_debit', expiresAt: new Date().toISOString(), squareApplicationId: 'sq0idp-x', squareLocationId: 'L1', squareEnvironment: 'sandbox', returnUrl: 'neomoov-driver://payout' };
    expect(cardSessionInfoSchema.parse(info)).toEqual(info);
    expect(cardSessionInfoSchema.safeParse({ ...info, purpose: 'autre' }).success).toBe(false);
    expect(cardSessionConfirmSchema.parse({ session, sourceId: 'cnon:abc' })).toEqual({ session, sourceId: 'cnon:abc' });
    expect(cardSessionConfirmSchema.safeParse({ session, sourceId: 'cnon:abc', verificationToken: 'x' }).success).toBe(false);
    expect(cardSessionResultSchema.safeParse({ purpose: 'driver_debit', card: null, debitMethod: { brand: 'visa', last4: '4242' } }).success).toBe(true);
  });

  it('versement à faire hors plateforme', () => {
    const payout = {
      statementId: '00000000-0000-4000-8000-000000000001', driverId: '00000000-0000-4000-8000-000000000002', driverPublicNumber: 'CH-00042', driverName: 'Ana Test', interacEmail: null,
      periodStart: '2026-09-21', periodEnd: '2026-09-27', amountCents: 12_345, reference: 'NM-20260921-CH-00042', status: 'issued', issuedAt: new Date().toISOString(),
    };
    expect(offlinePayoutSchema.parse(payout)).toEqual(payout);
    expect(offlinePayoutSchema.safeParse({ ...payout, amountCents: -1 }).success).toBe(false);
    expect(offlinePayoutSchema.safeParse({ ...payout, status: 'virement' }).success).toBe(false);
  });
});
