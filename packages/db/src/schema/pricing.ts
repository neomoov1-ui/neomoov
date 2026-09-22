/** Section 4.4 : tarification et zones. Tarifs en cents, taux en ppm. */

import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, geoPoint, geoPolygon, id, tz, updatedAt } from './_helpers.js';
import { surchargeCodeEnum, vehicleCategoryEnum, zoneTypeEnum } from './enums.js';

export const cities = pgTable('cities', {
  code: varchar('code', { length: 30 }).primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  timeZone: varchar('time_zone', { length: 50 }).notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const zones = pgTable('zones', {
  id: id(),
  cityCode: varchar('city_code', { length: 30 }).notNull().references(() => cities.code),
  code: varchar('code', { length: 40 }).notNull(),
  name: varchar('name', { length: 80 }).notNull(),
  type: zoneTypeEnum('type').notNull(),
  geometry: geoPolygon('geometry').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('zones_code_unique').on(t.cityCode, t.code), index('zones_geometry_gist').using('gist', t.geometry)]);

export const pricingRules = pgTable('pricing_rules', {
  id: id(),
  cityCode: varchar('city_code', { length: 30 }).notNull().references(() => cities.code),
  category: vehicleCategoryEnum('category').notNull(),
  baseCents: cents('base_cents').notNull(),
  perKmCents: cents('per_km_cents').notNull(),
  perMinuteCents: cents('per_minute_cents').notNull(),
  minimumCents: cents('minimum_cents').notNull(),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdAt: createdAt(),
}, (t) => [index('pricing_rules_lookup_idx').on(t.cityCode, t.category, t.validFrom), check('pricing_rules_positive', sql`${t.baseCents} >= 0 AND ${t.perKmCents} >= 0 AND ${t.perMinuteCents} >= 0 AND ${t.minimumCents} >= 0`)]);

export const flatRates = pgTable('flat_rates', {
  id: id(),
  code: varchar('code', { length: 40 }).notNull(),
  category: vehicleCategoryEnum('category').notNull(),
  originZoneId: uuid('origin_zone_id').notNull().references(() => zones.id),
  destinationZoneId: uuid('destination_zone_id').notNull().references(() => zones.id),
  totalCents: cents('total_cents').notNull(),
  bidirectional: boolean('bidirectional').notNull().default(true),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('flat_rates_code_unique').on(t.code), index('flat_rates_lookup_idx').on(t.category, t.originZoneId, t.destinationZoneId), check('flat_rates_positive', sql`${t.totalCents} > 0`)]);

export const surcharges = pgTable('surcharges', {
  id: id(),
  cityCode: varchar('city_code', { length: 30 }).notNull().references(() => cities.code),
  code: surchargeCodeEnum('code').notNull(),
  /** Montant fixe en cents, ou montant par unité (minute, arrêt). */
  amountCents: cents('amount_cents').notNull(),
  perUnit: boolean('per_unit').notNull().default(false),
  /** Conditions : plages horaires, zones, seuils (JSON, lu par le moteur de tarification). */
  conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  validFrom: date('valid_from').notNull(),
  validTo: date('valid_to'),
}, (t) => [index('surcharges_city_code_idx').on(t.cityCode, t.code), check('surcharges_positive', sql`${t.amountCents} >= 0`)]);

export const quotes = pgTable('quotes', {
  id: id(),
  clientId: uuid('client_id'),
  /** Devis anonymes (réservation web sans compte, agent vocal) : identifiant de session. */
  sessionKey: varchar('session_key', { length: 80 }),
  cityCode: varchar('city_code', { length: 30 }).notNull().references(() => cities.code),
  category: vehicleCategoryEnum('category').notNull(),
  originAddress: varchar('origin_address', { length: 300 }).notNull(),
  originPosition: geoPoint('origin_position').notNull(),
  destinationAddress: varchar('destination_address', { length: 300 }).notNull(),
  destinationPosition: geoPoint('destination_position').notNull(),
  stops: jsonb('stops').notNull().default(sql`'[]'::jsonb`),
  distanceMeters: integer('distance_meters').notNull(),
  durationSeconds: integer('duration_seconds').notNull(),
  requestedAt: tz('requested_at'),
  lines: jsonb('lines').notNull(),
  fareCents: cents('fare_cents').notNull(),
  serviceFeeCents: cents('service_fee_cents').notNull(),
  regulatoryFeeCents: cents('regulatory_fee_cents').notNull(),
  gstCents: cents('gst_cents').notNull(),
  qstCents: cents('qst_cents').notNull(),
  creditsAppliedCents: cents('credits_applied_cents').notNull().default(0),
  totalCents: cents('total_cents').notNull(),
  maxConsentedCents: cents('max_consented_cents').notNull(),
  options: jsonb('options').notNull().default(sql`'{}'::jsonb`),
  promoCode: varchar('promo_code', { length: 30 }),
  flatRateCode: varchar('flat_rate_code', { length: 40 }),
  ignoredOptions: jsonb('ignored_options').notNull().default(sql`'[]'::jsonb`),
  validUntil: tz('valid_until').notNull(),
  /** Empreinte des entrées et des règles : la course vérifie que le devis n'a pas été altéré. */
  fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
  pricingRulesVersion: varchar('pricing_rules_version', { length: 40 }).notNull(),
  createdAt: createdAt(),
}, (t) => [index('quotes_client_idx').on(t.clientId, t.createdAt), index('quotes_valid_until_idx').on(t.validUntil), check('quotes_amounts_positive', sql`${t.fareCents} >= 0 AND ${t.totalCents} >= 0 AND ${t.maxConsentedCents} >= ${t.totalCents}`)]);
