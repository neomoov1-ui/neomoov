/**
 * Schémas de l'API de Neomoov Booster (phase 1, agent G) : rapports de vérification sommaire (photos, analyse,
 * confirmation, archive), rapports de performance (saisie, captures d'écran, récapitulatifs) et réglages des alertes.
 * Les clés de stockage ne sortent jamais : les photos et les PDF sont servis par l'API ou par un lien signé de courte durée.
 */
import { z } from 'zod';
import { ALERT_SOUNDS, alertRemindersSchema, alertStylesSchema, driverAlertSettingsSchema, gainWindowSchema, timeOfDaySchema } from '../booster/alerts.js';
import { BODY_ZONES, bodyZoneEntrySchema, INSPECTION_ITEMS, INSPECTION_SEVERITIES, INSPECTION_STATUSES, inspectionItemsSchema, PHOTO_KINDS } from '../booster/inspection.js';
import { PERFORMANCE_PERIODS, PERFORMANCE_SOURCES, PERFORMANCE_STATUSES } from '../booster/performance.js';
import { isoDate, localDateString, uuid } from './common.js';

const count = z.number().int().min(0);
const pct = z.number().int().min(0).max(100);
const km = z.number().int().min(0).max(2_000_000);
const text = (max: number) => z.string().trim().max(max);

// --- Vérification sommaire ----------------------------------------------------------------------------------------------

export const inspectionPhotoSchema = z.object({
  index: count,
  kind: z.enum(PHOTO_KINDS),
  contentType: z.string(),
  bytes: count,
  uploadedAt: isoDate,
});
export type InspectionPhotoView = z.infer<typeof inspectionPhotoSchema>;

export const ANALYSIS_STATUSES = ['none', 'done', 'failed'] as const;

export const inspectionAnalysisViewSchema = z.object({
  status: z.enum(ANALYSIS_STATUSES),
  promptKey: z.string().nullable(),
  model: z.string().nullable(),
  analysedAt: isoDate.nullable(),
  /** Confiance moyenne de 0 à 1 ; le chauffeur confirme ou corrige chaque champ. */
  confidence: z.number().min(0).max(1).nullable(),
  summary: z.string().nullable(),
  itemsFromAnalysis: z.array(z.enum(INSPECTION_ITEMS)),
  warningLights: z.array(z.object({ name: z.string(), probableCause: z.string() })),
  photosUnusable: z.array(count),
  error: z.string().nullable(),
});
export type InspectionAnalysisView = z.infer<typeof inspectionAnalysisViewSchema>;

const inspectionFieldsSchema = z.object({
  inspectedAt: isoDate,
  plate: z.string().nullable(),
  accessoryNumber: z.string().nullable(),
  driverName: z.string().nullable(),
  odometerKm: km.nullable(),
  energyPercent: pct.nullable(),
  warningLightOn: z.boolean(),
  warningLightReason: z.string().nullable(),
  items: inspectionItemsSchema,
  bodyZones: z.array(bodyZoneEntrySchema),
  allItemsChecked: z.boolean(),
  severity: z.enum(INSPECTION_SEVERITIES),
  notes: z.string().nullable(),
});

/** Rapport vu par son chauffeur (numéro de permis en clair : c'est le sien). */
export const vehicleInspectionSchema = inspectionFieldsSchema.extend({
  id: uuid,
  driverId: uuid,
  vehicleId: uuid.nullable(),
  status: z.enum(INSPECTION_STATUSES),
  licenceNumber: z.string().nullable(),
  photos: z.array(inspectionPhotoSchema),
  analysis: inspectionAnalysisViewSchema,
  confirmedAt: isoDate.nullable(),
  archivedAt: isoDate.nullable(),
  /** Formats téléchargeables une fois archivé : PDF seulement (aucun moteur d'image côté API, voir docs/booster.md). */
  formats: z.array(z.enum(['pdf'])),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type VehicleInspectionView = z.infer<typeof vehicleInspectionSchema>;

/** Rapport vu par le dispatch (My Hub) : identité du chauffeur, permis masqué. */
export const adminInspectionSchema = vehicleInspectionSchema.omit({ licenceNumber: true }).extend({
  licenceNumberLast4: z.string().nullable(),
  driverPublicNumber: z.string(),
  driverFullName: z.string().nullable(),
  organizationId: uuid.nullable(),
});
export type AdminInspectionView = z.infer<typeof adminInspectionSchema>;

/** Champs texte du formulaire multipart de création (les photos sont les fichiers `photos`). */
export const inspectionCreateFieldsSchema = z.object({
  vehicleId: uuid.optional(),
  plate: text(20).optional(),
  accessoryNumber: text(40).optional(),
  driverName: text(120).optional(),
  licenceNumber: text(40).optional(),
  inspectedAt: isoDate.optional(),
  /** Vues des photos, séparées par des virgules, dans l'ordre des fichiers ; `other` à défaut. */
  kinds: z.string().max(400).optional(),
});
export type InspectionCreateFields = z.infer<typeof inspectionCreateFieldsSchema>;

export const inspectionPhotosFieldsSchema = inspectionCreateFieldsSchema.pick({ kinds: true });

/** Corrections du chauffeur (brouillon ou rapport analysé) : tout champ absent reste tel quel. */
export const inspectionUpdateSchema = z.object({
  inspectedAt: isoDate.optional(),
  vehicleId: uuid.nullable().optional(),
  plate: text(20).nullable().optional(),
  accessoryNumber: text(40).nullable().optional(),
  driverName: text(120).nullable().optional(),
  licenceNumber: text(40).nullable().optional(),
  odometerKm: km.nullable().optional(),
  energyPercent: pct.nullable().optional(),
  warningLightOn: z.boolean().optional(),
  warningLightReason: text(300).nullable().optional(),
  items: inspectionItemsSchema.optional(),
  bodyZones: z.array(bodyZoneEntrySchema).max(BODY_ZONES.length).optional(),
  allItemsChecked: z.boolean().optional(),
  notes: text(1000).nullable().optional(),
});
export type InspectionUpdate = z.infer<typeof inspectionUpdateSchema>;

/** Confirmation et archivage : le chauffeur atteste que tous les éléments de l'article 65 ont été vérifiés. */
export const inspectionConfirmSchema = inspectionUpdateSchema.extend({ allItemsChecked: z.literal(true) });
export type InspectionConfirm = z.infer<typeof inspectionConfirmSchema>;

export const inspectionListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: localDateString.optional(),
  to: localDateString.optional(),
  status: z.enum(INSPECTION_STATUSES).optional(),
});
export type InspectionListQuery = z.infer<typeof inspectionListQuerySchema>;

/** Côté dispatch : par chauffeur, par jour, gravité majeure seulement. */
export const adminInspectionListQuerySchema = inspectionListQuerySchema.extend({
  driverId: uuid.optional(),
  date: localDateString.optional(),
  majorOnly: z.coerce.boolean().default(false),
});
export type AdminInspectionListQuery = z.infer<typeof adminInspectionListQuerySchema>;

/** Chauffeurs en ligne sans rapport archivé aujourd'hui (heure de Montréal). */
export const missingInspectionSchema = z.object({
  driverId: uuid,
  driverPublicNumber: z.string(),
  driverFullName: z.string().nullable(),
  organizationId: uuid.nullable(),
  onlineSince: isoDate.nullable(),
});
export type MissingInspectionView = z.infer<typeof missingInspectionSchema>;

/** Lien signé de téléchargement (courte durée), format PDF. */
export const inspectionDownloadSchema = z.object({ format: z.literal('pdf'), url: z.string(), expiresAt: isoDate });
export type InspectionDownloadView = z.infer<typeof inspectionDownloadSchema>;

// --- Rapport de performance ----------------------------------------------------------------------------------------------

const cents = z.number().int().min(0).max(100_000_000);
const minutes = z.number().int().min(0).max(1440);

export const performanceSummarySchema = z.object({
  sessionMinutes: count.nullable(),
  basisMinutes: count.nullable(),
  distanceKm: count.nullable(),
  energyUsedPoints: z.number().int().nullable(),
  energyPer100Km: z.number().nullable(),
  drivingSharePercent: count.nullable(),
  grossCents: count,
  costsCents: count,
  netCents: z.number().int(),
  netPerHourCents: z.number().int().nullable(),
  netPerKmCents: z.number().int().nullable(),
  grossPerRideCents: count.nullable(),
  tipsPercent: count.nullable(),
});

export const performanceReadingViewSchema = z.object({
  status: z.enum(ANALYSIS_STATUSES),
  promptKey: z.string().nullable(),
  model: z.string().nullable(),
  analysedAt: isoDate.nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  summary: z.string().nullable(),
  app: z.string().nullable(),
  photosUnusable: z.array(count),
  error: z.string().nullable(),
});

const performanceFieldsSchema = z.object({
  date: localDateString,
  startedAt: isoDate.nullable(),
  endedAt: isoDate.nullable(),
  startEnergyPercent: pct.nullable(),
  endEnergyPercent: pct.nullable(),
  startOdometerKm: km.nullable(),
  endOdometerKm: km.nullable(),
  onlineMinutes: minutes.nullable(),
  drivingMinutes: minutes.nullable(),
  ridesCount: z.number().int().min(0).max(500).nullable(),
  ridesCents: cents,
  tipsCents: cents,
  promotionsCents: cents,
  energyCents: cents,
  cleaningCents: cents,
  points: z.number().int().min(0).max(1_000_000).nullable(),
  otherNotes: z.string().nullable(),
  source: z.enum(PERFORMANCE_SOURCES),
});

export const performanceLogSchema = performanceFieldsSchema.extend({
  id: uuid,
  driverId: uuid,
  status: z.enum(PERFORMANCE_STATUSES),
  screenshots: z.array(z.object({ index: count, contentType: z.string(), bytes: count, uploadedAt: isoDate })),
  reading: performanceReadingViewSchema,
  summary: performanceSummarySchema,
  confirmedAt: isoDate.nullable(),
  formats: z.array(z.enum(['pdf'])),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type PerformanceLogView = z.infer<typeof performanceLogSchema>;

export const adminPerformanceLogSchema = performanceLogSchema.extend({
  driverPublicNumber: z.string(),
  driverFullName: z.string().nullable(),
  organizationId: uuid.nullable(),
});
export type AdminPerformanceLogView = z.infer<typeof adminPerformanceLogSchema>;

/** Saisie d'une session (création ou modification) : tout champ absent garde sa valeur (zéro ou nul à la création). */
export const performanceLogInputSchema = z.object({
  date: localDateString.optional(),
  startedAt: isoDate.nullable().optional(),
  endedAt: isoDate.nullable().optional(),
  startEnergyPercent: pct.nullable().optional(),
  endEnergyPercent: pct.nullable().optional(),
  startOdometerKm: km.nullable().optional(),
  endOdometerKm: km.nullable().optional(),
  onlineMinutes: minutes.nullable().optional(),
  drivingMinutes: minutes.nullable().optional(),
  ridesCount: z.number().int().min(0).max(500).nullable().optional(),
  ridesCents: cents.optional(),
  tipsCents: cents.optional(),
  promotionsCents: cents.optional(),
  energyCents: cents.optional(),
  cleaningCents: cents.optional(),
  points: z.number().int().min(0).max(1_000_000).nullable().optional(),
  otherNotes: text(500).nullable().optional(),
});
export type PerformanceLogInput = z.infer<typeof performanceLogInputSchema>;

export const performanceListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: localDateString.optional(),
  to: localDateString.optional(),
  status: z.enum(PERFORMANCE_STATUSES).optional(),
});
export type PerformanceListQuery = z.infer<typeof performanceListQuerySchema>;

export const adminPerformanceListQuerySchema = performanceListQuerySchema.extend({ driverId: uuid.optional() });

export const performanceRecapQuerySchema = z.object({
  period: z.enum(PERFORMANCE_PERIODS).default('week'),
  /** Jour de la période (défaut : aujourd'hui, heure de Montréal). */
  date: localDateString.optional(),
});
export type PerformanceRecapQuery = z.infer<typeof performanceRecapQuerySchema>;

export const adminPerformanceRecapQuerySchema = performanceRecapQuerySchema.extend({ driverId: uuid });

export const performanceTotalsSchema = z.object({
  sessions: count,
  minutes: count,
  distanceKm: count,
  rides: count,
  grossCents: count,
  tipsCents: count,
  costsCents: count,
  netCents: z.number().int(),
  netPerHourCents: z.number().int().nullable(),
  netPerKmCents: z.number().int().nullable(),
});

/** Récapitulatif d'une période : totaux des sessions confirmées, puis chaque session. */
export const performanceRecapSchema = z.object({
  period: z.enum(PERFORMANCE_PERIODS),
  start: localDateString,
  end: localDateString,
  label: z.string(),
  totals: performanceTotalsSchema,
  sessions: z.array(performanceLogSchema),
});
export type PerformanceRecapView = z.infer<typeof performanceRecapSchema>;

// --- Alertes -----------------------------------------------------------------------------------------------------------

export const driverAlertSettingsViewSchema = driverAlertSettingsSchema.extend({
  peakPeriods: z.array(gainWindowSchema),
  peakZones: z.array(gainWindowSchema),
  sounds: z.array(z.enum(ALERT_SOUNDS)),
  updatedAt: isoDate.nullable(),
});
export type DriverAlertSettingsView = z.infer<typeof driverAlertSettingsViewSchema>;

export const driverAlertSettingsUpdateSchema = z.object({
  sessionStart: timeOfDaySchema.optional(),
  sessionEnd: timeOfDaySchema.optional(),
  timeZone: z.string().min(1).max(40).optional(),
  reminders: alertRemindersSchema.partial().optional(),
  styles: alertStylesSchema.partial().optional(),
});
export type DriverAlertSettingsUpdate = z.infer<typeof driverAlertSettingsUpdateSchema>;

export const alertTestSchema = z.object({ type: z.enum(['inspection', 'session_info', 'session_start', 'session_end', 'peak_period', 'peak_zone']) });
export type AlertTestInput = z.infer<typeof alertTestSchema>;
