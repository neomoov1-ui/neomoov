/**
 * Étape 25 (amendement v1.2, section 9) : correspondance entre une entité de la plateforme et sa fiche chez le CRM
 * (HubSpot). Réservée à la plateforme : aucune politique d'isolation, donc fermée au rôle restreint des organisations.
 * Aucune donnée personnelle ici : seulement des identifiants, un état et la dernière erreur.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';

export const crmRecords = pgTable('crm_records', {
  id: id(),
  /** Entité Neomoov : prospect (`leads`), compte d'affaires (`business_accounts`) ou organisation. */
  entityType: varchar('entity_type', { length: 30 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  provider: varchar('provider', { length: 20 }).notNull(),
  /** Objet chez le fournisseur : contact, entreprise, transaction, note. */
  objectType: varchar('object_type', { length: 20 }).notNull(),
  externalId: varchar('external_id', { length: 100 }),
  status: varchar('status', { length: 12 }).notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  lastSyncedAt: tz('last_synced_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('crm_records_unique').on(t.provider, t.entityType, t.entityId, t.objectType),
  index('crm_records_status_idx').on(t.status, t.updatedAt),
  index('crm_records_entity_idx').on(t.entityType, t.entityId),
  check('crm_records_entity_type', sql`${t.entityType} IN ('lead', 'business_account', 'organization')`),
  check('crm_records_object_type', sql`${t.objectType} IN ('contact', 'company', 'deal', 'note')`),
  check('crm_records_status', sql`${t.status} IN ('pending', 'synced', 'error', 'skipped')`),
]);
