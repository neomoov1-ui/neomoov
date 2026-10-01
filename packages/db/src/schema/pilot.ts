/**
 * Neomoov Pilote (étape 24, amendement v1.2 section 7) : réglages et consentement du chauffeur, décisions de Pilote sur
 * les offres, coûts mensuels et revenus des autres plateformes saisis par le chauffeur (rentabilité nette). Pilote
 * n'agit que sur les courses Neomoov (décision D1) : aucune donnée d'une autre plateforme n'est lue, seul un total saisi
 * à la main est gardé.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { drivers } from './drivers.js';
import { rideOffers, rides } from './rides.js';

/** Une ligne par chauffeur qui a ouvert l'écran Pilote ; sans ligne, Pilote est désactivé et les critères sont vides. */
export const driverPilotSettings = pgTable('driver_pilot_settings', {
  driverId: uuid('driver_id').primaryKey().references(() => drivers.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  /** Critères (`pilotCriteriaSchema` du domaine), validés par l'API. */
  criteria: jsonb('criteria').notNull().default(sql`'{}'::jsonb`),
  multiAppMode: boolean('multi_app_mode').notNull().default(false),
  /** Information sur la décision automatisée acceptée (Loi 25, article 12.1) : date et version du texte. */
  consentAt: tz('consent_at'),
  consentVersion: varchar('consent_version', { length: 20 }),
  updatedAt: updatedAt(),
}, (t) => [index('driver_pilot_settings_enabled_idx').on(t.enabled)]);

/** Évaluation d'une offre par Pilote (chauffeur qui l'a activé) : décision, score, raisons, acceptation et annulation de grâce. */
export const driverPilotDecisions = pgTable('driver_pilot_decisions', {
  id: id(),
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  rideId: uuid('ride_id').notNull().references(() => rides.id, { onDelete: 'cascade' }),
  offerId: uuid('offer_id').references(() => rideOffers.id, { onDelete: 'set null' }),
  decision: varchar('decision', { length: 10 }).notNull(),
  score: varchar('score', { length: 10 }).notNull(),
  reasons: jsonb('reasons').notNull().default(sql`'[]'::jsonb`),
  autoAcceptedAt: tz('auto_accepted_at'),
  /** Annulée par le chauffeur dans le délai de grâce (`pilot.grace_seconds`) : sans frais, sans pénalité, sans effet sur son dossier. */
  cancelledInGraceAt: tz('cancelled_in_grace_at'),
  createdAt: createdAt(),
}, (t) => [
  index('driver_pilot_decisions_driver_idx').on(t.driverId, t.createdAt),
  index('driver_pilot_decisions_ride_idx').on(t.rideId),
  uniqueIndex('driver_pilot_decisions_offer_unique').on(t.offerId).where(sql`${t.offerId} IS NOT NULL`),
  check('driver_pilot_decisions_decision', sql`${t.decision} IN ('accept', 'manual', 'reject')`),
  check('driver_pilot_decisions_score', sql`${t.score} IN ('green', 'yellow', 'red')`),
]);

/** Coûts du mois par poste et revenus des autres plateformes (un total saisi, sans logo ni nom de plateforme). */
export const driverCostEntries = pgTable('driver_cost_entries', {
  driverId: uuid('driver_id').notNull().references(() => drivers.id, { onDelete: 'cascade' }),
  /** Mois civil `AAAA-MM`, heure de Montréal. */
  month: varchar('month', { length: 7 }).notNull(),
  vehicleCents: cents('vehicle_cents').notNull().default(0),
  insuranceCents: cents('insurance_cents').notNull().default(0),
  energyCents: cents('energy_cents').notNull().default(0),
  maintenanceCents: cents('maintenance_cents').notNull().default(0),
  phoneCents: cents('phone_cents').notNull().default(0),
  otherCents: cents('other_cents').notNull().default(0),
  externalRevenueCents: cents('external_revenue_cents').notNull().default(0),
  updatedAt: updatedAt(),
}, (t) => [
  primaryKey({ columns: [t.driverId, t.month] }),
  check('driver_cost_entries_month', sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check('driver_cost_entries_amounts', sql`${t.vehicleCents} >= 0 AND ${t.insuranceCents} >= 0 AND ${t.energyCents} >= 0 AND ${t.maintenanceCents} >= 0 AND ${t.phoneCents} >= 0 AND ${t.otherCents} >= 0 AND ${t.externalRevenueCents} >= 0`),
]);
