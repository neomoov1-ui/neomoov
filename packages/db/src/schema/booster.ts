/**
 * Neomoov Booster (phase 1, agent G) : rapports de vérification sommaire (article 55 de la Loi, articles 65 et 66 du
 * Règlement), rapports de performance des sessions et réglages des alertes du chauffeur. Chaque rapport porte
 * l'organisation de son chauffeur (dérivée par la base hors contexte, `org_fill_from_driver`) ; isolation : droits et
 * politiques `org_isolation` par chauffeur, posés par la migration. Les photos, captures et PDF sont des clés de
 * stockage privé, jamais des adresses publiques.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, smallint, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { drivers, vehicles } from './drivers.js';

/** Photo d'une inspection ou capture d'un rapport de performance : clé de stockage et métadonnées. */
export interface StoredImage {
  key: string;
  kind: string;
  contentType: string;
  bytes: number;
  uploadedAt: string;
}

/** Analyse automatique d'un rapport : sortie brute du modèle, prompt, modèle, confiance ; `error` si l'analyse a échoué. */
export interface StoredAnalysis {
  promptKey: string;
  model: string | null;
  analysedAt: string;
  confidence: number | null;
  raw: unknown;
  error: string | null;
}

export const vehicleInspections = pgTable('vehicle_inspections', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id, { onDelete: 'set null' }),
  organizationId: uuid('organization_id').default(sql`app_scope_organization_id()`),
  /** `draft` (photos, saisie), `analysed` (analyse faite, à confirmer), `archived` (confirmé par le chauffeur, PDF produit). */
  status: varchar('status', { length: 10 }).notNull().default('draft'),
  inspectedAt: tz('inspected_at').notNull().defaultNow(),
  /** Date civile de l'inspection dans le fuseau du service (une inspection par jour attendue). */
  inspectedOn: date('inspected_on').notNull(),
  plate: varchar('plate', { length: 12 }),
  accessoryNumber: varchar('accessory_number', { length: 40 }),
  driverName: varchar('driver_name', { length: 120 }),
  /** Numéro de permis du chauffeur qualifié : chiffré par l'application (comme les numéros de documents). */
  licenceNumber: varchar('licence_number', { length: 255 }),
  odometerKm: integer('odometer_km'),
  /** État de charge (électrique) ou niveau de carburant, en pourcentage. */
  energyPercent: smallint('energy_percent'),
  warningLightOn: boolean('warning_light_on').notNull().default(false),
  warningLightReason: varchar('warning_light_reason', { length: 300 }),
  /** Les douze éléments de l'article 65 : `{ <élément>: { state, note } }` (schéma du domaine). */
  items: jsonb('items').notNull().default(sql`'{}'::jsonb`),
  /** Zones de carrosserie touchées : `[{ zone, description }]`. */
  bodyZones: jsonb('body_zones').notNull().default(sql`'[]'::jsonb`),
  allItemsChecked: boolean('all_items_checked').notNull().default(false),
  severity: varchar('severity', { length: 10 }).notNull().default('ok'),
  notes: text('notes'),
  photos: jsonb('photos').notNull().default(sql`'[]'::jsonb`).$type<StoredImage[]>(),
  analysis: jsonb('analysis').$type<StoredAnalysis>(),
  /** Nombre d'analyses lancées (référence d'idempotence des exécutions de l'agent). */
  analysisCount: integer('analysis_count').notNull().default(0),
  confirmedAt: tz('confirmed_at'),
  archivedAt: tz('archived_at'),
  pdfKey: varchar('pdf_key', { length: 300 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('vehicle_inspections_driver_idx').on(t.driverId, t.inspectedOn),
  index('vehicle_inspections_org_day_idx').on(t.organizationId, t.inspectedOn),
  index('vehicle_inspections_major_idx').on(t.inspectedOn).where(sql`${t.severity} = 'major' AND ${t.status} = 'archived'`),
  check('vehicle_inspections_status', sql`${t.status} IN ('draft', 'analysed', 'archived')`),
  check('vehicle_inspections_severity', sql`${t.severity} IN ('ok', 'minor', 'major')`),
  check('vehicle_inspections_energy', sql`${t.energyPercent} IS NULL OR ${t.energyPercent} BETWEEN 0 AND 100`),
  check('vehicle_inspections_odometer', sql`${t.odometerKm} IS NULL OR ${t.odometerKm} >= 0`),
]);

export const performanceLogs = pgTable('performance_logs', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  organizationId: uuid('organization_id').default(sql`app_scope_organization_id()`),
  /** `draft` (saisie), `analysed` (captures lues, à confirmer), `confirmed` (validé par le chauffeur). */
  status: varchar('status', { length: 10 }).notNull().default('draft'),
  /** Date civile de la session (fuseau du service). */
  date: date('date').notNull(),
  startedAt: tz('started_at'),
  endedAt: tz('ended_at'),
  startEnergyPercent: smallint('start_energy_percent'),
  endEnergyPercent: smallint('end_energy_percent'),
  startOdometerKm: integer('start_odometer_km'),
  endOdometerKm: integer('end_odometer_km'),
  onlineMinutes: integer('online_minutes'),
  drivingMinutes: integer('driving_minutes'),
  ridesCount: integer('rides_count'),
  ridesCents: cents('rides_cents').notNull().default(0),
  tipsCents: cents('tips_cents').notNull().default(0),
  promotionsCents: cents('promotions_cents').notNull().default(0),
  energyCents: cents('energy_cents').notNull().default(0),
  cleaningCents: cents('cleaning_cents').notNull().default(0),
  /** Points du programme de l'opérateur du chauffeur (nombre libre). */
  points: integer('points'),
  otherNotes: varchar('other_notes', { length: 500 }),
  /** `manual` (saisie) ou `screenshot` (lecture de captures d'écran, confirmée par le chauffeur). */
  source: varchar('source', { length: 12 }).notNull().default('manual'),
  screenshots: jsonb('screenshots').notNull().default(sql`'[]'::jsonb`).$type<StoredImage[]>(),
  analysis: jsonb('analysis').$type<StoredAnalysis>(),
  analysisCount: integer('analysis_count').notNull().default(0),
  confirmedAt: tz('confirmed_at'),
  pdfKey: varchar('pdf_key', { length: 300 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('performance_logs_driver_idx').on(t.driverId, t.date),
  index('performance_logs_org_idx').on(t.organizationId, t.date),
  check('performance_logs_status', sql`${t.status} IN ('draft', 'analysed', 'confirmed')`),
  check('performance_logs_source', sql`${t.source} IN ('manual', 'screenshot')`),
  check('performance_logs_amounts', sql`${t.ridesCents} >= 0 AND ${t.tipsCents} >= 0 AND ${t.promotionsCents} >= 0 AND ${t.energyCents} >= 0 AND ${t.cleaningCents} >= 0`),
  check('performance_logs_energy', sql`(${t.startEnergyPercent} IS NULL OR ${t.startEnergyPercent} BETWEEN 0 AND 100) AND (${t.endEnergyPercent} IS NULL OR ${t.endEnergyPercent} BETWEEN 0 AND 100)`),
]);

/** Une ligne par chauffeur qui a ouvert ses alertes ; sans ligne, les défauts documentés s'appliquent (aucune alerte envoyée). */
export const driverAlertSettings = pgTable('driver_alert_settings', {
  driverId: uuid('driver_id').primaryKey().references(() => drivers.id, { onDelete: 'cascade' }),
  /** Heures habituelles `HH:MM` dans `time_zone`. */
  sessionStart: varchar('session_start', { length: 5 }).notNull(),
  sessionEnd: varchar('session_end', { length: 5 }).notNull(),
  timeZone: varchar('time_zone', { length: 40 }).notNull().default('America/Toronto'),
  /** Rappels activés par type (`alertRemindersSchema`). */
  reminders: jsonb('reminders').notNull().default(sql`'{}'::jsonb`),
  /** Son et couleur par type (`alertStylesSchema`). */
  styles: jsonb('styles').notNull().default(sql`'{}'::jsonb`),
  /** Marques des alertes envoyées (`type:date[:index]`), élaguées à la journée courante et à la veille. */
  sentMarkers: jsonb('sent_markers').notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
  updatedAt: updatedAt(),
}, (t) => [
  check('driver_alert_settings_times', sql`${t.sessionStart} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND ${t.sessionEnd} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
]);
