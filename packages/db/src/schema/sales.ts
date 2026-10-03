/**
 * Direction commerciale automatisée (phase 1 « Neomoov entreprise autonome », 2 octobre 2026) : prospects d'affaires
 * (organisations, jamais un particulier), fil des contacts, relances planifiées et appels sortants. Tables réservées à la
 * plateforme (docs/isolation.md) : sécurité au niveau des lignes activée sans politique, donc fermées au rôle restreint
 * des organisations. Données minimisées : coordonnées professionnelles, résumés courts, jamais de transcription complète.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, numeric, pgTable, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';
import { agentRuns } from './agents.js';
import { leads } from './backoffice.js';
import { organizations } from './partners.js';

export const prospects = pgTable('prospects', {
  id: id(),
  organizationName: varchar('organization_name', { length: 200 }).notNull(),
  legalName: varchar('legal_name', { length: 200 }),
  /** Segment : hôtel, entreprise, agence, événement, clinique, école, autre. */
  segment: varchar('segment', { length: 20 }).notNull().default('other'),
  size: varchar('size', { length: 10 }).notNull().default('unknown'),
  interest: varchar('interest', { length: 10 }).notNull().default('unknown'),
  /** Origine : Google Places, fichier CSV importé par My Hub, formulaire du site (`leads`), saisie manuelle. */
  source: varchar('source', { length: 20 }).notNull(),
  /** Identifiant chez la source (lieu Google, ligne d'import), pour ne jamais créer deux fois le même prospect. */
  sourceRef: varchar('source_ref', { length: 120 }),
  website: varchar('website', { length: 300 }),
  city: varchar('city', { length: 80 }),
  /** Réputation publique (Google) connue à la création, entrée du score. */
  rating: numeric('rating', { precision: 2, scale: 1 }),
  reviewCount: integer('review_count'),
  contactName: varchar('contact_name', { length: 120 }),
  contactRole: varchar('contact_role', { length: 80 }),
  /** Adresse professionnelle (jamais une messagerie grand public) et numéro d'affaires. */
  email: varchar('email', { length: 254 }),
  phone: varchar('phone', { length: 20 }),
  whatsappOk: boolean('whatsapp_ok').notNull().default(false),
  language: varchar('language', { length: 2 }).notNull().default('fr'),
  /** Base légale du démarchage (Loi anti-pourriel, Loi 25) et journal du consentement. */
  consentBasis: varchar('consent_basis', { length: 30 }).notNull().default('published_address'),
  consentAt: tz('consent_at'),
  consentSource: varchar('consent_source', { length: 120 }),
  /** Retrait demandé : définitif, plus aucun envoi ni appel. */
  unsubscribedAt: tz('unsubscribed_at'),
  score: smallint('score').notNull().default(0),
  stage: varchar('stage', { length: 20 }).notNull().default('new'),
  stageReason: text('stage_reason'),
  lostAt: tz('lost_at'),
  /** Identifiant de la fiche chez HubSpot (contact), repris de `crm_records` après synchronisation. */
  hubspotId: varchar('hubspot_id', { length: 100 }),
  nextAction: varchar('next_action', { length: 40 }),
  nextActionAt: tz('next_action_at'),
  /** Séquence approuvée en cours (docs/sales/sequences.md) et canal d'origine des relances. */
  sequenceKey: varchar('sequence_key', { length: 60 }),
  sequenceChannel: varchar('sequence_channel', { length: 12 }),
  firstContactAt: tz('first_contact_at'),
  /** Dernier devis entreprise (volume, remise, délai, validité, dans la grille ou non). */
  lastQuote: jsonb('last_quote'),
  leadId: uuid('lead_id').references(() => leads.id, { onDelete: 'set null' }),
  /** Organisation cliente ouverte pour ce prospect (compte gagné). */
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('prospects_email_uq').on(t.email).where(sql`${t.email} IS NOT NULL`),
  uniqueIndex('prospects_source_ref_uq').on(t.source, t.sourceRef).where(sql`${t.sourceRef} IS NOT NULL`),
  uniqueIndex('prospects_lead_uq').on(t.leadId).where(sql`${t.leadId} IS NOT NULL`),
  index('prospects_stage_idx').on(t.stage, t.score),
  index('prospects_next_action_idx').on(t.nextActionAt).where(sql`${t.nextActionAt} IS NOT NULL`),
  index('prospects_created_idx').on(t.source, t.createdAt),
  check('prospects_segment', sql`${t.segment} IN ('hotel', 'business', 'agency', 'event', 'clinic', 'school', 'other')`),
  check('prospects_size', sql`${t.size} IN ('small', 'medium', 'large', 'unknown')`),
  check('prospects_interest', sql`${t.interest} IN ('low', 'medium', 'high', 'unknown')`),
  check('prospects_source', sql`${t.source} IN ('google_places', 'csv_import', 'web_lead', 'manual')`),
  check('prospects_stage', sql`${t.stage} IN ('new', 'qualified', 'contacted', 'replied', 'meeting', 'quote', 'won', 'lost', 'do_not_contact')`),
  check('prospects_consent_basis', sql`${t.consentBasis} IN ('published_address', 'form', 'existing_relationship', 'referral', 'none')`),
  check('prospects_score', sql`${t.score} BETWEEN 0 AND 100`),
  check('prospects_language', sql`${t.language} IN ('fr', 'en')`),
]);

/** Fil des contacts d'un prospect : canal, sens, résumé court (jamais le message entier), résultat, référence (avis, appel). */
export const prospectTouches = pgTable('prospect_touches', {
  id: id(),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 12 }).notNull(),
  direction: varchar('direction', { length: 8 }).notNull(),
  summary: varchar('summary', { length: 500 }).notNull(),
  result: varchar('result', { length: 40 }),
  ref: varchar('ref', { length: 120 }),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  userId: uuid('user_id'),
  occurredAt: tz('occurred_at').notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  index('prospect_touches_prospect_idx').on(t.prospectId, t.occurredAt),
  check('prospect_touches_channel', sql`${t.channel} IN ('email', 'whatsapp', 'sms', 'call', 'meeting', 'note')`),
  check('prospect_touches_direction', sql`${t.direction} IN ('outbound', 'inbound')`),
]);

/**
 * Relances planifiées (agent `followups`) : cible (prospect, devis, candidat chauffeur, réservation web), canal d'origine,
 * échéance, nombre de relances faites, clôture. Une seule chaîne ouverte par cible. Finalisation du 3 octobre 2026 : rappel
 * d'un appel manqué de la boîte unifiée (cible `missed_call` = la conversation, canal `voice`), persistant sans Redis.
 */
export const followups = pgTable('followups', {
  id: id(),
  targetType: varchar('target_type', { length: 20 }).notNull(),
  targetId: uuid('target_id').notNull(),
  prospectId: uuid('prospect_id').references(() => prospects.id, { onDelete: 'cascade' }),
  channel: varchar('channel', { length: 12 }).notNull(),
  dueAt: tz('due_at').notNull(),
  status: varchar('status', { length: 12 }).notNull().default('scheduled'),
  /** Relances déjà envoyées ; `max_attempts` : nombre d'échéances du réglage `sales.followup_days`. */
  attempt: smallint('attempt').notNull().default(0),
  maxAttempts: smallint('max_attempts').notNull().default(3),
  /** Date de référence des échéances (premier contact, devis envoyé, candidature). */
  referenceAt: tz('reference_at').notNull(),
  lastSentAt: tz('last_sent_at'),
  closedAt: tz('closed_at'),
  closeReason: varchar('close_reason', { length: 40 }),
  language: varchar('language', { length: 2 }).notNull().default('fr'),
  /** Contexte minimal pour rédiger la relance (gabarit, sujet, extraits du fil). */
  context: jsonb('context').notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('followups_open_target_uq').on(t.targetType, t.targetId).where(sql`${t.status} IN ('scheduled', 'sent')`),
  index('followups_due_idx').on(t.dueAt).where(sql`${t.status} = 'scheduled'`),
  index('followups_prospect_idx').on(t.prospectId),
  check('followups_target_type', sql`${t.targetType} IN ('prospect', 'quote', 'driver_candidate', 'web_booking', 'missed_call')`),
  check('followups_status', sql`${t.status} IN ('scheduled', 'sent', 'replied', 'closed', 'cancelled')`),
  check('followups_channel', sql`${t.channel} IN ('email', 'whatsapp', 'sms', 'push', 'voice')`),
  check('followups_attempts', sql`${t.attempt} >= 0 AND ${t.maxAttempts} >= 0`),
]);

/**
 * Appels sortants (agent `outbound_calls`, Vapi) : prospect, script, assistant, identifiant d'appel chez Vapi, résultat,
 * résumé, coût, consentement à l'enregistrement (annoncé par l'assistant quand il est activé).
 */
export const outboundCalls = pgTable('outbound_calls', {
  id: id(),
  prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
  scriptKey: varchar('script_key', { length: 60 }).notNull().default('b2b_intro'),
  assistantId: varchar('assistant_id', { length: 100 }),
  phoneNumberId: varchar('phone_number_id', { length: 100 }),
  toPhone: varchar('to_phone', { length: 20 }),
  scheduledAt: tz('scheduled_at').notNull(),
  startedAt: tz('started_at'),
  endedAt: tz('ended_at'),
  status: varchar('status', { length: 12 }).notNull().default('scheduled'),
  vapiCallId: varchar('vapi_call_id', { length: 100 }),
  result: varchar('result', { length: 20 }),
  summary: text('summary'),
  costMicros: integer('cost_micros').notNull().default(0),
  durationSeconds: integer('duration_seconds'),
  recordingConsent: boolean('recording_consent').notNull().default(false),
  meetingAt: tz('meeting_at'),
  callbackAt: tz('callback_at'),
  /** Tentatives d'appel déjà faites pour ce prospect sur cette chaîne (messagerie, sans réponse). */
  attempt: smallint('attempt').notNull().default(0),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  createdByUserId: uuid('created_by_user_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex('outbound_calls_vapi_uq').on(t.vapiCallId).where(sql`${t.vapiCallId} IS NOT NULL`),
  index('outbound_calls_due_idx').on(t.scheduledAt).where(sql`${t.status} = 'scheduled'`),
  index('outbound_calls_prospect_idx').on(t.prospectId, t.createdAt),
  check('outbound_calls_status', sql`${t.status} IN ('scheduled', 'calling', 'completed', 'failed', 'cancelled')`),
  check('outbound_calls_result', sql`${t.result} IS NULL OR ${t.result} IN ('meeting', 'callback', 'not_interested', 'voicemail', 'no_answer', 'do_not_contact', 'failed')`),
]);
