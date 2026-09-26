/**
 * PDF du relevé hebdomadaire (section 5.8) : en-tête, période, détail ligne par ligne (chaque course renvoie à sa fiche
 * dans l'application chauffeur), totaux et règlement. Produit par la file `settlements`, jamais dans une requête HTTP.
 */
import type { AdminStatementDetail } from '@neomoov/domain';
import PDFDocument from 'pdfkit';

const DRIVER_APP_RIDE_LINK = 'neomoov-driver://ride/';

function money(cents: number): string {
  // Trait d'union ASCII : la police standard du PDF (WinAnsi) n'a pas le signe moins typographique.
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${String(abs % 100).padStart(2, '0')} $`;
}

function day(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
}

const SETTLEMENT_TEXT: Record<string, string> = {
  draft: 'Brouillon, non émis',
  issued: 'Émis, règlement en cours',
  paid: 'Versé sur votre compte',
  charged: 'Prélevé sur votre carte',
  failed: 'Règlement en échec : nouvelle tentative le lundi',
};

export function renderStatementPdf(statement: AdminStatementDetail, options: { timeZone: string; companyName: string }): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50, info: { Title: `Relevé ${statement.periodStart} au ${statement.periodEnd}`, Author: options.companyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).fillColor('#0B1F3A').text(`${options.companyName} · Relevé hebdomadaire`);
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333333');
    doc.text(`Chauffeur : ${statement.driverName ?? ''} (${statement.driverPublicNumber})`);
    doc.text(`Période : du lundi ${statement.periodStart} au dimanche ${statement.periodEnd} (heure de Montréal)`);
    if (statement.issuedAt) doc.text(`Émis le ${day(statement.issuedAt, options.timeZone)}`);
    doc.moveDown(0.8);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const columns = { date: left, label: left + 70, amount: left + width - 90 };
    const header = () => {
      doc.fontSize(9).fillColor('#0B1F3A');
      const y = doc.y;
      doc.text('Date', columns.date, y, { width: 65 });
      doc.text('Détail', columns.label, y, { width: columns.amount - columns.label - 10 });
      doc.text('Montant', columns.amount, y, { width: 90, align: 'right' });
      doc.moveTo(left, doc.y + 2).lineTo(left + width, doc.y + 2).strokeColor('#CCCCCC').stroke();
      doc.moveDown(0.4);
    };
    header();
    doc.fillColor('#000000');
    for (const line of statement.lines) {
      if (doc.y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        header();
        doc.fillColor('#000000');
      }
      const y = doc.y;
      doc.fontSize(9).text(day(line.occurredAt, options.timeZone), columns.date, y, { width: 65 });
      doc.text(line.label, columns.label, y, { width: columns.amount - columns.label - 10, ...(line.rideId ? { link: `${DRIVER_APP_RIDE_LINK}${line.rideId}`, underline: true } : {}) });
      const after = doc.y;
      doc.text(money(line.amountCents), columns.amount, y, { width: 90, align: 'right' });
      doc.y = Math.max(after, doc.y);
      doc.moveDown(0.2);
    }
    if (!statement.lines.length) doc.fontSize(9).text('Aucune ligne pour cette période.', left);

    doc.moveDown(0.8);
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor('#CCCCCC').stroke();
    doc.moveDown(0.4);
    const total = (label: string, cents: number, bold = false) => {
      const y = doc.y;
      doc.fontSize(bold ? 11 : 10).fillColor(bold ? '#0B1F3A' : '#000000').text(label, left, y, { width: width - 100 });
      doc.text(money(cents), columns.amount, y, { width: 90, align: 'right' });
      doc.moveDown(0.2);
    };
    total('Crédits', statement.creditsCents);
    total('Débits', -statement.debitsCents);
    total(statement.netCents >= 0 ? 'Net à vous verser' : 'Net à prélever', statement.netCents, true);
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor('#333333').text(`Règlement : ${SETTLEMENT_TEXT[statement.status] ?? statement.status}`, left);
    doc.moveDown(0.3);
    doc.text('Les taxes perçues sur vos tarifs vous sont reversées : vous les déclarez vous-même (rapport trimestriel disponible dans l\'application).', left, doc.y, { width });
    doc.end();
  });
}
