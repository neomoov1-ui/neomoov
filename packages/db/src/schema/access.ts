/**
 * Étape 19 (amendement v1.2) : permissions fines. Catalogue des permissions (rempli depuis le domaine), rôles système et
 * personnalisés, adhésions d'utilisateurs à des organisations (portée : l'organisation ou son sous-arbre), invitations à
 * usage unique, formules et modules effectifs d'une organisation.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, jsonb, pgTable, primaryKey, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz } from './_helpers.js';
import { users } from './identity.js';
import { organizations } from './partners.js';

export const permissions = pgTable('permissions', {
  code: varchar('code', { length: 60 }).primaryKey(),
  module: varchar('module', { length: 20 }).notNull(),
  description: text('description').notNull(),
  sensitive: boolean('sensitive').notNull().default(false),
  platformOnly: boolean('platform_only').notNull().default(false),
});

/** Rôle système (`organization_id` nul, défini par le domaine) ou personnalisé d'une organisation. */
export const roles = pgTable('roles', {
  id: id(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  code: varchar('code', { length: 60 }).notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  level: smallint('level').notNull(),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('roles_system_code_unique').on(t.code).where(sql`${t.organizationId} IS NULL`),
  uniqueIndex('roles_org_code_unique').on(t.organizationId, t.code).where(sql`${t.organizationId} IS NOT NULL`),
  check('roles_level', sql`${t.level} BETWEEN 0 AND 4`),
]);

/** Permissions d'un rôle ; `conditions` : lecture seule, montant maximal, zones (appliquées par l'API). */
export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionCode: varchar('permission_code', { length: 60 }).notNull().references(() => permissions.code),
  conditions: jsonb('conditions').notNull().default(sql`'{}'::jsonb`),
}, (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })]);

export const memberships = pgTable('memberships', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  scope: varchar('scope', { length: 12 }).notNull().default('organization'),
  status: varchar('status', { length: 12 }).notNull().default('active'),
  invitedByUserId: uuid('invited_by_user_id'),
  expiresAt: tz('expires_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('memberships_unique').on(t.userId, t.organizationId, t.roleId),
  index('memberships_user_idx').on(t.userId),
  index('memberships_org_idx').on(t.organizationId),
  check('memberships_scope', sql`${t.scope} IN ('organization', 'subtree')`),
  check('memberships_status', sql`${t.status} IN ('active', 'suspended')`),
]);

/** Invitation à usage unique (jeton haché), par courriel ou texto. */
export const invitations = pgTable('invitations', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  roleId: uuid('role_id').notNull().references(() => roles.id),
  scope: varchar('scope', { length: 12 }).notNull().default('organization'),
  email: varchar('email', { length: 200 }),
  phone: varchar('phone', { length: 20 }),
  tokenHash: varchar('token_hash', { length: 128 }).notNull(),
  expiresAt: tz('expires_at').notNull(),
  acceptedAt: tz('accepted_at'),
  acceptedByUserId: uuid('accepted_by_user_id'),
  revokedAt: tz('revoked_at'),
  invitedByUserId: uuid('invited_by_user_id').notNull(),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('invitations_token_unique').on(t.tokenHash),
  index('invitations_org_idx').on(t.organizationId),
  check('invitations_contact', sql`${t.email} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  check('invitations_scope', sql`${t.scope} IN ('organization', 'subtree')`),
]);

/** Formule commerciale : modules inclus et limites (membres, véhicules, sous-organisations). */
export const plans = pgTable('plans', {
  code: varchar('code', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  modules: jsonb('modules').notNull().default(sql`'[]'::jsonb`),
  limits: jsonb('limits').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

/** Modules effectifs d'une organisation : formule, options achetées, dérogations. */
export const organizationFeatures = pgTable('organization_features', {
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  module: varchar('module', { length: 20 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  source: varchar('source', { length: 12 }).notNull().default('plan'),
  limits: jsonb('limits').notNull().default(sql`'{}'::jsonb`),
}, (t) => [primaryKey({ columns: [t.organizationId, t.module] }), check('organization_features_source', sql`${t.source} IN ('plan', 'option', 'override')`)]);

/**
 * Étape 21 (amendement v1.2, section 3.2) : accès temporaire du support de la plateforme à une organisation cliente,
 * demandé avec un motif et une durée, approuvé ou refusé par l'organisation, révocable ; visible de l'organisation
 * (politique d'isolation) et journalisé.
 */
export const supportAccessGrants = pgTable('support_access_grants', {
  id: id(),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  requestedByUserId: uuid('requested_by_user_id').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  durationMinutes: smallint('duration_minutes').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('requested'),
  approvedByUserId: uuid('approved_by_user_id').references(() => users.id),
  startsAt: tz('starts_at'),
  endsAt: tz('ends_at'),
  createdAt: createdAt(),
}, (t) => [
  index('support_access_grants_org_idx').on(t.organizationId, t.createdAt),
  index('support_access_grants_requester_idx').on(t.requestedByUserId, t.status),
  check('support_access_grants_status', sql`${t.status} IN ('requested', 'approved', 'denied', 'expired', 'revoked')`),
  check('support_access_grants_duration', sql`${t.durationMinutes} BETWEEN 15 AND 1440`),
]);
