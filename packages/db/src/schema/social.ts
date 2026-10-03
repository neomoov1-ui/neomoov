/**
 * Comptes des réseaux sociaux de Neomoov (3 octobre 2026) : un enregistrement par espace (blogue, Facebook, Instagram,
 * LinkedIn, X, TikTok, Snapchat, Telegram, YouTube, chaîne WhatsApp) pour la plateforme. Jetons et secrets chiffrés
 * par `FieldCipher` dans `credentials` (objet JSON chiffré, jamais rendu par l'API). Table réservée à la plateforme :
 * sécurité au niveau des lignes activée, aucune politique, liste `PLATFORM_ONLY_TABLES` (docs/isolation.md).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';

export const socialAccounts = pgTable('social_accounts', {
  id: id(),
  space: varchar('space', { length: 20 }).notNull(),
  /** `direct` (API du réseau), `manual` (relais manuel) ; `aggregator` prévu par le contrat, non retenu. */
  mode: varchar('mode', { length: 12 }).notNull().default('direct'),
  /** État calculé : `not_connected`, `connected`, `invalid`, `expired`, `pending_approval`. */
  status: varchar('status', { length: 20 }).notNull().default('not_connected'),
  /** Résultat de la dernière validation du mode direct (l'état affiché en dérive). */
  validation: varchar('validation', { length: 20 }).notNull().default('not_connected'),
  accountId: varchar('account_id', { length: 120 }),
  accountName: varchar('account_name', { length: 200 }),
  profileUrl: varchar('profile_url', { length: 500 }),
  showOnSite: boolean('show_on_site').notNull().default(true),
  /** Jetons, secrets et comptes proposés après l'autorisation : JSON chiffré (`v1.<iv>.<données>.<étiquette>`). */
  credentials: text('credentials'),
  scopes: jsonb('scopes').notNull().default(sql`'[]'::jsonb`),
  /** Échéance de l'autorisation (jeton d'accès sans rafraîchissement possible, ou jeton de rafraîchissement). */
  expiresAt: tz('expires_at'),
  /** Échéance du jeton d'accès courant (rafraîchi avant son terme). */
  accessExpiresAt: tz('access_expires_at'),
  lastValidatedAt: tz('last_validated_at'),
  lastError: text('last_error'),
  /** Approbation de l'application par le réseau (LinkedIn, TikTok, YouTube), confirmée par le fondateur. */
  appApprovedAt: tz('app_approved_at'),
  connectedAt: tz('connected_at'),
  connectedByUserId: uuid('connected_by_user_id'),
  updatedByUserId: uuid('updated_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('social_accounts_space_uq').on(t.space),
  check('social_accounts_space', sql`${t.space} IN ('site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel')`),
  check('social_accounts_mode', sql`${t.mode} IN ('direct', 'aggregator', 'manual')`),
  check('social_accounts_status', sql`${t.status} IN ('not_connected', 'connected', 'invalid', 'expired', 'pending_approval')`),
  check('social_accounts_validation', sql`${t.validation} IN ('not_connected', 'connected', 'invalid', 'expired', 'pending_approval')`),
]);
