/**
 * Factures d'exemple de `docs/examples/` : une facture de course et une note de crédit entièrement fictives (aucune
 * donnée réelle), produites par le gabarit de production (`renderInvoicePdf`) avec les montants du domaine, sur
 * l'exemple de contrôle du cahier des charges (24,55 $ de tarif, 31,56 $ au total). Le lien du code QR est signé avec une
 * clé d'exemple, jamais celle de l'API. Régénérer : `pnpm --filter @neomoov/api build`, puis depuis la racine
 * `node apps/api/dist/scripts/invoice-example.js`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCreditNote, buildRideInvoice, creditableOf, type InvoiceAmounts, type RideInvoiceView } from '@neomoov/domain';
import QRCode from 'qrcode';
import { invoiceLabel } from '../modules/invoicing/invoice-labels.js';
import { renderInvoicePdf } from '../modules/invoicing/invoice-pdf.js';
import { invoiceVerificationKey, signInvoiceToken, verificationUrl } from '../modules/invoicing/invoice-token.js';

const RATES = { gstRatePpm: 50_000, qstRatePpm: 99_750 };
const EXAMPLE_KEY = invoiceVerificationKey('exemple-non-secret');
const INVOICE_ID = '00000000-0000-4000-8000-000000001841';
const CREDIT_NOTE_ID = '00000000-0000-4000-8000-000000001842';
const RIDE_ID = '00000000-0000-4000-8000-000000000412';
const DRIVER_ID = '00000000-0000-4000-8000-000000000012';

function view(id: string, amounts: InvoiceAmounts, over: Partial<RideInvoiceView>): RideInvoiceView {
  const url = verificationUrl('https://neomoov.net/verifier-facture', signInvoiceToken(id, EXAMPLE_KEY));
  return {
    id, rideId: RIDE_ID, ridePublicNumber: 'NM-2026-09-22-0412', kind: 'ride', number: 'NM-0001841', supplierSequence: 187, issuedAt: '2026-09-22T13:24:00.000Z',
    supplier: { driverId: DRIVER_ID, publicNumber: 'CH-00012', name: 'Samuel Exemple', gstNumber: '000000000 RT0001', qstNumber: '0000000000 TQ0001' },
    platform: { name: 'GROUPE NOUVEAU SYSTEME KARDINAL (GROUPE NSK) INC.', address: 'Montréal (Québec)', gstNumber: null, qstNumber: null },
    customerName: 'Camille E.',
    trip: { category: 'neo_premium', originAddress: 'Rue Sherbrooke Ouest (exemple), Montréal', destinationAddress: 'Avenue du Parc (exemple), Montréal', distanceMeters: 8_000, durationSeconds: 1_080, occurredAt: '2026-09-22T13:23:00.000Z' },
    lines: amounts.lines.map((l) => ({ ...l, label: invoiceLabel(l.code) })),
    fareCents: amounts.fareCents, serviceFeeCents: amounts.serviceFeeCents, regulatoryFeeCents: amounts.regulatoryFeeCents, tollsCents: amounts.tollsCents,
    taxes: { ...amounts.taxes, ...RATES },
    tipCents: amounts.tipCents, totalCents: amounts.totalCents,
    payment: { method: 'card_app', creditsAppliedCents: amounts.creditsAppliedCents, paidCents: amounts.paidCents },
    sev: { status: 'acknowledged', transactionId: 'sev_exemple_000187' },
    verificationUrl: url,
    legalNotice: 'Le transport est fourni et facturé par le chauffeur indiqué ; les frais de service et la redevance sont facturés par Neomoov. Contenu à confirmer avec le fournisseur du SEV certifié et le comptable. Document d\'exemple, sans valeur fiscale.',
    pdfAvailable: true, creditNoteOf: null, refund: null, creditNotes: [],
    ...over,
  };
}

const invoice = buildRideInvoice({
  fareCents: 2_455, promotionDiscountCents: 0, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, gstCents: 137, qstCents: 274, waitChargeCents: 0, tipCents: 0,
  creditsAppliedCents: 0, finalPriceCents: 3_156,
  quoteLines: [{ code: 'base_fare', amountCents: 350 }, { code: 'distance', amountCents: 1_394 }, { code: 'duration', amountCents: 711 }],
}, RATES);
const credit = buildCreditNote(creditableOf(invoice), [], 1_000);

const out = new URL('../../../../docs/examples/', import.meta.url);
mkdirSync(out, { recursive: true });
const documents: Array<[string, RideInvoiceView]> = [
  ['facture-exemple.pdf', view(INVOICE_ID, invoice, {})],
  ['note-de-credit-exemple.pdf', view(CREDIT_NOTE_ID, credit, {
    kind: 'credit_note', number: 'NM-0001842', supplierSequence: 188, issuedAt: '2026-09-23T14:05:00.000Z', payment: { method: 'card_app', creditsAppliedCents: 0, paidCents: credit.totalCents },
    sev: { status: 'acknowledged', transactionId: 'sev_exemple_000188' }, creditNoteOf: { id: INVOICE_ID, number: 'NM-0001841' },
    refund: { id: '00000000-0000-4000-8000-000000000901', mode: 'refund', reason: 'Retard de 20 minutes (exemple)' },
  })],
];
for (const [name, doc] of documents) {
  const qr = await QRCode.toBuffer(doc.verificationUrl!, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' });
  // Horodatage fixe du PDF : un nouveau rendu du même exemple donne le même fichier (diff propre dans le dépôt).
  const pdf = await renderInvoicePdf(doc, qr, new Date('2026-09-22T13:24:00.000Z'));
  writeFileSync(new URL(name, out), pdf);
  console.log(`${name} : ${doc.number}, total ${doc.totalCents} ¢, ${pdf.length} octets`);
}
