/**
 * Neomoov Booster (phase 1, agent G) : rapport de vérification sommaire avant départ. Article 55 de la Loi concernant le
 * transport rémunéré de personnes par automobile (vérification sommaire du véhicule avant la première utilisation de la
 * journée) ; articles 65 (éléments à vérifier) et 66 (contenu du rapport, conservé dans le véhicule) du Règlement.
 * Fonctions pures : éléments, zones de carrosserie, gravité globale, sortie attendue de l'analyse des photos par le
 * modèle et préremplissage du rapport. L'analyse est une aide : le chauffeur confirme ou corrige avant l'archivage.
 */
import { z } from 'zod';

/** Les douze éléments de l'article 65 du Règlement, dans l'ordre du formulaire. */
export const INSPECTION_ITEMS = [
  'brake_fluid', 'parking_brake', 'lights', 'tires', 'valves', 'wipers', 'washer', 'mirrors', 'roof_light', 'warning_lights', 'battery', 'ramp',
] as const;
export type InspectionItem = (typeof INSPECTION_ITEMS)[number];

export const INSPECTION_ITEM_LABELS: Readonly<Record<InspectionItem, { fr: string; en: string }>> = {
  brake_fluid: { fr: 'Niveau du liquide de frein', en: 'Brake fluid level' },
  parking_brake: { fr: 'Frein de stationnement', en: 'Parking brake' },
  lights: { fr: 'Phares, feux et indicateurs de signalement', en: 'Headlights, lights and signals' },
  tires: { fr: 'Pneus', en: 'Tires' },
  valves: { fr: 'Valves des pneus', en: 'Tire valves' },
  wipers: { fr: 'Essuie-glaces', en: 'Windshield wipers' },
  washer: { fr: 'Lave-glace', en: 'Washer fluid' },
  mirrors: { fr: 'Rétroviseurs', en: 'Mirrors' },
  roof_light: { fr: 'Lanternon (taxi) : fixation et fonctionnement', en: 'Roof light (taxi): mounting and operation' },
  warning_lights: { fr: 'Voyants du tableau de bord', en: 'Dashboard warning lights' },
  battery: { fr: 'État de charge de la batterie (véhicule électrique)', en: 'Battery state of charge (electric vehicle)' },
  ramp: { fr: 'Rampe ou plateforme et ancrages (véhicule adapté)', en: 'Ramp or lift and tie-downs (adapted vehicle)' },
};

/** État d'un élément : conforme, défectuosité mineure, défectuosité majeure, sans objet. */
export const ITEM_STATES = ['ok', 'minor', 'major', 'na'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

/** Zones du schéma de carrosserie (vue de dessus). */
export const BODY_ZONES = ['front_left', 'front_right', 'rear_left', 'rear_right', 'windshield', 'rear_window', 'roof', 'left_side', 'right_side'] as const;
export type BodyZone = (typeof BODY_ZONES)[number];

export const BODY_ZONE_LABELS: Readonly<Record<BodyZone, { fr: string; en: string }>> = {
  front_left: { fr: 'Avant gauche', en: 'Front left' },
  front_right: { fr: 'Avant droit', en: 'Front right' },
  rear_left: { fr: 'Arrière gauche', en: 'Rear left' },
  rear_right: { fr: 'Arrière droit', en: 'Rear right' },
  windshield: { fr: 'Pare-brise', en: 'Windshield' },
  rear_window: { fr: 'Lunette arrière', en: 'Rear window' },
  roof: { fr: 'Toit', en: 'Roof' },
  left_side: { fr: 'Côté gauche', en: 'Left side' },
  right_side: { fr: 'Côté droit', en: 'Right side' },
};

export const INSPECTION_SEVERITIES = ['ok', 'minor', 'major'] as const;
export type InspectionSeverity = (typeof INSPECTION_SEVERITIES)[number];

/** `draft` : photos et saisie ; `analysed` : analyse automatique faite, à confirmer ; `archived` : confirmé par le chauffeur, PDF produit. */
export const INSPECTION_STATUSES = ['draft', 'analysed', 'archived'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** Vues photographiées dans le parcours guidé. */
export const PHOTO_KINDS = ['front_left', 'front_right', 'rear_left', 'rear_right', 'left_side', 'right_side', 'windshield', 'dashboard', 'tires', 'other'] as const;
export type PhotoKind = (typeof PHOTO_KINDS)[number];

/** Étapes du parcours (une par vue) : six obligatoires, les autres recommandées ; de 6 à 12 photos au total. */
export const INSPECTION_PHOTO_STEPS: ReadonlyArray<{ kind: PhotoKind; required: boolean }> = [
  { kind: 'front_left', required: true },
  { kind: 'front_right', required: true },
  { kind: 'rear_left', required: true },
  { kind: 'rear_right', required: true },
  { kind: 'left_side', required: true },
  { kind: 'right_side', required: true },
  { kind: 'windshield', required: false },
  { kind: 'dashboard', required: false },
  { kind: 'tires', required: false },
];

export const DEFECT_KINDS = ['scratch', 'dent', 'crack', 'worn_tire', 'other'] as const;
export type DefectKind = (typeof DEFECT_KINDS)[number];

export const DEFECT_KIND_LABELS: Readonly<Record<DefectKind, { fr: string; en: string }>> = {
  scratch: { fr: 'rayure', en: 'scratch' },
  dent: { fr: 'bosse', en: 'dent' },
  crack: { fr: 'bris', en: 'crack' },
  worn_tire: { fr: 'pneu usé', en: 'worn tire' },
  other: { fr: 'autre défaut', en: 'other defect' },
};

export const inspectionItemEntrySchema = z.object({
  state: z.enum(ITEM_STATES),
  note: z.string().trim().max(200).nullable().default(null),
});
export type InspectionItemEntry = z.infer<typeof inspectionItemEntrySchema>;

/** Les douze éléments, tous présents (un élément non concerné vaut `na`). */
export const inspectionItemsSchema = z.object({
  brake_fluid: inspectionItemEntrySchema,
  parking_brake: inspectionItemEntrySchema,
  lights: inspectionItemEntrySchema,
  tires: inspectionItemEntrySchema,
  valves: inspectionItemEntrySchema,
  wipers: inspectionItemEntrySchema,
  washer: inspectionItemEntrySchema,
  mirrors: inspectionItemEntrySchema,
  roof_light: inspectionItemEntrySchema,
  warning_lights: inspectionItemEntrySchema,
  battery: inspectionItemEntrySchema,
  ramp: inspectionItemEntrySchema,
});
export type InspectionItems = z.infer<typeof inspectionItemsSchema>;

export const bodyZoneEntrySchema = z.object({
  zone: z.enum(BODY_ZONES),
  description: z.string().trim().min(1).max(200),
});
export type BodyZoneEntry = z.infer<typeof bodyZoneEntrySchema>;

/** Tous les éléments conformes, sans observation : point de départ d'un rapport. */
export function defaultInspectionItems(): InspectionItems {
  const items = {} as Record<InspectionItem, InspectionItemEntry>;
  for (const item of INSPECTION_ITEMS) items[item] = { state: 'ok', note: null };
  return items;
}

/** Éléments en défectuosité majeure. */
export function majorItems(items: InspectionItems): InspectionItem[] {
  return INSPECTION_ITEMS.filter((item) => items[item].state === 'major');
}

/**
 * Gravité globale du rapport : majeure dès qu'un élément est en défectuosité majeure (le véhicule ne doit pas être mis
 * en service avant réparation) ; mineure si un élément est en défectuosité mineure ou si une zone de carrosserie est
 * touchée ; conforme sinon.
 */
export function overallSeverity(items: InspectionItems, zones: readonly BodyZoneEntry[]): InspectionSeverity {
  if (majorItems(items).length) return 'major';
  if (INSPECTION_ITEMS.some((item) => items[item].state === 'minor') || zones.length) return 'minor';
  return 'ok';
}

/** Plaque normalisée : majuscules, sans espace ni trait d'union, 12 caractères au plus ; nulle si rien ne reste. */
export function normalizePlate(value: string | null | undefined): string | null {
  const plate = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return plate.length ? plate : null;
}

const confidence = z.number().min(0).max(1);

/** Sortie structurée attendue du modèle pour l'analyse des photos (prompt `vehicle-inspection.v1`). */
export const inspectionAnalysisSchema = z.object({
  /** Lecture de l'odomètre (kilomètres), nulle si illisible. */
  odometerKm: z.number().int().min(0).max(2_000_000).nullable(),
  /** État de charge (véhicule électrique) ou niveau de carburant, en pourcentage, nul si illisible. */
  energyPercent: z.number().int().min(0).max(100).nullable(),
  plate: z.string().max(20).nullable(),
  warningLights: z.array(z.object({ name: z.string().max(60), probableCause: z.string().max(200) })).max(12),
  defects: z.array(z.object({
    zone: z.enum(BODY_ZONES),
    kind: z.enum(DEFECT_KINDS),
    description: z.string().max(200),
    severity: z.enum(['minor', 'major']),
  })).max(30),
  /** Éléments de l'article 65 visibles sur les photos, jugés conformes ou non ; les autres ne sont pas listés. */
  items: z.array(z.object({ item: z.enum(INSPECTION_ITEMS), state: z.enum(['ok', 'minor', 'major']), observation: z.string().max(200).nullable() })).max(12),
  confidence: z.object({ odometerKm: confidence, energyPercent: confidence, plate: confidence, warningLights: confidence, defects: confidence, items: confidence }),
  /** Index (dans l'ordre d'envoi) des photos floues, sombres ou hors sujet. */
  photosUnusable: z.array(z.number().int().min(0)).max(12),
  summary: z.string().max(400),
});
export type InspectionAnalysis = z.infer<typeof inspectionAnalysisSchema>;

export interface InspectionPrefill {
  odometerKm: number | null;
  energyPercent: number | null;
  plate: string | null;
  warningLightOn: boolean;
  warningLightReason: string | null;
  items: InspectionItems;
  /** Éléments dont l'état vient de l'analyse (les autres gardent l'état de départ, à confirmer par le chauffeur). */
  itemsFromAnalysis: InspectionItem[];
  bodyZones: BodyZoneEntry[];
  severity: InspectionSeverity;
  /** Moyenne des confiances par champ, de 0 à 1, arrondie au centième. */
  confidence: number;
  photosUnusable: number[];
}

/**
 * Préremplissage du rapport à partir de l'analyse : les champs lus remplacent ceux de `base` (les éléments déjà saisis
 * par le chauffeur en défectuosité restent) ; une zone touchée par plusieurs défauts reçoit une seule description ;
 * un défaut majeur sur un pneu met l'élément « pneus » en défectuosité majeure.
 */
export function prefillFromAnalysis(analysis: InspectionAnalysis, base: InspectionItems = defaultInspectionItems()): InspectionPrefill {
  const items = { ...base };
  const itemsFromAnalysis: InspectionItem[] = [];
  for (const read of analysis.items) {
    if (base[read.item].state !== 'ok' && base[read.item].state !== 'na') continue;
    items[read.item] = { state: read.state, note: read.observation?.trim() || null };
    itemsFromAnalysis.push(read.item);
  }
  const zones = new Map<BodyZone, string[]>();
  for (const defect of analysis.defects) {
    const label = `${DEFECT_KIND_LABELS[defect.kind].fr}${defect.description.trim() ? ` : ${defect.description.trim()}` : ''}`;
    zones.set(defect.zone, [...(zones.get(defect.zone) ?? []), label]);
    if (defect.kind === 'worn_tire' && defect.severity === 'major' && items.tires.state !== 'major') {
      items.tires = { state: 'major', note: defect.description.trim() || DEFECT_KIND_LABELS.worn_tire.fr };
      if (!itemsFromAnalysis.includes('tires')) itemsFromAnalysis.push('tires');
    }
  }
  const bodyZones: BodyZoneEntry[] = [...zones.entries()].map(([zone, labels]) => ({ zone, description: labels.join(' ; ').slice(0, 200) }));
  const warningLightOn = analysis.warningLights.length > 0;
  const warningLightReason = warningLightOn ? analysis.warningLights.map((w) => `${w.name}${w.probableCause ? ` (${w.probableCause})` : ''}`).join(' ; ').slice(0, 300) : null;
  if (warningLightOn && items.warning_lights.state === 'ok') {
    items.warning_lights = { state: 'minor', note: warningLightReason };
    if (!itemsFromAnalysis.includes('warning_lights')) itemsFromAnalysis.push('warning_lights');
  }
  const c = analysis.confidence;
  const values = [c.odometerKm, c.energyPercent, c.plate, c.warningLights, c.defects, c.items];
  const mean = Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 100) / 100;
  return {
    odometerKm: analysis.odometerKm,
    energyPercent: analysis.energyPercent,
    plate: normalizePlate(analysis.plate),
    warningLightOn,
    warningLightReason,
    items,
    itemsFromAnalysis,
    bodyZones,
    severity: overallSeverity(items, bodyZones),
    confidence: mean,
    photosUnusable: [...new Set(analysis.photosUnusable)].sort((a, b) => a - b),
  };
}
