import { describe, expect, it } from 'vitest';
import {
  buyPackSchema, cancelRideSchema, createRideSchema, driverDocumentUploadSchema, driverLocationSchema, invoiceSchema, offerSchema,
  packPurchaseSchema, packSchema, phoneE164, quoteRequestSchema, quoteSchema, rateRideSchema, respondToOfferSchema, rideSchema, statementSchema,
} from '../src/schemas/index.js';

const place = (address: string) => ({ address: `${address}, rue Sherbrooke Ouest, Montréal`, coordinates: { lat: 45.5017, lng: -73.5673 } });
const ID = '2f4c1a3e-8b6d-4f1a-9c2e-7d5b6a4c3e21';
const NOW = '2026-09-22T12:00:00-04:00';

describe('devis', () => {
  it('accepte une demande minimale et applique les valeurs par défaut', () => {
    const q = quoteRequestSchema.parse({ category: 'neo_premium', origin: place('A'), destination: place('B') });
    expect(q.stops).toEqual([]);
    expect(q.options).toEqual({ flex: false, priority: false, childSeat: false, luggage: false });
  });

  it('refuse Flex avec des arrêts, une catégorie inconnue et des coordonnées hors limites', () => {
    expect(quoteRequestSchema.safeParse({ category: 'neo_premium', origin: place('A'), destination: place('B'), stops: [place('C')], options: { flex: true } }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ category: 'uber_x', origin: place('A'), destination: place('B') }).success).toBe(false);
    expect(quoteRequestSchema.safeParse({ category: 'neo_xl', origin: { address: 'A', coordinates: { lat: 95, lng: 0 } }, destination: place('B') }).success).toBe(false);
  });

  it('normalise le code promo en majuscules', () => {
    const q = quoteRequestSchema.parse({ category: 'neo_prestige', origin: place('A'), destination: place('B'), options: { promoCode: ' bienvenue ' } });
    expect(q.options.promoCode).toBe('BIENVENUE');
  });

  it('valide un devis complet et refuse un montant négatif', () => {
    const quote = {
      id: ID, category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080,
      lines: [{ code: 'fare', label: 'Tarif', amountCents: 2455 }], fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, gstCents: 137, qstCents: 274,
      tollsCents: 0, promotionCode: null, promotionDiscountCents: 0, alignmentDiscountCents: 0, subtotalCents: 2745, amountDueCents: 3156, estimated: false, eta: { seconds: 300, status: 'estimated' }, requestedAt: NOW,
      creditsAppliedCents: 0, totalCents: 3156, maxConsentedCents: 5156, flatRateCode: null, ignoredOptions: [], validUntil: NOW, fingerprint: 'abc',
    };
    expect(quoteSchema.parse(quote).totalCents).toBe(3156);
    expect(quoteSchema.safeParse({ ...quote, totalCents: -1 }).success).toBe(false);
  });
});

describe('courses', () => {
  const base = { quoteId: ID, type: 'immediate', paymentMethod: 'card_app', maxConsentedCents: 5156 };

  it('crée une course immédiate avec préférences par défaut', () => {
    const r = createRideSchema.parse(base);
    expect(r.preferences.conversation).toBe('indifferent');
    expect(r.preferences.luggageHelp).toBe(false);
  });

  it('exige une heure pour une course planifiée et valide le numéro de vol', () => {
    expect(createRideSchema.safeParse({ ...base, type: 'scheduled' }).success).toBe(false);
    expect(createRideSchema.safeParse({ ...base, type: 'scheduled', requestedAt: NOW, flightNumber: 'AC870' }).success).toBe(true);
    expect(createRideSchema.safeParse({ ...base, flightNumber: 'vol 870' }).success).toBe(false);
  });

  it('valide le passager tiers avec un téléphone E.164', () => {
    expect(createRideSchema.safeParse({ ...base, passenger: { name: 'Marie Roy', phone: '+15145550142' } }).success).toBe(true);
    expect(createRideSchema.safeParse({ ...base, passenger: { name: 'Marie Roy', phone: '514-555-0142' } }).success).toBe(false);
    expect(phoneE164.safeParse('+1367763906').success).toBe(true);
  });

  it('valide l\'annulation, l\'évaluation et la réponse à une offre', () => {
    expect(cancelRideSchema.parse({ reason: 'changed_plans' }).reason).toBe('changed_plans');
    expect(rateRideSchema.parse({ score: 5, tags: ['punctual'], tipCents: 300 }).tipCents).toBe(300);
    expect(rateRideSchema.safeParse({ score: 6 }).success).toBe(false);
    expect(rateRideSchema.safeParse({ score: 5, tipCents: 20_000 }).success).toBe(false);
    expect(respondToOfferSchema.parse({ accept: true }).accept).toBe(true);
  });

  it('valide une vue de course et une offre', () => {
    const ride = {
      id: ID, state: 'assigned', type: 'immediate', category: 'neo_premium', servedCategory: null, origin: place('A'), destination: place('B'), stops: [],
      requestedAt: null, quote: { totalCents: 3156, fareCents: 2455, maxConsentedCents: 5156, flatRateCode: null }, finalPriceCents: null, tipCents: 0,
      paymentMethod: 'card_app', etaSeconds: 300, trackingUrl: 'https://neomoov.net/s/abc', timestamps: { requested: NOW, assigned: NOW },
      driver: { id: ID, firstName: 'Samuel', rating: 4.96, rideCount: 1214, photoUrl: null, vehicle: { make: 'Tesla', model: 'Model 3', colour: 'blanche', plate: 'N52 KTB', category: 'neo_premium' } },
      dispatch: null, negotiation: null,
    };
    expect(rideSchema.parse(ride).driver?.firstName).toBe('Samuel');
    expect(rideSchema.safeParse({ ...ride, timestamps: { flying: NOW } }).success).toBe(false);
    expect(offerSchema.parse({ id: ID, rideId: ID, driverId: ID, type: 'fixed', state: 'sent', driverFareCents: 2455, pickupDistanceMeters: 1200, pickupSeconds: 240, expiresAt: NOW }).state).toBe('sent');
  });
});

describe('relevés, factures, packs, documents, positions', () => {
  it('valide un relevé avec net négatif', () => {
    const s = statementSchema.parse({
      id: ID, driverId: ID, periodStart: '2026-09-14', periodEnd: '2026-09-20', status: 'issued',
      lines: [{ kind: 'pack_billed', amountCents: 9900, packPurchaseId: ID, occurredAt: NOW, label: 'Pack Pro' }],
      creditsCents: 9015, debitsCents: 18423, netCents: -9408, payoutCents: 0, chargeCents: 9408, issuedAt: NOW, pdfUrl: null,
    });
    expect(s.netCents).toBe(-9408);
    expect(statementSchema.safeParse({ ...s, periodStart: '14/09/2026' }).success).toBe(false);
  });

  it('valide une facture numérotée NM-0000001', () => {
    const inv = {
      id: ID, rideId: ID, number: 'NM-0001841', issuedAt: NOW, supplier: { driverId: ID, name: 'Samuel Tremblay', gstNumber: null, qstNumber: null },
      platform: { name: 'Groupe NSK Inc.', gstNumber: '123456789RT0001', qstNumber: '1234567890TQ0001' }, lines: [], totalCents: 3156, paymentMethod: 'card_app',
      sev: { status: 'sent', transactionId: 'abc' }, pdfUrl: null, qrPayload: null,
    };
    expect(invoiceSchema.parse(inv).number).toBe('NM-0001841');
    expect(invoiceSchema.safeParse({ ...inv, number: '1841' }).success).toBe(false);
  });

  it('valide le catalogue et un achat de pack', () => {
    expect(packSchema.parse({ code: 'unlimited', name: 'Illimité', ridesIncluded: null, priceCents: 19900, validityDays: 7, rolloverAllowed: false, active: true }).ridesIncluded).toBeNull();
    expect(packPurchaseSchema.parse({ id: ID, packCode: 'pro', pricePaidCents: 9900, ridesRemaining: 27, carriedOverRemaining: 0, activatedAt: NOW, expiresAt: NOW, status: 'active', autoRenew: true }).ridesRemaining).toBe(27);
    expect(buyPackSchema.parse({ packCode: 'elite' }).autoRenew).toBe(true);
    expect(buyPackSchema.safeParse({ packCode: 'gold' }).success).toBe(false);
  });

  it('valide un document et une position', () => {
    expect(driverDocumentUploadSchema.parse({ type: 'licence', expiresOn: '2028-03-12', fileId: ID }).type).toBe('licence');
    expect(driverLocationSchema.parse({ coordinates: { lat: 45.5, lng: -73.6 }, speedMps: 12.5, headingDegrees: 90, accuracyMeters: 5, recordedAt: NOW }).speedMps).toBe(12.5);
    expect(driverLocationSchema.safeParse({ coordinates: { lat: 45.5, lng: -73.6 }, speedMps: 200, headingDegrees: 90, accuracyMeters: 5, recordedAt: NOW }).success).toBe(false);
  });
});
