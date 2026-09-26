/** My Hub et API publique (prompt 12) : notes internes du personnel, prospects reçus du web et de WordPress. */

import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';

/** Note interne sur une fiche (chauffeur, client, course, véhicule), jamais visible de la personne concernée. */
export const staffNotes = pgTable('staff_notes', {
  id: id(),
  entityType: varchar('entity_type', { length: 20 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  authorUserId: uuid('author_user_id').notNull(),
  body: text('body').notNull(),
  createdAt: createdAt(),
}, (t) => [index('staff_notes_entity_idx').on(t.entityType, t.entityId, t.createdAt), check('staff_notes_entity_type', sql`${t.entityType} IN ('driver', 'client', 'ride', 'vehicle')`)]);

/** Prospect (préinscription d'un chauffeur, demande d'une entreprise ou d'un partenaire), avec son consentement. */
export const leads = pgTable('leads', {
  id: id(),
  kind: varchar('kind', { length: 20 }).notNull(),
  firstName: varchar('first_name', { length: 80 }).notNull(),
  lastName: varchar('last_name', { length: 80 }),
  phone: varchar('phone', { length: 20 }).notNull(),
  email: varchar('email', { length: 254 }),
  city: varchar('city', { length: 80 }),
  message: text('message'),
  language: varchar('language', { length: 2 }).notNull().default('fr'),
  source: varchar('source', { length: 30 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('new'),
  consentAt: tz('consent_at').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('leads_kind_status_idx').on(t.kind, t.status, t.createdAt),
  index('leads_phone_idx').on(t.phone),
  check('leads_kind', sql`${t.kind} IN ('driver', 'business', 'partner')`),
  check('leads_status', sql`${t.status} IN ('new', 'contacted', 'converted', 'discarded')`),
]);
