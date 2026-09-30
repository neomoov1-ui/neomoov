/**
 * Étape 22 (amendement v1.2, section 5) : marque par organisation et domaines web du client. Une ligne `brands` par
 * organisation (facultative : sans ligne, la marque Neomoov s'applique) ; chaque champ nul est pris chez Neomoov à la
 * résolution (`resolveBrand` du domaine). Les domaines sont vérifiés à la main en V1 (jeton rendu à la création).
 * Le code de rattachement est sur `organizations.join_code` (partners.ts).
 */
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';
import { organizations } from './partners.js';

export const brands = pgTable('brands', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 120 }),
  logoUrl: text('logo_url'),
  /** `primary`, `secondary`, `background`, `text`, `accent` : couleurs hexadécimales, chacune facultative. */
  colors: jsonb('colors').notNull().default(sql`'{}'::jsonb`),
  tagline: varchar('tagline', { length: 200 }),
  /** Textes personnalisables des écrans, par clé. */
  texts: jsonb('texts').notNull().default(sql`'{}'::jsonb`),
  supportPhone: varchar('support_phone', { length: 20 }),
  supportEmail: varchar('support_email', { length: 254 }),
  emailSenderName: varchar('email_sender_name', { length: 120 }),
  emailSenderAddress: varchar('email_sender_address', { length: 254 }),
  smsSender: varchar('sms_sender', { length: 20 }),
  termsUrl: text('terms_url'),
  privacyUrl: text('privacy_url'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex('brands_organization_unique').on(t.organizationId)]);

export const organizationDomains = pgTable('organization_domains', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  domain: varchar('domain', { length: 253 }).notNull(),
  kind: varchar('kind', { length: 10 }).notNull().default('booking'),
  verificationToken: varchar('verification_token', { length: 64 }).notNull(),
  verifiedAt: tz('verified_at'),
  verifiedByUserId: uuid('verified_by_user_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('organization_domains_domain_unique').on(t.domain),
  index('organization_domains_org_idx').on(t.organizationId),
  check('organization_domains_kind', sql`${t.kind} IN ('booking', 'hub')`),
]);
