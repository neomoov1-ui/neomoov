/**
 * PDF d'une facture ou d'une note de crédit (section 5.13), d'après la maquette « Facture d'une course remise au client »
 * (docs/design/canevas/project/Doc-02-FactureClient.dc.html) : fournisseur du transport et ses numéros de taxes, Neomoov
 * et ses numéros pour les frais de service, trajet, lignes par partie, taxes par nature, total, paiement, transaction SEV,
 * code QR de vérification et mention légale. Produit par la file `invoicing`, jamais dans une requête HTTP. En français
 * (document fiscal remis au Québec). Polices standard de PDF : le texte est ramené au jeu WinAnsi.
 */
import type { InvoiceKind, PaymentMethod, RideInvoiceView, VehicleCategory } from '@neomoov/domain';
import PDFDocument from 'pdfkit';

const TIME_ZONE = 'America/Toronto';
const INK = '#2c3a4a';
const MUTED = '#5b6776';
const BRAND = '#0b5fb5';
const RULE = '#d5dde6';

const TITLES: Record<InvoiceKind, string> = {
  ride: 'Facture',
  cancellation: 'Facture de frais d\'annulation',
  no_show: 'Facture de frais de non-présentation',
  credit_note: 'Note de crédit',
};
const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card_app: 'carte (application)', apple_pay: 'Apple Pay', google_pay: 'Google Pay', cash: 'espèces', interac: 'Interac', terminal: 'terminal du chauffeur',
};
const CATEGORY_LABELS: Record<VehicleCategory, string> = { neo_premium: 'Neo Premium', neo_prestige: 'Neo Prestige', neo_xl: 'Neo XL', neo_limo: 'Neo Limo' };

/** Caractères hors du jeu WinAnsi des polices standard (espaces fines, tirets insécables) ramenés à leur équivalent. */
function plain(text: string): string {
  return text.replace(/[   ]/g, ' ').replace(/[‐‑]/g, '-');
}

/** 1234 → « 12,34 $ » ; -500 → « -5,00 $ » (français du Canada, espace insécable). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${dollars},${(abs % 100).toString().padStart(2, '0')} $`;
}

function formatRate(ppm: number): string {
  return `${(ppm / 10_000).toString().replace('.', ',')} %`;
}

function formatDateTime(iso: string): string {
  return plain(new Intl.DateTimeFormat('fr-CA', { timeZone: TIME_ZONE, dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso)));
}

function taxNumber(value: string | null): string {
  return value && value.trim() ? value : 'non fourni';
}

/** `creationDate` fixe la date des métadonnées du PDF (exemples reproductibles) ; sinon, l'instant du rendu. */
export function renderInvoicePdf(invoice: RideInvoiceView, qrPng: Buffer | null, creationDate?: Date): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const title = TITLES[invoice.kind];
    const doc = new PDFDocument({
      size: 'LETTER', margin: 48,
      info: { Title: `${title} ${invoice.number}`, Author: invoice.platform.name, Subject: `Course ${invoice.ridePublicNumber}`, ...(creationDate ? { CreationDate: creationDate } : {}) },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const text = (value: string, options: PDFKit.Mixins.TextOptions = {}) => doc.text(plain(value), options);
    const rule = () => {
      doc.moveDown(0.4);
      doc.strokeColor(RULE).lineWidth(0.7).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
      doc.moveDown(0.5);
    };
    const row = (label: string, amount: string, options: { bold?: boolean; muted?: boolean } = {}) => {
      const y = doc.y;
      doc.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fillColor(options.muted ? MUTED : INK).fontSize(options.bold ? 11 : 10);
      doc.text(plain(label), left, y, { width: width - 110 });
      const after = doc.y;
      doc.text(plain(amount), left + width - 110, y, { width: 110, align: 'right' });
      doc.y = Math.max(after, doc.y);
      doc.x = left;
    };

    // En-tête : marque, nature, numéro, date, course.
    doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND).text('neomoov', left, doc.y);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK);
    text(`${title} N° ${invoice.number}`);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    text(`Émise le ${formatDateTime(invoice.issuedAt)} · séquence du fournisseur n° ${invoice.supplierSequence} · course ${invoice.ridePublicNumber}`);
    if (invoice.creditNoteOf) text(`Crédit sur la facture N° ${invoice.creditNoteOf.number}${invoice.refund ? ` · ${invoice.refund.mode === 'credit' ? 'rendu en crédit sur le compte du client' : 'remboursé sur le moyen de paiement'}` : ''}`);
    if (invoice.refund) text(`Motif : ${invoice.refund.reason}`);
    rule();

    // Parties : fournisseur du transport, Neomoov pour les frais, client.
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
    text('Transport fourni et facturé par');
    doc.font('Helvetica').fillColor(INK);
    text(`${invoice.supplier.name}, chauffeur ${invoice.supplier.publicNumber}`);
    doc.fillColor(MUTED);
    text(`TPS : ${taxNumber(invoice.supplier.gstNumber)} · TVQ : ${taxNumber(invoice.supplier.qstNumber)}`);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fillColor(INK);
    text('Frais de service, redevance et péages facturés par');
    doc.font('Helvetica').fillColor(INK);
    text(`${invoice.platform.name}, ${invoice.platform.address}`);
    doc.fillColor(MUTED);
    text(`TPS : ${taxNumber(invoice.platform.gstNumber)} · TVQ : ${taxNumber(invoice.platform.qstNumber)}`);
    if (invoice.customerName) {
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fillColor(INK);
      text('Client');
      doc.font('Helvetica');
      text(invoice.customerName);
    }
    rule();

    // Trajet.
    const trip = invoice.trip;
    doc.font('Helvetica').fontSize(10).fillColor(INK);
    text(`${trip.originAddress} vers ${trip.destinationAddress}`);
    const facts = [CATEGORY_LABELS[trip.category]];
    if (trip.distanceMeters !== null) facts.push(`${(trip.distanceMeters / 1000).toFixed(1).replace('.', ',')} km`);
    if (trip.durationSeconds !== null) facts.push(`${Math.max(1, Math.round(trip.durationSeconds / 60))} min`);
    if (trip.occurredAt) facts.push(formatDateTime(trip.occurredAt));
    doc.fillColor(MUTED);
    text(facts.join(' · '));
    rule();

    // Lignes : transport (chauffeur), puis Neomoov.
    const driverLines = invoice.lines.filter((l) => l.party === 'driver');
    const platformLines = invoice.lines.filter((l) => l.party === 'platform');
    if (driverLines.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED);
      text('Transport (chauffeur)');
      for (const l of driverLines) row(l.label, formatCents(l.amountCents));
      doc.moveDown(0.3);
    }
    if (platformLines.length) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(MUTED);
      text('Neomoov');
      for (const l of platformLines) row(l.label, formatCents(l.amountCents));
      doc.moveDown(0.3);
    }
    const taxes = invoice.taxes;
    row(`TPS, ${formatRate(taxes.gstRatePpm)}`, formatCents(taxes.gstCents));
    row(`TVQ, ${formatRate(taxes.qstRatePpm)}`, formatCents(taxes.qstCents));
    if (taxes.gstCents || taxes.qstCents || taxes.fare.gstCents || taxes.fare.qstCents) {
      row(`dont taxes du chauffeur sur le tarif : TPS ${formatCents(taxes.fare.gstCents)}, TVQ ${formatCents(taxes.fare.qstCents)}`, '', { muted: true });
      row(`dont taxes de Neomoov sur les frais : TPS ${formatCents(taxes.fee.gstCents)}, TVQ ${formatCents(taxes.fee.qstCents)}`, '', { muted: true });
    }
    if (taxes.absorbed.gstCents || taxes.absorbed.qstCents) {
      row(`Taxes du tarif prises en charge par Neomoov (promotion) : TPS ${formatCents(taxes.absorbed.gstCents)}, TVQ ${formatCents(taxes.absorbed.qstCents)}`, '', { muted: true });
    }
    if (invoice.tipCents > 0) row('Pourboire, remis au chauffeur en totalité', formatCents(invoice.tipCents));
    rule();
    row(invoice.kind === 'credit_note' ? 'Total crédité' : 'Total', formatCents(invoice.totalCents), { bold: true });
    doc.moveDown(0.3);
    if (invoice.payment.creditsAppliedCents > 0) row('Payé par crédits', formatCents(invoice.payment.creditsAppliedCents), { muted: true });
    if (invoice.kind !== 'credit_note') row(`Payé par ${PAYMENT_LABELS[invoice.payment.method]}`, formatCents(invoice.payment.paidCents), { muted: true });
    rule();

    // Transaction SEV, code QR de vérification, mention légale.
    const top = doc.y;
    const qrSize = 104;
    const textWidth = qrPng ? width - qrSize - 16 : width;
    const noun = invoice.kind === 'credit_note' ? 'Note de crédit transmise' : 'Facture transmise';
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    doc.text(plain(invoice.sev.transactionId
      ? `${noun} au système d'enregistrement des ventes. Numéro de transaction : ${invoice.sev.transactionId}.`
      : 'Transmission au système d\'enregistrement des ventes en cours : le numéro de transaction figurera sur le document consultable dans l\'application.'), left, top, { width: textWidth });
    doc.moveDown(0.4);
    if (invoice.verificationUrl) {
      doc.fillColor(MUTED).text(plain(`Vérifier ce document : ${invoice.verificationUrl}`), { width: textWidth, link: invoice.verificationUrl });
      doc.moveDown(0.4);
    }
    doc.fillColor(MUTED).text(plain(invoice.legalNotice), { width: textWidth });
    const textBottom = doc.y;
    if (qrPng) doc.image(qrPng, left + width - qrSize, top, { width: qrSize, height: qrSize });
    doc.y = Math.max(textBottom, qrPng ? top + qrSize : 0) + 12;
    doc.x = left;
    doc.fontSize(8).fillColor(MUTED).text(plain('Neomoov, une application conçue par le client pour les chauffeurs. Page 1 de 1'), left, doc.y, { width, align: 'center' });
    doc.end();
  });
}
