/** Section 4.3 : chauffeurs et véhicules. */

import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, real, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, geoPoint, id, tz, updatedAt } from './_helpers.js';
import { documentStatusEnum, documentTypeEnum, driverQualificationEnum, driverStatusEnum, vehicleCategoryEnum, vehicleStatusEnum } from './enums.js';
import { users } from './identity.js';

export const drivers = pgTable('drivers', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Numéro affiché (CH-00012), attribué par séquence. */
  publicNumber: varchar('public_number', { length: 12 }).notNull(),
  status: driverStatusEnum('status').notNull().default('pending'),
  qualification: driverQualificationEnum('qualification'),
  gstNumber: varchar('gst_number', { length: 20 }),
  qstNumber: varchar('qst_number', { length: 20 }),
  tradeName: varchar('trade_name', { length: 150 }),
  stripeConnectAccountId: varchar('stripe_connect_account_id', { length: 100 }),
  stripeConnectOnboarded: boolean('stripe_connect_onboarded').notNull().default(false),
  /** Méthode Stripe enregistrée pour les prélèvements (net négatif). */
  stripeDebitPaymentMethodId: varchar('stripe_debit_payment_method_id', { length: 100 }),
  acceptsCash: boolean('accepts_cash').notNull().default(false),
  acceptsInterac: boolean('accepts_interac').notNull().default(false),
  acceptsTerminal: boolean('accepts_terminal').notNull().default(false),
  interacEmail: varchar('interac_email', { length: 254 }),
  acceptsScheduled: boolean('accepts_scheduled').notNull().default(true),
  preferredZones: jsonb('preferred_zones').notNull().default(sql`'[]'::jsonb`),
  /** Langues parlées déclarées à l'inscription (codes ISO 639-1). */
  spokenLanguages: jsonb('spoken_languages').notNull().default(sql`'[]'::jsonb`),
  experienceYears: smallint('experience_years'),
  /** Attestation de la formation Neomoov (tous les modules réussis) ; exigée pour passer en ligne. */
  trainingCertifiedAt: tz('training_certified_at'),
  ratingAverage: numeric('rating_average', { precision: 3, scale: 2 }).notNull().default('5.00'),
  ratingCount: integer('rating_count').notNull().default(0),
  rideCount: integer('ride_count').notNull().default(0),
  isOnline: boolean('is_online').notNull().default(false),
  currentVehicleId: uuid('current_vehicle_id'),
  organizationId: uuid('organization_id'),
  activatedAt: tz('activated_at'),
  offboardedAt: tz('offboarded_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('drivers_user_unique').on(t.userId),
  uniqueIndex('drivers_public_number_unique').on(t.publicNumber),
  uniqueIndex('drivers_stripe_connect_unique').on(t.stripeConnectAccountId).where(sql`${t.stripeConnectAccountId} IS NOT NULL`),
  index('drivers_status_online_idx').on(t.status, t.isOnline),
  check('drivers_rating_range', sql`${t.ratingAverage} BETWEEN 0 AND 5`),
]);

export const driverDocuments = pgTable('driver_documents', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  type: documentTypeEnum('type').notNull(),
  fileKey: varchar('file_key', { length: 300 }).notNull(),
  number: varchar('number', { length: 60 }),
  issuedOn: date('issued_on'),
  expiresOn: date('expires_on'),
  status: documentStatusEnum('status').notNull().default('pending'),
  verifiedByUserId: uuid('verified_by_user_id'),
  verifiedByAgentCode: varchar('verified_by_agent_code', { length: 40 }),
  verifiedAt: tz('verified_at'),
  rejectionReason: text('rejection_reason'),
  /** Champs extraits par l'agent de recrutement (vision), pour contrôle humain. */
  extractedFields: jsonb('extracted_fields'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('driver_documents_driver_type_idx').on(t.driverId, t.type), index('driver_documents_expiry_idx').on(t.expiresOn).where(sql`${t.status} = 'approved'`)]);

export const vehicleCategories = pgTable('vehicle_categories', {
  code: vehicleCategoryEnum('code').primaryKey(),
  name: varchar('name', { length: 40 }).notNull(),
  /** Rang : un véhicule d'un rang supérieur peut servir une catégorie inférieure (garantie modèle). */
  rank: smallint('rank').notNull(),
  seats: smallint('seats').notNull(),
  minYear: smallint('min_year').notNull(),
  allowedModels: jsonb('allowed_models').notNull().default(sql`'[]'::jsonb`),
  description: text('description'),
  active: boolean('active').notNull().default(true),
}, (t) => [uniqueIndex('vehicle_categories_rank_unique').on(t.rank), check('vehicle_categories_seats', sql`${t.seats} BETWEEN 1 AND 8`)]);

export const vehicles = pgTable('vehicles', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  category: vehicleCategoryEnum('category').notNull().references(() => vehicleCategories.code),
  organizationId: uuid('organization_id'),
  make: varchar('make', { length: 60 }).notNull(),
  model: varchar('model', { length: 60 }).notNull(),
  year: smallint('year').notNull(),
  colour: varchar('colour', { length: 40 }).notNull(),
  plate: varchar('plate', { length: 12 }).notNull(),
  vin: varchar('vin', { length: 17 }),
  odometerKm: integer('odometer_km'),
  isElectric: boolean('is_electric').notNull().default(true),
  seats: smallint('seats').notNull().default(4),
  equipment: jsonb('equipment').notNull().default(sql`'{}'::jsonb`),
  status: vehicleStatusEnum('status').notNull().default('pending'),
  lastInspectionOn: date('last_inspection_on'),
  nextInspectionDueOn: date('next_inspection_due_on'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('vehicles_driver_idx').on(t.driverId),
  uniqueIndex('vehicles_plate_unique').on(t.plate),
  uniqueIndex('vehicles_vin_unique').on(t.vin).where(sql`${t.vin} IS NOT NULL`),
  check('vehicles_electric_required', sql`${t.isElectric} = true`),
  check('vehicles_year', sql`${t.year} BETWEEN 2015 AND 2100`),
  check('vehicles_seats', sql`${t.seats} BETWEEN 1 AND 8`),
]);

/**
 * Positions des chauffeurs : partitionnée par jour (migration 0001), conservée 90 jours.
 * Drizzle déclare la table ; la migration SQL la transforme en table partitionnée.
 */
export const driverLocations = pgTable('driver_locations', {
  driverId: uuid('driver_id').notNull(),
  position: geoPoint('position').notNull(),
  speedMps: real('speed_mps'),
  headingDegrees: real('heading_degrees'),
  accuracyMeters: real('accuracy_meters'),
  rideId: uuid('ride_id'),
  recordedAt: tz('recorded_at').notNull(),
}, (t) => [index('driver_locations_driver_time_idx').on(t.driverId, t.recordedAt), index('driver_locations_ride_idx').on(t.rideId).where(sql`${t.rideId} IS NOT NULL`)]);

/** Dernière position connue de chaque chauffeur en ligne : une ligne par chauffeur, index GiST pour la recherche par rayon. */
export const driverPresence = pgTable('driver_presence', {
  driverId: uuid('driver_id').primaryKey().references(() => drivers.id, { onDelete: 'cascade' }),
  position: geoPoint('position').notNull(),
  headingDegrees: real('heading_degrees'),
  vehicleId: uuid('vehicle_id'),
  category: vehicleCategoryEnum('category'),
  isAvailable: boolean('is_available').notNull().default(true),
  currentRideId: uuid('current_ride_id'),
  updatedAt: updatedAt(),
}, (t) => [index('driver_presence_position_gist').using('gist', t.position), index('driver_presence_available_idx').on(t.isAvailable, t.category)]);

export const driverShifts = pgTable('driver_shifts', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  startedAt: tz('started_at').notNull(),
  endedAt: tz('ended_at'),
  faceCheckPassedAt: tz('face_check_passed_at'),
  rideCount: integer('ride_count').notNull().default(0),
  earningsCents: cents('earnings_cents').notNull().default(0),
  onlineSeconds: integer('online_seconds').notNull().default(0),
}, (t) => [index('driver_shifts_driver_idx').on(t.driverId, t.startedAt), check('driver_shifts_earnings', sql`${t.earningsCents} >= 0`)]);

export const driverScores = pgTable('driver_scores', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  punctualityPct: smallint('punctuality_pct').notNull().default(100),
  cancellationCount: integer('cancellation_count').notNull().default(0),
  harshAccelerations: integer('harsh_accelerations').notNull().default(0),
  harshBrakings: integer('harsh_brakings').notNull().default(0),
  /** Compteurs journaliers (prompt 11) : une ligne par jour, agrégée sur la période du tableau de conduite. */
  distanceMeters: integer('distance_meters').notNull().default(0),
  completedRides: integer('completed_rides').notNull().default(0),
  timedRides: integer('timed_rides').notNull().default(0),
  punctualRides: integer('punctual_rides').notNull().default(0),
  rating: numeric('rating', { precision: 3, scale: 2 }),
  suggestions: jsonb('suggestions').notNull().default(sql`'[]'::jsonb`),
  computedAt: createdAt(),
}, (t) => [uniqueIndex('driver_scores_period_unique').on(t.driverId, t.periodStart)]);

/** Formation Neomoov (prompt 11) : chaque tentative de quiz d'un module, corrigée par l'API. */
export const driverTrainingResults = pgTable('driver_training_results', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  moduleCode: varchar('module_code', { length: 40 }).notNull(),
  scorePct: smallint('score_pct').notNull(),
  passed: boolean('passed').notNull(),
  answers: jsonb('answers').notNull().default(sql`'{}'::jsonb`),
  completedAt: createdAt(),
}, (t) => [index('driver_training_results_driver_idx').on(t.driverId, t.moduleCode), check('driver_training_results_score', sql`${t.scorePct} BETWEEN 0 AND 100`)]);
