/**
 * PDF d'une facture de la plateforme (étape 25), au même moteur que les factures de course (pdfkit, polices standard,
 * texte ramené au jeu WinAnsi) : Neomoov et ses numéros de taxes, l'organisation cliente et les siens, période,
 * lignes (installation, abonnement, véhicules actifs), sous-total, TPS, TVQ, total, échéance ou règlement. En français
 * (document fiscal remis au Québec).
 */
import type { PlatformInvoiceView, TaxRates } from '@neomoov/domain';
import PDFDocument from 'pdfkit';
import { formatCents } from '../invoicing/invoice-pdf.js';

const INK = '#2c3a4a';
const MUTED = '#5b6776';
const BRAND = '#0b5fb5';
const RULE = '#d5dde6';

export interface PlatformInvoicePdfInput {
  invoice: PlatformInvoiceView;
  rates: TaxRates;
  timeZone: string;
  seller: { name: string; address: string; gstNumber: string | null; qstNumber: string | null };
  customer: { name: string; gstNumber: string | null; qstNumber: string | null };
  /** Date fixe des métadonnées du PDF (exemples reproductibles) ; sinon, l'instant du rendu. */
  creationDate?: Date;
}

/** Espaces fines et insécables, tirets insécables : hors du jeu WinAnsi des polices standard. */
function plain(text: string): string {
  return text.replace(/[   ]/g, ' ').replace(/[‐‑]/g, '-');
}

function rate(ppm: number): string {
  return `${(ppm / 10_000).toString().replace('.', ',')} %`;
}

const taxNumber = (value: string | null) => (value && value.trim() ? value : 'non fourni');

export function renderPlatformInvoicePdf(input: PlatformInvoicePdfInput): Promise<Buffer> {
  const { invoice, rates, seller, customer } = input;
  const date = (iso: string) => plain(new Intl.DateTimeFormat('fr-CA', { timeZone: input.timeZone, dateStyle: 'long' }).format(new Date(iso)));
  // La période couvre [début, fin[ : le dernier jour affiché est la veille de la fin.
  const lastDay = new Date(new Date(invoice.periodEnd).getTime() - 1).toISOString();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER', margin: 48,
      info: { Title: `Facture ${invoice.number}`, Author: seller.name, Subject: 'Abonnement à la plateforme Neomoov', ...(input.creationDate ? { CreationDate: input.creationDate } : {}) },
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

    doc.font('Helvetica-Bold').fontSize(22).fillColor(BRAND).text('neomoov', left, doc.y);
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK);
    text(`Facture N° ${invoice.number}`);
    doc.font('Helvetica').fontSize(10).fillColor(MUTED);
    const due = invoice.dueAt <= invoice.issuedAt ? 'payable à réception' : `échéance le ${date(invoice.dueAt)}`;
    text(`Émise le ${date(invoice.issuedAt)} · ${due}`);
    text(`Période du ${date(invoice.periodStart)} au ${date(lastDay)}`);
    rule();

    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK);
    text('Facturé par');
    doc.font('Helvetica');
    text(`${seller.name}, ${seller.address}`);
    doc.fillColor(MUTED);
    text(`TPS : ${taxNumber(seller.gstNumber)} · TVQ : ${taxNumber(seller.qstNumber)}`);
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fillColor(INK);
    text('Client');
    doc.font('Helvetica');
    text(customer.name);
    if (customer.gstNumber || customer.qstNumber) {
      doc.fillColor(MUTED);
      text(`TPS : ${taxNumber(customer.gstNumber)} · TVQ : ${taxNumber(customer.qstNumber)}`);
    }
    rule();

    for (const line of invoice.lines) row(line.quantity > 1 ? `${line.label} : ${line.quantity} × ${formatCents(line.unitCents)}` : line.label, formatCents(line.amountCents));
    rule();
    row('Sous-total', formatCents(invoice.subtotalCents));
    row(`TPS, ${rate(rates.gstRatePpm)}`, formatCents(invoice.gstCents));
    row(`TVQ, ${rate(rates.qstRatePpm)}`, formatCents(invoice.qstCents));
    rule();
    row('Total', formatCents(invoice.totalCents), { bold: true });
    doc.moveDown(0.3);
    if (invoice.status === 'paid' && invoice.paidAt) {
      row(`Payée le ${date(invoice.paidAt)}${invoice.paymentMethod === 'offline' ? ` (règlement hors plateforme${invoice.paymentReference ? `, référence ${invoice.paymentReference}` : ''})` : ' (Stripe)'}`, formatCents(invoice.totalCents), { muted: true });
    } else if (invoice.status === 'void') {
      row('Facture annulée', '', { muted: true });
    } else {
      row('Montant à payer', formatCents(invoice.totalCents), { muted: true });
      if (invoice.hostedInvoiceUrl) {
        doc.moveDown(0.3);
        doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(plain(`Payer en ligne : ${invoice.hostedInvoiceUrl}`), { width, link: invoice.hostedInvoiceUrl });
      }
    }
    rule();
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    text('Abonnement à la plateforme Neomoov. Montants en dollars canadiens, taxes en sus du sous-total. Page 1 de 1', { width, align: 'center' });
    doc.end();
  });
}
