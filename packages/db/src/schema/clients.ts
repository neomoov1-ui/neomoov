/** Section 4.2 : clients. */

import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, geoPoint, id, tz, updatedAt } from './_helpers.js';
import { users } from './identity.js';

export const clients = pgTable('clients', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  preferences: jsonb('preferences').notNull().default(sql`'{}'::jsonb`),
  notes: text('notes'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  businessAccountId: uuid('business_account_id'),
  subscriptionCode: varchar('subscription_code', { length: 40 }),
  rideCount: cents('ride_count').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('clients_user_unique').on(t.userId), check('clients_status', sql`${t.status} IN ('active', 'blocked', 'deleted')`)]);

export const clientPaymentMethods = pgTable('client_payment_methods', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  stripePaymentMethodId: varchar('stripe_payment_method_id', { length: 100 }).notNull(),
  brand: varchar('brand', { length: 30 }).notNull(),
  last4: varchar('last4', { length: 4 }).notNull(),
  expMonth: cents('exp_month'),
  expYear: cents('exp_year'),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: createdAt(),
  deletedAt: tz('deleted_at'),
}, (t) => [index('client_payment_methods_client_idx').on(t.clientId), uniqueIndex('client_payment_methods_stripe_unique').on(t.stripePaymentMethodId)]);

export const savedPlaces = pgTable('saved_places', {
  id: id(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  label: varchar('label', { length: 60 }).notNull(),
  address: varchar('address', { length: 300 }).notNull(),
  position: geoPoint('position').notNull(),
  createdAt: createdAt(),
}, (t) => [index('saved_places_client_idx').on(t.clientId)]);

export const favoriteDrivers = pgTable('favorite_drivers', {
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull(),
  addedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.clientId, t.driverId] }), index('favorite_drivers_driver_idx').on(t.driverId)]);

/** Lien client et chauffeur (D40) : « Mes chauffeurs » côté client, « Mes clients » côté chauffeur, alimenté à chaque course terminée. */
export const clientDriverLinks = pgTable('client_driver_links', {
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  driverId: uuid('driver_id').notNull(),
  favoriteSince: tz('favorite_since'),
  ridesCount: cents('rides_count').notNull().default(0),
  lastRideAt: tz('last_ride_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.clientId, t.driverId] }), index('client_driver_links_driver_idx').on(t.driverId, t.lastRideAt)]);

export const referrals = pgTable('referrals', {
  id: id(),
  referrerUserId: uuid('referrer_user_id').notNull().references(() => users.id),
  referredUserId: uuid('referred_user_id').references(() => users.id),
  code: varchar('code', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  referrerCreditCents: cents('referrer_credit_cents').notNull().default(0),
  referredCreditCents: cents('referred_credit_cents').notNull().default(0),
  completedAt: tz('completed_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('referrals_code_unique').on(t.code), index('referrals_referrer_idx').on(t.referrerUserId), check('referrals_status', sql`${t.status} IN ('pending', 'completed', 'expired')`), check('referrals_credits_positive', sql`${t.referrerCreditCents} >= 0 AND ${t.referredCreditCents} >= 0`)]);
