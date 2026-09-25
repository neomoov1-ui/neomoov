/** Section 4.1 : comptes et identité. */

import { sql } from 'drizzle-orm';
import { boolean, check, index, inet, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';
import { consentPurposeEnum, languageEnum, userRoleEnum, userStatusEnum } from './enums.js';

export const users = pgTable('users', {
  id: id(),
  phone: varchar('phone', { length: 20 }).notNull(),
  email: varchar('email', { length: 254 }),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  language: languageEnum('language').notNull().default('fr'),
  primaryRole: userRoleEnum('primary_role').notNull().default('client'),
  status: userStatusEnum('status').notNull().default('active'),
  appleId: varchar('apple_id', { length: 255 }),
  googleId: varchar('google_id', { length: 255 }),
  termsAcceptedAt: tz('terms_accepted_at'),
  privacyPolicyVersion: varchar('privacy_policy_version', { length: 20 }),
  deletedAt: tz('deleted_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('users_phone_unique').on(t.phone),
  uniqueIndex('users_email_unique').on(t.email).where(sql`${t.email} IS NOT NULL`),
  uniqueIndex('users_apple_id_unique').on(t.appleId).where(sql`${t.appleId} IS NOT NULL`),
  uniqueIndex('users_google_id_unique').on(t.googleId).where(sql`${t.googleId} IS NOT NULL`),
  check('users_phone_e164', sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
]);

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: userRoleEnum('role').notNull(),
  /** Périmètre : ville, partenaire ou compte entreprise, selon le rôle. */
  scope: varchar('scope', { length: 100 }).notNull().default('*'),
  grantedAt: createdAt(),
}, (t) => [primaryKey({ columns: [t.userId, t.role, t.scope] })]);

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id'),
  refreshTokenHash: varchar('refresh_token_hash', { length: 128 }).notNull(),
  /** Famille de jetons : la réutilisation d'un jeton déjà tourné révoque toute la famille. */
  family: uuid('family').notNull(),
  expiresAt: tz('expires_at').notNull(),
  revokedAt: tz('revoked_at'),
  ipAddress: inet('ip_address'),
  userAgent: varchar('user_agent', { length: 300 }),
  /** Méthodes d'authentification de la session (otp, apple, google, pwd, mfa) : un rafraîchissement les conserve. */
  amr: jsonb('amr').notNull().default(sql`'[]'::jsonb`),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('sessions_token_unique').on(t.refreshTokenHash), index('sessions_user_idx').on(t.userId), index('sessions_family_idx').on(t.family)]);

export const devices = pgTable('devices', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 10 }).notNull(),
  pushToken: varchar('push_token', { length: 300 }),
  appVersion: varchar('app_version', { length: 20 }),
  lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index('devices_user_idx').on(t.userId), uniqueIndex('devices_push_token_unique').on(t.pushToken).where(sql`${t.pushToken} IS NOT NULL`), check('devices_platform', sql`${t.platform} IN ('ios', 'android', 'web')`)]);

export const otpCodes = pgTable('otp_codes', {
  id: id(),
  phone: varchar('phone', { length: 20 }).notNull(),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  expiresAt: tz('expires_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: tz('consumed_at'),
  createdAt: createdAt(),
}, (t) => [index('otp_codes_phone_idx').on(t.phone, t.createdAt), check('otp_codes_attempts', sql`${t.attempts} BETWEEN 0 AND 10`)]);

export const consents = pgTable('consents', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: consentPurposeEnum('purpose').notNull(),
  version: varchar('version', { length: 20 }).notNull(),
  grantedAt: tz('granted_at').notNull().defaultNow(),
  withdrawnAt: tz('withdrawn_at'),
  source: varchar('source', { length: 30 }).notNull(),
}, (t) => [index('consents_user_purpose_idx').on(t.userId, t.purpose)]);

/** Table en ajout seul : un déclencheur interdit UPDATE et DELETE (migration 0001). */
export const auditLog = pgTable('audit_log', {
  id: id(),
  actorUserId: uuid('actor_user_id'),
  actorAgentCode: varchar('actor_agent_code', { length: 40 }),
  action: varchar('action', { length: 80 }).notNull(),
  entity: varchar('entity', { length: 60 }).notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ipAddress: inet('ip_address'),
  /** Identifiant de corrélation de la requête HTTP (en-tête x-correlation-id), pour relier audit et journaux. */
  correlationId: varchar('correlation_id', { length: 64 }),
  occurredAt: tz('occurred_at').notNull().defaultNow(),
}, (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId), index('audit_log_actor_idx').on(t.actorUserId, t.occurredAt), index('audit_log_time_idx').on(t.occurredAt)]);

export const featureFlags = pgTable('feature_flags', {
  code: varchar('code', { length: 60 }).primaryKey(),
  active: boolean('active').notNull().default(false),
  percentage: integer('percentage').notNull().default(100),
  targeting: jsonb('targeting'),
  updatedAt: updatedAt(),
}, (t) => [check('feature_flags_percentage', sql`${t.percentage} BETWEEN 0 AND 100`)]);

export const settings = pgTable('settings', {
  key: varchar('key', { length: 80 }).notNull(),
  scope: varchar('scope', { length: 40 }).notNull().default('global'),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
}, (t) => [primaryKey({ columns: [t.key, t.scope] })]);

/**
 * Personnel de My Hub (rôles admin, operator, finance, readonly) : mot de passe argon2id et second facteur TOTP
 * (secret chiffré avec ENCRYPTION_KEY), codes de secours hachés, verrouillage progressif. Clients et chauffeurs n'ont
 * jamais de mot de passe (prompt 03).
 */
export const staffCredentials = pgTable('staff_credentials', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  totpSecretEncrypted: varchar('totp_secret_encrypted', { length: 255 }),
  /** Secret en cours d'inscription, confirmé par un premier code valide. */
  totpPendingSecretEncrypted: varchar('totp_pending_secret_encrypted', { length: 255 }),
  totpEnabledAt: tz('totp_enabled_at'),
  backupCodeHashes: jsonb('backup_code_hashes').notNull().default(sql`'[]'::jsonb`),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: tz('locked_until'),
  passwordChangedAt: tz('password_changed_at').notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Comptes de service (agents et intégrations, section 7.1) : clé à portée limitée, hachée, révocable. */
export const apiKeys = pgTable('api_keys', {
  id: id(),
  name: varchar('name', { length: 100 }).notNull(),
  /** Début public de la clé (recherche), le reste n'existe qu'en haché. */
  prefix: varchar('prefix', { length: 24 }).notNull(),
  keyHash: varchar('key_hash', { length: 128 }).notNull(),
  scopes: jsonb('scopes').notNull().default(sql`'[]'::jsonb`),
  agentCode: varchar('agent_code', { length: 40 }),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  expiresAt: tz('expires_at'),
  lastUsedAt: tz('last_used_at'),
  revokedAt: tz('revoked_at'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('api_keys_prefix_unique').on(t.prefix), uniqueIndex('api_keys_hash_unique').on(t.keyHash)]);
