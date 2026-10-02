/**
 * Étape 23 (amendement v1.2, section 6) : module Flotte. Entretien des véhicules, règles de partage des revenus entre
 * une organisation et ses chauffeurs, relevés hebdomadaires de l'organisation (sa part, versée par Stripe Connect ou
 * réglée hors plateforme). Isolation : droits et politiques `org_isolation` posés par la migration (par véhicule pour
 * l'entretien, par organisation pour les deux autres).
 */
import { sql } from 'drizzle-orm';
import { check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { drivers, vehicles } from './drivers.js';
import { organizations } from './partners.js';

export const vehicleMaintenance = pgTable('vehicle_maintenance', {
  id: id(),
  vehicleId: uuid('vehicle_id').notNull().references(() => vehicles.id, { onDelete: 'cascade' }),
  /** Organisation du véhicule au moment de l'entretien (dérivée par la base, pour les rapports). */
  organizationId: uuid('organization_id').default(sql`app_scope_organization_id()`),
  kind: varchar('kind', { length: 20 }).notNull(),
  performedOn: date('performed_on').notNull(),
  odometerKm: integer('odometer_km'),
  costCents: cents('cost_cents'),
  notes: text('notes'),
  nextDueOn: date('next_due_on'),
  nextDueKm: integer('next_due_km'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
}, (t) => [
  index('vehicle_maintenance_vehicle_idx').on(t.vehicleId, t.performedOn),
  check('vehicle_maintenance_kind', sql`${t.kind} IN ('inspection', 'oil_change', 'tires', 'brakes', 'battery', 'repair', 'cleaning', 'other')`),
  check('vehicle_maintenance_cost', sql`${t.costCents} IS NULL OR ${t.costCents} >= 0`),
]);

export const revenueShareRules = pgTable('revenue_share_rules', {
  id: id(),
  organizationId: uuid('organization_id').notNull().default(sql`app_scope_organization_id()`).references(() => organizations.id, { onDelete: 'cascade' }),
  /** Chauffeur visé ; nul : règle par défaut de l'organisation. */
  driverId: uuid('driver_id').references(() => drivers.id, { onDelete: 'cascade' }),
  mode: varchar('mode', { length: 12 }).notNull(),
  weeklyRentCents: cents('weekly_rent_cents'),
  /** Part de l'organisation sur le tarif chauffeur, en parties par million. */
  percentagePpm: integer('percentage_ppm'),
  effectiveFrom: date('effective_from').notNull(),
  effectiveTo: date('effective_to'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('revenue_share_rules_org_idx').on(t.organizationId, t.effectiveFrom),
  index('revenue_share_rules_driver_idx').on(t.driverId).where(sql`${t.driverId} IS NOT NULL`),
  check('revenue_share_rules_mode', sql`(${t.mode} = 'rent' AND ${t.weeklyRentCents} > 0) OR (${t.mode} = 'percentage' AND ${t.percentagePpm} BETWEEN 1 AND 1000000)`),
  check('revenue_share_rules_dates', sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`),
]);

export const organizationStatements = pgTable('organization_statements', {
  id: id(),
  organizationId: uuid('organization_id').notNull().default(sql`app_scope_organization_id()`).references(() => organizations.id, { onDelete: 'cascade' }),
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  /** `issued` (à verser), `paid` (transfert Connect), `failed` (transfert refusé, repris), `settled_offline` (réglé hors plateforme). */
  status: varchar('status', { length: 16 }).notNull().default('issued'),
  shareCents: cents('share_cents').notNull().default(0),
  driverCount: integer('driver_count').notNull().default(0),
  /** Une ligne par relevé de chauffeur émis : chauffeur, relevé, part de l'organisation. */
  lines: jsonb('lines').notNull().default(sql`'[]'::jsonb`).$type<Array<{ driverId: string; statementId: string; shareCents: number }>>(),
  stripeTransferId: varchar('stripe_transfer_id', { length: 100 }),
  failureCode: varchar('failure_code', { length: 60 }),
  attempts: integer('attempts').notNull().default(0),
  offlineSettlement: jsonb('offline_settlement').$type<{ method: 'interac' | 'bank_transfer' | 'cash' | 'cheque' | 'other'; reference: string; note: string | null; byUserId: string }>(),
  issuedAt: tz('issued_at').notNull().defaultNow(),
  settledAt: tz('settled_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('organization_statements_period_unique').on(t.organizationId, t.periodStart),
  index('organization_statements_status_idx').on(t.status, t.periodStart),
  check('organization_statements_status', sql`${t.status} IN ('issued', 'paid', 'failed', 'settled_offline', 'unknown')`),
  check('organization_statements_share', sql`${t.shareCents} >= 0`),
  check('organization_statements_period', sql`${t.periodEnd} = ${t.periodStart} + 6`),
]);
