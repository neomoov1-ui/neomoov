/**
 * PDF du rapport de performance d'une session (Neomoov Booster) : tableau « au départ, à l'arrivée, différence,
 * interprétation », solde de la session et ratios, mention de la lecture automatique des captures si elle a servi.
 * Même style que les factures ; produit à la confirmation.
 */
import type { PerformanceLogView } from '@neomoov/domain';
import PDFDocument from 'pdfkit';

const INK = '#2c3a4a';
const MUTED = '#5b6776';
const BRAND = '#0b5fb5';
const RULE = '#d5dde6';

function plain(text: string): string {
  return text.replace(/[   ]/g, ' ').replace(/[‐‑–—]/g, '-');
}

export function money(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${(abs % 100).toString().padStart(2, '0')} $`;
}

function time(iso: string | null, timeZone: string): string {
  return iso ? new Intl.DateTimeFormat('fr-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '-';
}

function hours(minutes: number | null): string {
  return minutes === null ? '-' : `${(minutes / 60).toFixed(1).replace('.', ',')} h`;
}

export interface PerformancePdfInput {
  log: PerformanceLogView;
  driverPublicNumber: string;
  driverFullName: string | null;
  companyName: string;
  timeZone: string;
  creationDate?: Date;
}

export function renderPerformancePdf(input: PerformancePdfInput): Promise<Buffer> {
  const { log: l } = input;
  const s = l.summary;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Rapport de performance ${l.date}`, Author: input.companyName, Subject: `Chauffeur ${input.driverPublicNumber}`, ...(input.creationDate ? { CreationDate: input.creationDate } : {}) } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const text = (value: string, options: PDFKit.Mixins.TextOptions = {}) => doc.text(plain(value), options);

    doc.font('Helvetica-Bold').fontSize(17).fillColor(BRAND).text(plain(`${input.companyName} · Neomoov Booster`), left, doc.y);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text(plain(`Rapport de performance · session du ${l.date}`));
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED);
    text(`Chauffeur : ${input.driverFullName ?? ''} (${input.driverPublicNumber}) · Source : ${l.source === 'screenshot' ? 'captures d\'écran lues puis confirmées' : 'saisie du chauffeur'}`, { width });
    doc.moveDown(0.4);
    doc.strokeColor(RULE).lineWidth(0.7).moveTo(left, doc.y).lineTo(left + width, doc.y).stroke();
    doc.moveDown(0.5);

    const cols = [22, 150, 90, 90, 90, width - 442];
    const row = (cells: string[], bold = false) => {
      const y = doc.y;
      let x = left;
      let bottom = y;
      cells.forEach((cell, i) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(INK).text(plain(cell), x, y, { width: cols[i]! - 4 });
        bottom = Math.max(bottom, doc.y);
        x += cols[i]!;
      });
      doc.y = bottom + 3;
    };
    row(['N°', 'Libellé', 'Au départ', 'À l\'arrivée', 'Différence', 'Interprétation'], true);
    const lines: string[][] = [];
    const push = (label: string, start: string, end: string, diff: string, note: string) => lines.push([String(lines.length + 1), label, start, end, diff, note]);
    push('Heures', time(l.startedAt, input.timeZone), time(l.endedAt, input.timeZone), hours(s.sessionMinutes), 'Durée totale de la session.');
    push('Odomètre (km)', l.startOdometerKm?.toString() ?? '-', l.endOdometerKm?.toString() ?? '-', s.distanceKm !== null ? `${s.distanceKm} km` : '-', 'Kilomètres parcourus, à vide compris.');
    push('Autonomie ou carburant (%)', l.startEnergyPercent !== null ? `${l.startEnergyPercent} %` : '-', l.endEnergyPercent !== null ? `${l.endEnergyPercent} %` : '-', s.energyUsedPoints !== null ? `${s.energyUsedPoints} points` : '-', s.energyPer100Km !== null ? `Soit ${s.energyPer100Km.toString().replace('.', ',')} points pour 100 km.` : 'Consommation de la session.');
    push('Temps en ligne', '-', l.onlineMinutes !== null ? `${l.onlineMinutes} min` : '-', hours(l.onlineMinutes), s.drivingSharePercent !== null ? `Au volant en course : ${s.drivingSharePercent} % du temps en ligne.` : 'Temps de session déclaré.');
    push('Courses et livraisons', '-', l.ridesCount?.toString() ?? '-', '', s.grossPerRideCents !== null ? `Recette moyenne : ${money(s.grossPerRideCents)} par course.` : '');
    push('Montant des courses', '-', money(l.ridesCents), '', [s.netPerHourCents !== null ? `${money(Math.round((l.ridesCents * 60) / (s.basisMinutes ?? 1)))} par heure en ligne` : '', s.distanceKm ? `${money(Math.round(l.ridesCents / s.distanceKm))} par km` : ''].filter(Boolean).join(' · ') || 'Recette brute déclarée.');
    push('Pourboires', '-', money(l.tipsCents), '', s.tipsPercent !== null ? `Soit ${s.tipsPercent} % des courses.` : '');
    push('Promotions et primes', '-', money(l.promotionsCents), '', '');
    push('Énergie', '-', money(l.energyCents), '', s.distanceKm ? `Soit ${money(Math.round(l.energyCents / s.distanceKm))} par km.` : '');
    push('Nettoyage', '-', money(l.cleaningCents), '', '');
    if (l.points !== null) push('Points reçus', '-', String(l.points), '', '');
    push('Solde de la session', '-', money(s.netCents), '', `Montant + pourboires + promotions - énergie - nettoyage, avant assurance, location, entretien, impôts et taxes à remettre.${s.netPerHourCents !== null ? ` Soit ${money(s.netPerHourCents)} net par heure.` : ''}${s.netPerKmCents !== null ? ` ${money(s.netPerKmCents)} net par km.` : ''}`);
    if (l.otherNotes) push('Autres', '-', l.otherNotes, '', '');
    for (const line of lines) row(line, line[1] === 'Solde de la session');

    doc.moveDown(0.6);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    text(`Confirmé par le chauffeur le ${l.confirmedAt ? new Intl.DateTimeFormat('fr-CA', { timeZone: input.timeZone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(l.confirmedAt)) : 'non confirmé'}.`, { width });
    if (l.reading.status === 'done') text(`Lecture automatique des captures (${l.reading.promptKey ?? ''}) : aide à la saisie, confiance ${Math.round((l.reading.confidence ?? 0) * 100)} %, confirmée ou corrigée par le chauffeur.`, { width });
    doc.end();
  });
}
