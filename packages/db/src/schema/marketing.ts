/**
 * Marketing automatisé (phase 1 « entreprise autonome », 2 octobre 2026) : calendrier de contenu des dix espaces et de
 * l'infolettre, commentaires reçus sur les publications, tâches de référencement. Tables réservées à la plateforme (aucune
 * donnée d'organisation cliente : les réseaux et le site sont ceux de Neomoov) : sécurité au niveau des lignes activée,
 * aucune politique, liste `PLATFORM_ONLY_TABLES` (docs/isolation.md).
 */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, pgTable, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';
import { agentRuns } from './agents.js';

/**
 * Publication multiréseau (3 octobre 2026) : un sujet décliné en un contenu par réseau (composer de My Hub ou lot importé),
 * texte de base gardé pour relire et réadapter. Campagne et référence rendent l'import rejouable sans doublon.
 */
export const contentGroups = pgTable('content_groups', {
  id: id(),
  campaign: varchar('campaign', { length: 60 }),
  ref: varchar('ref', { length: 40 }),
  /** `composer` (My Hub) ou `import` (fichier JSON au format docs/marketing/lancement-50-publications.schema.json). */
  source: varchar('source', { length: 10 }).notNull().default('composer'),
  title: varchar('title', { length: 200 }).notNull(),
  body: text('body').notNull(),
  shortText: varchar('short_text', { length: 300 }).notNull(),
  imageText: varchar('image_text', { length: 80 }),
  cta: varchar('cta', { length: 12 }).notNull().default('none'),
  hashtags: jsonb('hashtags').notNull().default(sql`'[]'::jsonb`),
  photoHints: jsonb('photo_hints').notNull().default(sql`'[]'::jsonb`),
  /** Jour relatif demandé dans le lot (1 = premier jour), ou nul. */
  day: smallint('day'),
  pillar: varchar('pillar', { length: 20 }),
  audience: varchar('audience', { length: 20 }),
  notes: text('notes'),
  /** Signalée sensible par l'auteur : jamais approuvée en lot. */
  sensitive: boolean('sensitive').notNull().default(false),
  /** Saisie d'origine (réseaux visés, variantes par réseau), pour réadapter sans perte. */
  input: jsonb('input').notNull().default(sql`'{}'::jsonb`),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('content_groups_campaign_ref_uq').on(t.campaign, t.ref).where(sql`${t.campaign} IS NOT NULL AND ${t.ref} IS NOT NULL`),
  index('content_groups_created_idx').on(t.createdAt),
  check('content_groups_source', sql`${t.source} IN ('composer', 'import')`),
  check('content_groups_cta', sql`${t.cta} IN ('reserve', 'academy', 'preregister', 'none')`),
]);

export const contentItems = pgTable('content_items', {
  id: id(),
  /** Lundi de la semaine planifiée (calendrier produit le vendredi pour la semaine suivante). */
  weekOf: date('week_of').notNull(),
  space: varchar('space', { length: 20 }).notNull(),
  format: varchar('format', { length: 12 }).notNull(),
  language: varchar('language', { length: 2 }).notNull().default('fr'),
  title: varchar('title', { length: 200 }),
  body: text('body').notNull(),
  caption: text('caption'),
  hashtags: jsonb('hashtags').notNull().default(sql`'[]'::jsonb`),
  /** Appel à l'action : `reserve`, `academy`, `preregister`, `none`. */
  cta: varchar('cta', { length: 12 }).notNull().default('none'),
  /** Phrase du visuel de marque (gabarit HTML rendu en PNG). */
  visualHeadline: varchar('visual_headline', { length: 160 }),
  /** Référence de stockage du média (PNG, MP4 ou gabarit HTML) et sa nature ; état de production du média. */
  mediaKey: varchar('media_key', { length: 300 }),
  mediaKind: varchar('media_kind', { length: 10 }),
  mediaStatus: varchar('media_status', { length: 12 }).notNull().default('none'),
  scheduledAt: tz('scheduled_at'),
  status: varchar('status', { length: 12 }).notNull().default('draft'),
  /** Sujet sensible (classé par l'agent ou par les règles) : approbation humaine obligatoire, quel que soit le mode. */
  sensitive: boolean('sensitive').notNull().default(false),
  /** Écarts relevés par les règles du domaine (`checkContent`), gardés pour la personne qui approuve. */
  issues: jsonb('issues').notNull().default(sql`'[]'::jsonb`),
  promptVersion: varchar('prompt_version', { length: 40 }),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  approvedByUserId: uuid('approved_by_user_id'),
  approvedAt: tz('approved_at'),
  rejectedReason: text('rejected_reason'),
  /** Identifiant et adresse chez le réseau après publication. */
  externalId: varchar('external_id', { length: 200 }),
  externalUrl: varchar('external_url', { length: 500 }),
  publishedAt: tz('published_at'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: tz('next_attempt_at'),
  lastError: text('last_error'),
  /** Mesures (portée, interactions, clics) : dernière lecture et historique J+1, J+7. */
  metrics: jsonb('metrics').notNull().default(sql`'{}'::jsonb`),
  measureCount: smallint('measure_count').notNull().default(0),
  measureDueAt: tz('measure_due_at'),
  /** Dernière lecture des commentaires (fenêtre de relecture). */
  commentsCheckedAt: tz('comments_checked_at'),
  /** Publication multiréseau dont le contenu fait partie (nul pour le calendrier de l'agent contenu). */
  groupId: uuid('group_id').references(() => contentGroups.id, { onDelete: 'cascade' }),
  /** `auto` : publié par le connecteur ; `manual` : relais manuel (vue « À relayer » de My Hub). */
  delivery: varchar('delivery', { length: 8 }).notNull().default('auto'),
  /** Variante du visuel (gabarit, photo, recadrage, accent, texte, taille, empreinte), toutes différentes dans une publication. */
  visual: jsonb('visual'),
  relayedAt: tz('relayed_at'),
  relayedByUserId: uuid('relayed_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('content_items_week_idx').on(t.weekOf, t.space),
  index('content_items_status_idx').on(t.status, t.scheduledAt),
  index('content_items_measure_idx').on(t.measureDueAt).where(sql`${t.status} = 'published'`),
  index('content_items_group_idx').on(t.groupId),
  index('content_items_relay_idx').on(t.scheduledAt).where(sql`${t.delivery} = 'manual' AND ${t.status} = 'scheduled'`),
  check('content_items_space', sql`${t.space} IN ('site_blog', 'academy', 'google_business', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'snapchat', 'newsletter', 'telegram', 'whatsapp_channel')`),
  check('content_items_delivery', sql`${t.delivery} IN ('auto', 'manual')`),
  check('content_items_format', sql`${t.format} IN ('post', 'article', 'reel', 'story', 'video', 'short', 'newsletter')`),
  check('content_items_language', sql`${t.language} IN ('fr', 'en')`),
  check('content_items_cta', sql`${t.cta} IN ('reserve', 'academy', 'preregister', 'none')`),
  check('content_items_status', sql`${t.status} IN ('draft', 'approved', 'scheduled', 'published', 'failed', 'measured', 'rejected')`),
  check('content_items_media_status', sql`${t.mediaStatus} IN ('none', 'pending', 'html', 'ready', 'failed')`),
]);

export const contentComments = pgTable('content_comments', {
  id: id(),
  contentItemId: uuid('content_item_id').notNull().references(() => contentItems.id, { onDelete: 'cascade' }),
  externalId: varchar('external_id', { length: 200 }).notNull(),
  author: varchar('author', { length: 120 }),
  body: text('body').notNull(),
  postedAt: tz('posted_at').notNull(),
  /** Intention classée sans modèle : `thanks`, `hours`, `booking`, `other`. */
  intent: varchar('intent', { length: 12 }).notNull(),
  /** `replied` (réponse automatique), `forwarded` (relation client), `escalated` (humain), `ignored`. */
  outcome: varchar('outcome', { length: 12 }).notNull(),
  replyBody: text('reply_body'),
  replyExternalId: varchar('reply_external_id', { length: 200 }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('content_comments_external_uq').on(t.contentItemId, t.externalId),
  index('content_comments_item_idx').on(t.contentItemId, t.postedAt),
  check('content_comments_intent', sql`${t.intent} IN ('thanks', 'hours', 'booking', 'other')`),
  check('content_comments_outcome', sql`${t.outcome} IN ('replied', 'forwarded', 'escalated', 'ignored')`),
]);

export const seoTasks = pgTable('seo_tasks', {
  id: id(),
  weekOf: date('week_of').notNull(),
  /** `new_page`, `new_article`, `fix_title`, `fix_description`, `faq_question`, `internal_link`. */
  action: varchar('action', { length: 20 }).notNull(),
  targetKind: varchar('target_kind', { length: 8 }).notNull(),
  /** Identifiant de la page ou de l'article visé chez WordPress ; nul pour une création. */
  targetRef: varchar('target_ref', { length: 300 }),
  targetTitle: varchar('target_title', { length: 200 }),
  targetUrl: varchar('target_url', { length: 500 }),
  keyword: varchar('keyword', { length: 120 }),
  justification: text('justification').notNull(),
  /** Proposition concrète (titre, description, question et réponse, plan, texte, lien). */
  proposal: jsonb('proposal').notNull().default(sql`'{}'::jsonb`),
  status: varchar('status', { length: 12 }).notNull().default('proposed'),
  metricsBefore: jsonb('metrics_before'),
  metricsAfter: jsonb('metrics_after'),
  /** Brouillon créé ou page modifiée chez WordPress. */
  externalId: varchar('external_id', { length: 100 }),
  externalUrl: varchar('external_url', { length: 500 }),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedAt: tz('decided_at'),
  decisionNote: text('decision_note'),
  appliedAt: tz('applied_at'),
  measureDueAt: tz('measure_due_at'),
  measuredAt: tz('measured_at'),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('seo_tasks_status_idx').on(t.status, t.createdAt),
  index('seo_tasks_week_idx').on(t.weekOf),
  check('seo_tasks_action', sql`${t.action} IN ('new_page', 'new_article', 'fix_title', 'fix_description', 'faq_question', 'internal_link')`),
  check('seo_tasks_target_kind', sql`${t.targetKind} IN ('page', 'post', 'site')`),
  check('seo_tasks_status', sql`${t.status} IN ('proposed', 'approved', 'applied', 'rejected', 'failed', 'measured')`),
]);
