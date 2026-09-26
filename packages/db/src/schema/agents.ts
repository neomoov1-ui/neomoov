/** Section 4.9 : agents IA et exploitation. */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';
import { agentModeEnum, agentRunStatusEnum, approvalDecisionEnum, notificationChannelEnum } from './enums.js';
import { users } from './identity.js';
import { rides } from './rides.js';

export const agents = pgTable('agents', {
  code: varchar('code', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  mode: agentModeEnum('mode').notNull().default('approval'),
  /** Modèle Claude de l'agent (décision du 26 septembre 2026 : `claude-opus-5-5` par défaut). */
  model: varchar('model', { length: 60 }).notNull().default('claude-opus-5-5'),
  effort: varchar('effort', { length: 10 }).notNull().default('low'),
  systemPromptKey: varchar('system_prompt_key', { length: 100 }),
  tools: jsonb('tools').notNull().default(sql`'[]'::jsonb`),
  thresholds: jsonb('thresholds').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  /** Date du dernier passage en mode automatique (après quatre semaines sans erreur). */
  autoSince: tz('auto_since'),
  updatedAt: updatedAt(),
}, (t) => [check('agents_effort', sql`${t.effort} IN ('low', 'medium', 'high', 'xhigh', 'max')`)]);

/**
 * Prompts système versionnés (`docs/agents/*.md`, chargés par les données de départ) : une clé par version, jamais
 * modifiée ; `agents.system_prompt_key` désigne la version en service.
 */
export const agentPrompts = pgTable('agent_prompts', {
  key: varchar('key', { length: 100 }).primaryKey(),
  agentCode: varchar('agent_code', { length: 40 }).notNull().references(() => agents.code),
  version: smallint('version').notNull(),
  body: text('body').notNull(),
  sha256: varchar('sha256', { length: 64 }).notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('agent_prompts_version_uq').on(t.agentCode, t.version)]);

export const agentRuns = pgTable('agent_runs', {
  id: id(),
  agentCode: varchar('agent_code', { length: 40 }).notNull().references(() => agents.code),
  trigger: varchar('trigger', { length: 60 }).notNull(),
  triggerRef: varchar('trigger_ref', { length: 120 }),
  input: jsonb('input'),
  output: jsonb('output'),
  toolCalls: jsonb('tool_calls').notNull().default(sql`'[]'::jsonb`),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  /** Lectures et écritures du cache de prompt (facturées à un autre tarif). */
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  /** Coût en micro-dollars, selon le barème du réglage `agents.llm_pricing` et le modèle qui a servi la requête. */
  costMicros: integer('cost_micros').notNull().default(0),
  model: varchar('model', { length: 60 }),
  durationMs: integer('duration_ms'),
  status: agentRunStatusEnum('status').notNull().default('running'),
  error: text('error'),
  startedAt: createdAt(),
  finishedAt: tz('finished_at'),
}, (t) => [
  index('agent_runs_agent_idx').on(t.agentCode, t.startedAt),
  index('agent_runs_status_idx').on(t.status).where(sql`${t.status} IN ('running', 'awaiting_approval')`),
  index('agent_runs_started_idx').on(t.startedAt),
  // Un même déclencheur (message, document, relevé, rapport d'une période) ne produit qu'une exécution.
  uniqueIndex('agent_runs_trigger_uq').on(t.agentCode, t.trigger, t.triggerRef).where(sql`${t.triggerRef} IS NOT NULL`),
]);

export const approvals = pgTable('approvals', {
  id: id(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id),
  proposedAction: varchar('proposed_action', { length: 80 }).notNull(),
  data: jsonb('data').notNull(),
  justification: text('justification'),
  decision: approvalDecisionEnum('decision').notNull().default('pending'),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedAt: tz('decided_at'),
  /** Motif de la décision (obligatoire pour un refus). */
  decisionNote: text('decision_note'),
  /** Exécution de l'action approuvée : une seule fois ; une erreur permet une nouvelle tentative (clé d'idempotence). */
  executedAt: tz('executed_at'),
  executionResult: jsonb('execution_result'),
  executionError: text('execution_error'),
  createdAt: createdAt(),
}, (t) => [index('approvals_pending_idx').on(t.createdAt).where(sql`${t.decision} = 'pending'`), index('approvals_run_idx').on(t.agentRunId)]);

/**
 * Conversations de l'assistance (agent relation client) : une par client et par canal tant qu'elle est ouverte ou
 * escaladée. Le téléphone n'est gardé que pour répondre sur le canal d'entrée (WhatsApp, texto) d'un client sans compte.
 */
export const conversations = pgTable('conversations', {
  id: id(),
  channel: varchar('channel', { length: 10 }).notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  phone: varchar('phone', { length: 20 }),
  language: varchar('language', { length: 2 }).notNull().default('fr'),
  rideId: uuid('ride_id').references(() => rides.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 12 }).notNull().default('open'),
  escalationReason: text('escalation_reason'),
  escalatedAt: tz('escalated_at'),
  lastMessageAt: tz('last_message_at').notNull().defaultNow(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index('conversations_user_idx').on(t.userId, t.lastMessageAt),
  index('conversations_phone_idx').on(t.phone, t.lastMessageAt),
  index('conversations_open_idx').on(t.status, t.lastMessageAt).where(sql`${t.status} <> 'closed'`),
  check('conversations_channel', sql`${t.channel} IN ('whatsapp', 'sms', 'voice', 'web', 'app')`),
  check('conversations_status', sql`${t.status} IN ('open', 'escalated', 'closed')`),
  check('conversations_party', sql`${t.userId} IS NOT NULL OR ${t.phone} IS NOT NULL`),
]);

export const conversationMessages = pgTable('conversation_messages', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  direction: varchar('direction', { length: 8 }).notNull(),
  /** `client`, `agent` (réponse de l'agent), `staff` (humain), `system` (accusé de réception, suivi d'approbation). */
  author: varchar('author', { length: 10 }).notNull(),
  body: text('body').notNull(),
  /** Identifiant du message chez le canal d'entrée : un message reçu deux fois n'est traité qu'une fois. */
  externalId: varchar('external_id', { length: 120 }),
  agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (t) => [
  index('conversation_messages_conversation_idx').on(t.conversationId, t.createdAt),
  uniqueIndex('conversation_messages_external_uq').on(t.externalId).where(sql`${t.externalId} IS NOT NULL`),
  check('conversation_messages_direction', sql`${t.direction} IN ('inbound', 'outbound')`),
]);

export const notifications = pgTable('notifications', {
  id: id(),
  recipientUserId: uuid('recipient_user_id'),
  recipientAddress: varchar('recipient_address', { length: 254 }),
  channel: notificationChannelEnum('channel').notNull(),
  template: varchar('template', { length: 80 }).notNull(),
  language: varchar('language', { length: 2 }).notNull().default('fr'),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  providerMessageId: varchar('provider_message_id', { length: 120 }),
  sentAt: tz('sent_at'),
  deliveredAt: tz('delivered_at'),
  readAt: tz('read_at'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [index('notifications_recipient_idx').on(t.recipientUserId, t.createdAt), index('notifications_pending_idx').on(t.createdAt).where(sql`${t.sentAt} IS NULL AND ${t.error} IS NULL`)]);
