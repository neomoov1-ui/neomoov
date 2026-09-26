import { describe, expect, it } from 'vitest';
import { autocompleteQuerySchema, benchmarkInputSchema, quoteRequestSchema, quotesResponseSchema, simulateQuoteSchema } from '../src/index.js';

const place = (address: string) => ({ address: `${address}, Montréal`, coordinates: { lat: 45.5, lng: -73.56 } });

describe('schémas des devis et des relevés (prompt 04)', () => {
  it('une demande sans catégorie tarife toutes les catégories ; la simulation accepte des valeurs forcées', () => {
    const q = quoteRequestSchema.parse({ origin: place('A'), destination: place('B'), requestedAt: '2026-10-01T14:00:00Z' });
    expect(q.category).toBeUndefined();
    const s = simulateQuoteSchema.parse({ origin: place('A'), destination: place('B'), distanceMeters: 8000, durationSeconds: 1080, ignoreLeadTime: true });
    expect(s).toMatchObject({ distanceMeters: 8000, durationSeconds: 1080, ignoreLeadTime: true });
    expect(simulateQuoteSchema.parse({ origin: place('A'), destination: place('B') }).ignoreLeadTime).toBe(false);
  });

  it('un relevé concurrentiel exige au moins un prix observé', () => {
    const base = { category: 'neo_premium', originZoneCode: 'plateau', destinationZoneCode: 'yul', timeWindow: 'weekday_day' };
    expect(benchmarkInputSchema.parse({ ...base, uberPriceCents: 3000 }).uberPriceCents).toBe(3000);
    expect(benchmarkInputSchema.parse({ ...base, lyftPriceCents: 3200 }).lyftPriceCents).toBe(3200);
    expect(benchmarkInputSchema.safeParse({ ...base }).success).toBe(false);
    expect(benchmarkInputSchema.safeParse({ ...base, uberPriceCents: null, lyftPriceCents: null }).success).toBe(false);
    expect(benchmarkInputSchema.safeParse({ ...base, uberPriceCents: 0, lyftPriceCents: 0 }).success).toBe(false);
    expect(benchmarkInputSchema.safeParse({ ...base, timeWindow: 'lundi', uberPriceCents: 1 }).success).toBe(false);
  });

  it('autocomplétion : entrée d\'au moins deux caractères, coordonnées converties', () => {
    expect(autocompleteQuerySchema.parse({ input: 'ru', lat: '45.5', lng: '-73.5' })).toEqual({ input: 'ru', lat: 45.5, lng: -73.5 });
    expect(autocompleteQuerySchema.safeParse({ input: 'r' }).success).toBe(false);
  });

  it('la réponse de devis porte l\'itinéraire commun et un devis par catégorie', () => {
    const quote = {
      id: '2f4c1a3e-8b6d-4f1a-9c2e-7d5b6a4c3e21', category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080, lines: [], fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90,
      tollsCents: 0, promotionCode: null, promotionDiscountCents: 0, alignmentDiscountCents: 0, subtotalCents: 2745, gstCents: 137, qstCents: 274, totalCents: 3156, creditsAppliedCents: 0, amountDueCents: 3156,
      maxConsentedCents: 5156, flatRateCode: null, ignoredOptions: [], estimated: false, eta: { seconds: null, status: 'on_availability' }, requestedAt: null, validUntil: '2026-10-01T14:05:00Z', fingerprint: 'abc',
    };
    const parsed = quotesResponseSchema.parse({ origin: place('A'), destination: place('B'), stops: [], requestedAt: null, distanceMeters: 8000, durationSeconds: 1080, estimated: false, polyline: null, quotes: [quote], paymentMethods: ['card_app', 'cash'] });
    expect(parsed.quotes[0]!.totalCents).toBe(3156);
  });
});
