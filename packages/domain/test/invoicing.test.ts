import { describe, expect, it } from 'vitest';
import {
  allocateProRata, buildCreditNote, buildFeeInvoice, buildRideInvoice, creditableOf, invoiceDocumentSchema, invoiceKindForRide, invoiceVerificationSchema,
  invoiceVerificationTokenSchema, rideInvoiceSchema, sevOperationFor, sevStatusReportSchema,
  type CreditableAmounts, type RideInvoiceInput, type TaxRates,
} from '../src/index.js';

const rates: TaxRates = { gstRatePpm: 50_000, qstRatePpm: 99_750 };
const ID = '2f4c1a3e-8b6d-4f1a-9c2e-7d5b6a4c3e21';
const NOW = '2026-09-22T12:00:00-04:00';

/** Exemple de contrôle du cahier des charges : tarif 24,55 $, frais 2,00 $, redevance 0,90 $, total 31,56 $. */
const control = (over: Partial<RideInvoiceInput> = {}): RideInvoiceInput => ({
  fareCents: 2455, promotionDiscountCents: 0, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, gstCents: 137, qstCents: 274,
  waitChargeCents: 0, tipCents: 0, creditsAppliedCents: 0, finalPriceCents: 3156,
  quoteLines: [
    { code: 'base_fare', amountCents: 350 }, { code: 'distance', amountCents: 1394 }, { code: 'duration', amountCents: 711 },
    { code: 'service_fee', amountCents: 200 }, { code: 'regulatory_fee', amountCents: 90 }, { code: 'gst', amountCents: 137 }, { code: 'qst', amountCents: 274 },
  ],
  ...over,
});
const view = (lines: Array<{ code: string; amountCents: number }>) => lines.map((l) => [l.code, l.amountCents]);

describe('nature et opération SEV', () => {
  it('associe chaque nature à une opération du SEV', () => {
    expect(sevOperationFor('ride')).toBe('sale');
    expect(sevOperationFor('cancellation')).toBe('cancellation');
    expect(sevOperationFor('no_show')).toBe('cancellation');
    expect(sevOperationFor('credit_note')).toBe('credit');
  });

  it('facture due selon l\'état de la course et les frais', () => {
    expect(['completed', 'rated', 'disputed'].map((s) => invoiceKindForRide(s, 0))).toEqual(['ride', 'ride', 'ride']);
    expect(invoiceKindForRide('cancelled_by_client', 500)).toBe('cancellation');
    expect(invoiceKindForRide('no_show', 700)).toBe('no_show');
    expect(invoiceKindForRide('cancelled_by_client', 0)).toBeNull();
    expect(invoiceKindForRide('cancelled_by_driver', 500)).toBeNull();
    expect(invoiceKindForRide('in_progress', 0)).toBeNull();
  });
});

describe('facture d\'une course', () => {
  it('exemple de contrôle : lignes du devis, frais, taxes par nature, total 31,56 $', () => {
    const inv = buildRideInvoice(control(), rates);
    expect(view(inv.lines)).toEqual([['base_fare', 350], ['distance', 1394], ['duration', 711], ['service_fee', 200], ['regulatory_fee', 90]]);
    expect(inv.lines.map((l) => l.party)).toEqual(['driver', 'driver', 'driver', 'platform', 'platform']);
    expect(inv.taxes).toEqual({ gstCents: 137, qstCents: 274, fare: { gstCents: 123, qstCents: 245 }, fee: { gstCents: 14, qstCents: 29 }, absorbed: { gstCents: 0, qstCents: 0 } });
    expect(inv).toMatchObject({ fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, tipCents: 0, totalCents: 3156, paidCents: 3156, creditsAppliedCents: 0, discrepancyCents: 0 });
  });

  it('attente, favori retiré, promotion, péages, remise d\'alignement, crédits et pourboire', () => {
    // Tarif final 2605 = 2455 + favori 500 + attente 150 − favori retiré 500 ; promotion 737 ; frais 150 après alignement.
    const inv = buildRideInvoice({
      fareCents: 2605, promotionDiscountCents: 737, serviceFeeCents: 150, regulatoryFeeCents: 90, tollsCents: 300, gstCents: 120, qstCents: 240,
      waitChargeCents: 150, tipCents: 300, creditsAppliedCents: 500, finalPriceCents: 2768,
      quoteLines: [
        { code: 'base_fare', amountCents: 350 }, { code: 'distance', amountCents: 1394 }, { code: 'duration', amountCents: 711 }, { code: 'night', amountCents: 0 },
        { code: 'favourite_driver', amountCents: 500 }, { code: 'tolls', amountCents: 300 }, { code: 'benchmark_alignment', amountCents: -50 }, { code: 'promotion', amountCents: -737 },
        { code: 'service_fee', amountCents: 200 }, { code: 'credits', amountCents: -500 },
      ],
    }, rates);
    expect(view(inv.lines)).toEqual([
      ['base_fare', 350], ['distance', 1394], ['duration', 711], ['favourite_driver', 500], ['wait_time', 150], ['fare_adjustment', -500], ['promotion', -737],
      ['service_fee', 150], ['regulatory_fee', 90], ['tolls', 300],
    ]);
    expect(inv.taxes).toEqual({ gstCents: 120, qstCents: 240, fare: { gstCents: 130, qstCents: 260 }, fee: { gstCents: 27, qstCents: 54 }, absorbed: { gstCents: 37, qstCents: 74 } });
    expect(inv).toMatchObject({ totalCents: 3068, creditsAppliedCents: 500, paidCents: 2568, discrepancyCents: 0 });
  });

  it('un écart d\'arrondi est compensé par une ligne et rapporté ; les crédits ne dépassent jamais le prix', () => {
    const inv = buildRideInvoice(control({ finalPriceCents: 3155, creditsAppliedCents: 5000 }), rates);
    expect(inv.lines.at(-1)).toEqual({ code: 'rounding', amountCents: -1, party: 'platform' });
    expect(inv).toMatchObject({ discrepancyCents: 1, totalCents: 3155, creditsAppliedCents: 3155, paidCents: 0 });
  });

  it('refuse un montant négatif ou fractionnaire', () => {
    expect(() => buildRideInvoice(control({ gstCents: -1 }), rates)).toThrow(RangeError);
    expect(() => buildRideInvoice(control({ tipCents: 1.5 }), rates)).toThrow(/tipCents/);
  });
});

describe('facture de frais d\'annulation et de non-présentation', () => {
  it('une ligne au chauffeur, sans taxe en V1', () => {
    const cancel = buildFeeInvoice('cancellation', 500);
    expect(cancel.lines).toEqual([{ code: 'cancellation_fee', amountCents: 500, party: 'driver' }]);
    expect(cancel).toMatchObject({ fareCents: 500, totalCents: 500, paidCents: 500, serviceFeeCents: 0, taxes: { gstCents: 0, qstCents: 0 } });
    expect(buildFeeInvoice('no_show', 700).lines[0]).toEqual({ code: 'no_show_fee', amountCents: 700, party: 'driver' });
  });

  it('refuse des frais nuls ou invalides', () => {
    expect(() => buildFeeInvoice('cancellation', 0)).toThrow(RangeError);
    expect(() => buildFeeInvoice('no_show', 2.5)).toThrow(RangeError);
  });
});

describe('répartition au prorata', () => {
  it('cas limites : rien à répartir, poids nuls, total au moins égal à la somme', () => {
    expect(allocateProRata(0, [1, 2])).toEqual([0, 0]);
    expect(allocateProRata(10, [0, 0])).toEqual([0, 0]);
    expect(allocateProRata(50, [10, 20])).toEqual([10, 20]);
  });

  it('plus forts restes, puis ordre des poids à égalité ; la somme est exacte', () => {
    expect(allocateProRata(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocateProRata(7, [5, 3, 2])).toEqual([4, 2, 1]);
    const shares = allocateProRata(1000, [2455, 200, 90, 137, 274]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe('notes de crédit', () => {
  const original = creditableOf(buildRideInvoice(control(), rates));

  it('composantes remboursables : transport payé, frais, taxes perçues par nature', () => {
    expect(original).toEqual({ transportCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, fareGstCents: 123, feeGstCents: 14, fareQstCents: 245, feeQstCents: 29 });
    const promo = creditableOf(buildRideInvoice(control({ promotionDiscountCents: 455, gstCents: 115, qstCents: 228, finalPriceCents: 2633 }), rates));
    expect(promo.transportCents).toBe(2000);
    const rounded = creditableOf(buildRideInvoice(control({ finalPriceCents: 3157 }), rates));
    expect(rounded.serviceFeeCents).toBe(201);
    expect(creditableOf(buildFeeInvoice('no_show', 700))).toMatchObject({ transportCents: 700, fareGstCents: 0 });
  });

  it('remboursement intégral : la note reprend toutes les composantes, montants positifs', () => {
    const note = buildCreditNote(original, [], 3156);
    expect(view(note.lines)).toEqual([['transport', 2455], ['service_fee', 200], ['regulatory_fee', 90]]);
    expect(note).toMatchObject({ totalCents: 3156, paidCents: 3156, discrepancyCents: 0, taxes: { gstCents: 137, qstCents: 274, fare: { gstCents: 123, qstCents: 245 }, fee: { gstCents: 14, qstCents: 29 } } });
    expect(note.lines.every((l) => l.amountCents > 0)).toBe(true);
  });

  it('remboursements partiels successifs : jamais plus que la facture, le dernier solde exactement', () => {
    const first = buildCreditNote(original, [], 1000);
    expect(first.totalCents).toBe(1000);
    const second = buildCreditNote(original, [first.credited], 1500);
    const last = buildCreditNote(original, [first.credited, second.credited], 656);
    const keys = Object.keys(original) as Array<keyof CreditableAmounts>;
    for (const key of keys) expect(first.credited[key] + second.credited[key] + last.credited[key]).toBe(original[key]);
    const extra = buildCreditNote(original, [first.credited, second.credited, last.credited], 100);
    expect(extra).toMatchObject({ totalCents: 0, discrepancyCents: 100, lines: [] });
  });

  it('péages et note sur des frais d\'annulation ; montant invalide refusé', () => {
    const tolls = buildCreditNote({ ...original, tollsCents: 300 }, [], 3456);
    expect(view(tolls.lines)).toContainEqual(['tolls', 300]);
    expect(buildCreditNote(creditableOf(buildFeeInvoice('cancellation', 500)), [], 500).lines).toEqual([{ code: 'transport', amountCents: 500, party: 'driver' }]);
    expect(() => buildCreditNote(original, [], 0)).toThrow(RangeError);
  });
});

describe('schémas de la facturation', () => {
  const original = { transportCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, fareGstCents: 123, feeGstCents: 14, fareQstCents: 245, feeQstCents: 29 };
  const document = {
    version: 1, ridePublicNumber: 'NM-2026-09-22-0412',
    supplier: { publicNumber: 'CH-00012', name: 'Samuel Tremblay', gstNumber: null, qstNumber: null },
    platform: { name: 'Neomoov', address: 'Montréal (Québec)', gstNumber: null, qstNumber: null },
    customerName: 'Camille R.',
    trip: { category: 'neo_premium', originAddress: 'A', destinationAddress: 'B', distanceMeters: 8000, durationSeconds: 1080, occurredAt: NOW },
    lines: [{ code: 'base_fare', label: 'Prise en charge', amountCents: 350, party: 'driver' }],
    tollsCents: 0,
    taxes: { gstCents: 137, qstCents: 274, gstRatePpm: 50_000, qstRatePpm: 99_750, fare: { gstCents: 123, qstCents: 245 }, fee: { gstCents: 14, qstCents: 29 }, absorbed: { gstCents: 0, qstCents: 0 } },
    payment: { creditsAppliedCents: 0, paidCents: 3156 },
    legalNotice: 'Mention', creditable: original, creditNote: null,
  };

  it('document figé, vue de la facture, vérification publique et état du SEV', () => {
    expect(invoiceDocumentSchema.parse(document).version).toBe(1);
    expect(invoiceDocumentSchema.safeParse({ ...document, version: 2 }).success).toBe(false);
    const shown = { ridePublicNumber: document.ridePublicNumber, platform: document.platform, customerName: document.customerName, trip: document.trip, lines: document.lines, tollsCents: 0, taxes: document.taxes, legalNotice: document.legalNotice };
    const invoice = {
      ...shown, id: ID, rideId: ID, kind: 'ride', number: 'NM-0001841', supplierSequence: 12, issuedAt: NOW, supplier: { ...document.supplier, driverId: ID },
      fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, tipCents: 0, totalCents: 3156, payment: { method: 'card_app', creditsAppliedCents: 0, paidCents: 3156 },
      sev: { status: 'acknowledged', transactionId: 'sev_1' }, verificationUrl: 'https://neomoov.net/verifier-facture?t=x', pdfAvailable: true, creditNoteOf: null, refund: null, creditNotes: [],
    };
    expect(rideInvoiceSchema.parse(invoice).number).toBe('NM-0001841');
    expect(rideInvoiceSchema.safeParse({ ...invoice, kind: 'refund' }).success).toBe(false);
    expect(invoiceVerificationSchema.parse({ number: 'NM-0000001', kind: 'credit_note', issuedAt: NOW, supplierName: 'S. T.', totalCents: 100, sevStatus: 'pending' }).kind).toBe('credit_note');
    expect(invoiceVerificationTokenSchema.safeParse('A'.repeat(44)).success).toBe(true);
    expect(invoiceVerificationTokenSchema.safeParse('A'.repeat(43)).success).toBe(false);
    expect(sevStatusReportSchema.parse({ adapter: { name: 'mock', healthy: true, latencyMs: 0, detail: null }, maxAttempts: 5, counts: { pending: 1, sent: 0, acknowledged: 3, error: 0 }, lastErrors: [] }).maxAttempts).toBe(5);
  });
});
