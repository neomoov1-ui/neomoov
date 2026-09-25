/** Section 4.8 : partenaires, comptes entreprises, investisseurs (structures V1, écrans V2 et V3). */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { cents, createdAt, id, tz, updatedAt } from './_helpers.js';
import { vehicles } from './drivers.js';
import { partnerTypeEnum } from './enums.js';
import { users } from './identity.js';

export const partners = pgTable('partners', {
  id: id(),
  type: partnerTypeEnum('type').notNull(),
  name: varchar('name', { length: 150 }).notNull(),
  contacts: jsonb('contacts').notNull().default(sql`'[]'::jsonb`),
  conciergeCode: varchar('concierge_code', { length: 20 }),
  terms: jsonb('terms').notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('partners_concierge_code_unique').on(t.conciergeCode).where(sql`${t.conciergeCode} IS NOT NULL`), check('partners_status', sql`${t.status} IN ('active', 'paused', 'ended')`)]);

export const businessAccounts = pgTable('business_accounts', {
  id: id(),
  name: varchar('name', { length: 150 }).notNull(),
  legalName: varchar('legal_name', { length: 200 }),
  billingEmail: varchar('billing_email', { length: 254 }).notNull(),
  monthlyBilling: jsonb('monthly_billing').notNull().default(sql`'{}'::jsonb`),
  costCenters: jsonb('cost_centers').notNull().default(sql`'[]'::jsonb`),
  discountBps: integer('discount_bps').notNull().default(0),
  monthlyCapCents: cents('monthly_cap_cents'),
  approverUserIds: jsonb('approver_user_ids').notNull().default(sql`'[]'::jsonb`),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [check('business_accounts_discount', sql`${t.discountBps} BETWEEN 0 AND 10000`)]);

export const businessMembers = pgTable('business_members', {
  id: id(),
  businessAccountId: uuid('business_account_id').notNull().references(() => businessAccounts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),
  costCenter: varchar('cost_center', { length: 60 }),
  monthlyCapCents: cents('monthly_cap_cents'),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('business_members_unique').on(t.businessAccountId, t.userId), index('business_members_user_idx').on(t.userId)]);

export const investors = pgTable('investors', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  profile: jsonb('profile').notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 20 }).notNull().default('prospect'),
  documents: jsonb('documents').notNull().default(sql`'[]'::jsonb`),
  notes: text('notes'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('investors_user_unique').on(t.userId)]);

export const vehicleFinancings = pgTable('vehicle_financings', {
  id: id(),
  investorId: uuid('investor_id').notNull().references(() => investors.id),
  vehicleId: uuid('vehicle_id').references(() => vehicles.id),
  principalCents: cents('principal_cents').notNull(),
  rateBps: integer('rate_bps').notNull(),
  termMonths: integer('term_months').notNull(),
  schedule: jsonb('schedule').notNull().default(sql`'[]'::jsonb`),
  status: varchar('status', { length: 20 }).notNull().default('proposed'),
  startedAt: tz('started_at'),
  createdAt: createdAt(),
}, (t) => [index('vehicle_financings_investor_idx').on(t.investorId), check('vehicle_financings_positive', sql`${t.principalCents} > 0 AND ${t.rateBps} >= 0 AND ${t.termMonths} > 0`)]);

/** Organisations (D42) : Neomoov seule en V1 ; plus tard flottes, compagnies de taxi et marque blanche. */
export const organizations = pgTable('organizations', {
  id: id(),
  code: varchar('code', { length: 40 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  type: varchar('type', { length: 20 }).notNull().default('platform'),
  settings: jsonb('settings').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('organizations_code_unique').on(t.code), check('organizations_type', sql`${t.type} IN ('platform', 'fleet', 'taxi_company', 'white_label')`)]);
