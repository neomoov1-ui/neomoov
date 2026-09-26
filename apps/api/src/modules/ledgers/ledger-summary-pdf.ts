/**
 * Rapport de synthèse PDF d'un registre (redevance ou taxes) sur un mois ou un trimestre, pour Revenu Québec et le
 * comptable : totaux par mois, total de la période et, pour les taxes, le détail par chauffeur. Produit par le worker.
 * Polices standard (Helvetica, encodage WinAnsi) : les montants sont écrits avec des espaces ordinaires.
 */
import type { LedgerMonthView, LedgerPeriod, LedgerType } from '@neomoov/domain';
import PDFDocument from 'pdfkit';

export interface SummaryDriverRow {
  publicNumber: string;
  gstNumber: string | null;
  qstNumber: string | null;
  rideCount: number;
  fareCents: number;
  gstCents: number;
  qstCents: number;
}

export interface LedgerSummaryPdfInput {
  type: LedgerType;
  period: LedgerPeriod;
  companyName: string;
  generatedAt: Date;
  timeZone: string;
  /** Mois qui ont des lignes ; les autres mois de la période sont affichés à zéro. */
  months: LedgerMonthView[];
  drivers: SummaryDriverRow[];
}

const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** 123456 → « 1 234,56 $ » (format canadien français, espaces ordinaires). */
export function formatCad(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${dollars},${String(abs % 100).padStart(2, '0')} $`;
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${year}`;
}

function periodLabel(period: LedgerPeriod): string {
  if (period.kind === 'month') return monthLabel(period.code);
  return `${period.code.slice(5)} ${period.code.slice(0, 4)} (${monthLabel(period.months[0]!)} à ${monthLabel(period.months[2]!)})`;
}

function emptyMonth(period: string): LedgerMonthView {
  return { period, rideCount: 0, redevanceCents: 0, redevanceBilledCents: 0, remittedCents: 0, unremittedCount: 0, remittedAt: null, fareGstCents: 0, fareQstCents: 0, feeGstCents: 0, feeQstCents: 0 };
}

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

export function renderLedgerSummaryPdf(input: LedgerSummaryPdfInput): Promise<Buffer> {
  const title = input.type === 'redevance' ? 'Registre de la redevance : rapport de synthèse' : 'Registre des taxes : rapport de synthèse';
  const months = input.period.months.map((m) => input.months.find((row) => row.period === m) ?? emptyMonth(m));
  // Les espaces insécables étroites d'Intl n'existent pas dans l'encodage des polices standard.
  const generated = new Intl.DateTimeFormat('fr-CA', { timeZone: input.timeZone, dateStyle: 'long', timeStyle: 'short' }).format(input.generatedAt).replace(/[  ]/g, ' ');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', layout: input.type === 'taxes' ? 'landscape' : 'portrait', margin: 40, info: { Title: `${title} ${input.period.code}`, Author: input.companyName } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;

    /** Tableau simple : en-tête en gras, lignes, saut de page avec rappel de l'en-tête. */
    const table = (columns: Column[], rows: string[][], boldLast = false) => {
      const drawRow = (cells: string[], bold: boolean) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 30) doc.addPage();
        const y = doc.y;
        let x = left;
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
        let height = 0;
        columns.forEach((column, i) => {
          doc.text(cells[i] ?? '', x, y, { width: column.width - 6, align: column.align ?? 'left' });
          height = Math.max(height, doc.y - y);
          x += column.width;
        });
        doc.x = left;
        doc.y = y + height + 4;
      };
      drawRow(columns.map((c) => c.header), true);
      rows.forEach((cells, index) => drawRow(cells, boldLast && index === rows.length - 1));
      doc.moveDown(0.5);
    };

    doc.font('Helvetica-Bold').fontSize(16).text(title);
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#333333');
    doc.text(`${input.companyName} · Période : ${periodLabel(input.period)} · du ${input.period.startDate} au ${input.period.endDate}`);
    doc.text(`Produit le ${generated} (heure de Montréal). Montants en dollars canadiens ; périodes selon la date de fin de course.`);
    doc.fillColor('#000000').moveDown(0.8);

    if (input.type === 'redevance') {
      const totals = months.reduce((t, m) => ({ n: t.n + m.rideCount, due: t.due + m.redevanceCents, billed: t.billed + m.redevanceBilledCents, remitted: t.remitted + m.remittedCents }), { n: 0, due: 0, billed: 0, remitted: 0 });
      doc.font('Helvetica-Bold').fontSize(12).text('Totaux par mois');
      doc.moveDown(0.3);
      table(
        [{ header: 'Mois', width: 110 }, { header: 'Courses', width: 60, align: 'right' }, { header: 'Redevance due', width: 90, align: 'right' }, { header: 'Facturée aux clients', width: 90, align: 'right' }, { header: 'Remise', width: 90, align: 'right' }, { header: 'À remettre', width: 90, align: 'right' }],
        [
          ...months.map((m) => [monthLabel(m.period), String(m.rideCount), formatCad(m.redevanceCents), formatCad(m.redevanceBilledCents), formatCad(m.remittedCents), formatCad(m.redevanceCents - m.remittedCents)]),
          ['Total', String(totals.n), formatCad(totals.due), formatCad(totals.billed), formatCad(totals.remitted), formatCad(totals.due - totals.remitted)],
        ],
        true,
      );
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(
        'La redevance est due pour chaque course terminée, au montant en vigueur, même quand Neomoov l\'a absorbée (course offerte) : l\'écart entre la redevance due et la redevance facturée est à la charge de Neomoov. Traitement à confirmer avec le comptable.',
      );
    } else {
      const totals = months.reduce((t, m) => ({ n: t.n + m.rideCount, fareGst: t.fareGst + m.fareGstCents, fareQst: t.fareQst + m.fareQstCents, feeGst: t.feeGst + m.feeGstCents, feeQst: t.feeQst + m.feeQstCents }), { n: 0, fareGst: 0, fareQst: 0, feeGst: 0, feeQst: 0 });
      doc.font('Helvetica-Bold').fontSize(12).text('Totaux par mois');
      doc.moveDown(0.3);
      table(
        [{ header: 'Mois', width: 120 }, { header: 'Courses', width: 60, align: 'right' }, { header: 'TPS sur les tarifs (chauffeurs)', width: 120, align: 'right' }, { header: 'TVQ sur les tarifs (chauffeurs)', width: 120, align: 'right' }, { header: 'TPS sur les frais (Neomoov)', width: 120, align: 'right' }, { header: 'TVQ sur les frais (Neomoov)', width: 120, align: 'right' }],
        [
          ...months.map((m) => [monthLabel(m.period), String(m.rideCount), formatCad(m.fareGstCents), formatCad(m.fareQstCents), formatCad(m.feeGstCents), formatCad(m.feeQstCents)]),
          ['Total', String(totals.n), formatCad(totals.fareGst), formatCad(totals.fareQst), formatCad(totals.feeGst), formatCad(totals.feeQst)],
        ],
        true,
      );
      doc.font('Helvetica').fontSize(9).fillColor('#333333').text(
        'Les taxes sur les tarifs appartiennent aux chauffeurs, fournisseurs du transport, qui les déclarent et les remettent eux-mêmes (décision D26) ; Neomoov déclare et remet les taxes perçues sur ses frais de service et sur la redevance. Traitement à confirmer avec le comptable.',
      );
      doc.fillColor('#000000').moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(12).text('Détail par chauffeur (taxes sur les tarifs)');
      doc.moveDown(0.3);
      table(
        [{ header: 'Chauffeur', width: 90 }, { header: 'No de TPS', width: 120 }, { header: 'No de TVQ', width: 120 }, { header: 'Courses', width: 60, align: 'right' }, { header: 'Tarifs', width: 90, align: 'right' }, { header: 'TPS', width: 80, align: 'right' }, { header: 'TVQ', width: 80, align: 'right' }],
        input.drivers.length
          ? input.drivers.map((d) => [d.publicNumber, d.gstNumber ?? 'non fourni', d.qstNumber ?? 'non fourni', String(d.rideCount), formatCad(d.fareCents), formatCad(d.gstCents), formatCad(d.qstCents)])
          : [['Aucune course sur la période', '', '', '', '', '', '']],
      );
    }
    doc.end();
  });
}
