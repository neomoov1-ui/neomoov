/**
 * PDF du rapport de vérification sommaire (Neomoov Booster), dans le style des factures : en-tête, mention légale
 * (article 55 de la Loi, articles 65 et 66 du Règlement), identification, lectures du tableau de bord, tableau des douze
 * éléments, schéma de carrosserie vu de dessus avec les zones touchées, défectuosités et mesures, attestation du
 * chauffeur, photos (JPEG et PNG : pdfkit ne lit pas le WEBP). Produit à l'archivage, jamais plus d'une fois par rapport.
 * Polices standard (WinAnsi) : les caractères hors jeu sont ramenés à leur équivalent.
 */
import { BODY_ZONE_LABELS, BODY_ZONES, INSPECTION_ITEM_LABELS, INSPECTION_ITEMS, type BodyZone, type ItemState, type VehicleInspectionView } from '@neomoov/domain';
import PDFDocument from 'pdfkit';

const INK = '#2c3a4a';
const MUTED = '#5b6776';
const BRAND = '#0b5fb5';
const RULE = '#d5dde6';
const DANGER = '#b42318';
const WARNING = '#b54708';
const OK = '#067647';

const STATE_LABELS: Record<ItemState, string> = { ok: 'Conforme', minor: 'Défectuosité mineure', major: 'Défectuosité majeure', na: 'Sans objet' };
const SEVERITY_LABELS = { ok: 'Aucune défectuosité', minor: 'Défectuosité mineure', major: 'Défectuosité majeure : ne pas mettre le véhicule en service avant réparation' } as const;

function plain(text: string): string {
  return text.replace(/[   ]/g, ' ').replace(/[‐‑]/g, '-').replace(/[–—]/g, '-');
}

function dateTime(iso: string, timeZone: string): string {
  return plain(new Intl.DateTimeFormat('fr-CA', { timeZone, dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso)));
}

export interface InspectionPdfInput {
  inspection: VehicleInspectionView;
  driverPublicNumber: string;
  driverFullName: string | null;
  vehicle: string | null;
  photos: Array<{ kind: string; contentType: string; body: Buffer }>;
  companyName: string;
  timeZone: string;
  creationDate?: Date;
}

/** Schéma de carrosserie vu de dessus (rectangles, zones touchées en couleur) ; largeur et hauteur en points. */
function drawCar(doc: PDFKit.PDFDocument, x: number, y: number, touched: ReadonlySet<BodyZone>): number {
  const w = 120;
  const h = 210;
  const zone = (code: BodyZone, zx: number, zy: number, zw: number, zh: number) => {
    doc.save();
    doc.rect(x + zx, y + zy, zw, zh).lineWidth(0.8).fillAndStroke(touched.has(code) ? '#fde2e1' : '#f3f7f6', touched.has(code) ? DANGER : '#8a97a6');
    doc.restore();
  };
  zone('front_left', 0, 0, w / 2, 42);
  zone('front_right', w / 2, 0, w / 2, 42);
  zone('windshield', 12, 42, w - 24, 24);
  zone('left_side', 0, 66, 24, 78);
  zone('roof', 24, 66, w - 48, 78);
  zone('right_side', w - 24, 66, 24, 78);
  zone('rear_window', 12, 144, w - 24, 24);
  zone('rear_left', 0, 168, w / 2, 42);
  zone('rear_right', w / 2, 168, w / 2, 42);
  doc.fontSize(7).fillColor(MUTED).text('AVANT', x, y - 10, { width: w, align: 'center' }).text('ARRIÈRE', x, y + h + 3, { width: w, align: 'center' });
  return h + 16;
}

export function renderInspectionPdf(input: InspectionPdfInput): Promise<Buffer> {
  const { inspection: r } = input;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER', margin: 48,
      info: { Title: `Rapport de vérification sommaire ${r.inspectedAt.slice(0, 10)}`, Author: input.companyName, Subject: `Chauffeur ${input.driverPublicNumber}`, ...(input.creationDate ? { CreationDate: input.creationDate } : {}) },
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
    const pair = (label: string, value: string) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(plain(label), left, y, { width: 170 });
      doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(plain(value), left + 175, y, { width: width - 175 });
      doc.y = Math.max(doc.y, y + 13);
    };

    // En-tête.
    doc.font('Helvetica-Bold').fontSize(17).fillColor(BRAND).text(plain(`${input.companyName} · Neomoov Booster`), left, doc.y);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Rapport de vérification sommaire avant départ');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    text('Article 55 de la Loi concernant le transport rémunéré de personnes par automobile ; articles 65 et 66 du Règlement. Rapport à conserver dans le véhicule et remis au répartiteur.', { width });
    rule();

    // Identification (article 66).
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Identification');
    doc.moveDown(0.3);
    pair('Date et heure de la vérification', dateTime(r.inspectedAt, input.timeZone));
    pair('Plaque d\'immatriculation', r.plate ?? 'non indiquée');
    pair('Numéro d\'accessoire', r.accessoryNumber ?? 'non indiqué');
    pair('Véhicule', input.vehicle ?? 'non déclaré');
    pair('Chauffeur qualifié', `${r.driverName ?? input.driverFullName ?? 'non indiqué'} (${input.driverPublicNumber})`);
    pair('Numéro de permis', r.licenceNumber ?? 'non indiqué');
    pair('Odomètre', r.odometerKm !== null ? `${r.odometerKm.toLocaleString('fr-CA')} km` : 'non lu');
    pair('État de charge ou carburant', r.energyPercent !== null ? `${r.energyPercent} %` : 'non lu');
    pair('Voyant allumé', r.warningLightOn ? `oui : ${r.warningLightReason ?? 'motif non précisé'}` : 'aucun');
    rule();

    // Éléments de l'article 65.
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Éléments vérifiés (article 65 du Règlement)');
    doc.moveDown(0.3);
    const col = { n: 18, label: 230, state: 120 };
    const header = doc.y;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED);
    doc.text('N°', left, header, { width: col.n });
    doc.text('Élément', left + col.n, header, { width: col.label });
    doc.text('État', left + col.n + col.label, header, { width: col.state });
    doc.text('Observation', left + col.n + col.label + col.state, header, { width: width - col.n - col.label - col.state });
    doc.y = header + 12;
    INSPECTION_ITEMS.forEach((item, index) => {
      const entry = r.items[item];
      const y = doc.y;
      const colour = entry.state === 'major' ? DANGER : entry.state === 'minor' ? WARNING : entry.state === 'ok' ? OK : MUTED;
      doc.font('Helvetica').fontSize(8.5).fillColor(INK);
      doc.text(String(index + 1), left, y, { width: col.n });
      doc.text(plain(INSPECTION_ITEM_LABELS[item].fr), left + col.n, y, { width: col.label - 6 });
      const afterLabel = doc.y;
      doc.fillColor(colour).text(plain(STATE_LABELS[entry.state]), left + col.n + col.label, y, { width: col.state - 6 });
      doc.fillColor(INK).text(plain(entry.note ?? ''), left + col.n + col.label + col.state, y, { width: width - col.n - col.label - col.state });
      doc.y = Math.max(afterLabel, doc.y) + 2;
    });
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(r.allItemsChecked ? OK : DANGER);
    text(r.allItemsChecked ? 'Tous les éléments prévus à l\'article 65 ont été vérifiés.' : 'Vérification incomplète.');
    rule();

    // Carrosserie et défectuosités.
    if (doc.y > doc.page.height - 330) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Défectuosités et carrosserie');
    doc.moveDown(0.5);
    const top = doc.y + 10;
    const touched = new Set<BodyZone>(r.bodyZones.map((z) => z.zone));
    const carHeight = drawCar(doc, left, top, touched);
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    let ty = top;
    if (!r.bodyZones.length) {
      doc.text('Aucune zone de carrosserie touchée.', left + 150, ty, { width: width - 150 });
      ty = doc.y;
    }
    for (const zone of BODY_ZONES) {
      const entry = r.bodyZones.find((z) => z.zone === zone);
      if (!entry) continue;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(DANGER).text(plain(BODY_ZONE_LABELS[zone].fr), left + 150, ty, { width: width - 150 });
      doc.font('Helvetica').fontSize(9).fillColor(INK).text(plain(entry.description), left + 150, doc.y, { width: width - 150 });
      ty = doc.y + 4;
    }
    doc.y = Math.max(ty, top + carHeight) + 6;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    text(`Défectuosités et mesures : ${r.notes ?? 'aucune'}`, { width });
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(r.severity === 'major' ? DANGER : r.severity === 'minor' ? WARNING : OK);
    text(`Gravité globale : ${SEVERITY_LABELS[r.severity]}`, { width });
    rule();

    // Confirmation et analyse.
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    text(`Rapport confirmé par le chauffeur le ${r.confirmedAt ? dateTime(r.confirmedAt, input.timeZone) : 'non confirmé'}.`, { width });
    if (r.analysis.status === 'done') {
      text(`Analyse automatique des photos (${r.analysis.promptKey ?? ''}) : aide à la saisie, confiance ${Math.round((r.analysis.confidence ?? 0) * 100)} %, confirmée ou corrigée par le chauffeur.`, { width });
    } else {
      text('Rapport saisi par le chauffeur, sans analyse automatique.', { width });
    }

    // Photos.
    const printable = input.photos.filter((p) => p.contentType === 'image/jpeg' || p.contentType === 'image/png').slice(0, 6);
    if (printable.length) {
      doc.addPage();
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Photos de la vérification');
      doc.moveDown(0.5);
      const cell = { w: (width - 16) / 2, h: 190 };
      printable.forEach((photo, index) => {
        const colIndex = index % 2;
        const rowIndex = Math.floor(index / 2);
        const x = left + colIndex * (cell.w + 16);
        const y = doc.y + rowIndex * (cell.h + 22);
        try {
          doc.image(photo.body, x, y, { fit: [cell.w, cell.h - 14], align: 'center', valign: 'center' });
        } catch {
          doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Photo illisible', x, y);
        }
        doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(plain(photo.kind), x, y + cell.h - 10, { width: cell.w });
      });
    }
    doc.end();
  });
}
