/** Section 4.9 : agents IA et exploitation. */

import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, tz, updatedAt } from './_helpers.js';
import { agentModeEnum, agentRunStatusEnum, approvalDecisionEnum, notificationChannelEnum } from './enums.js';

export const agents = pgTable('agents', {
  code: varchar('code', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  mode: agentModeEnum('mode').notNull().default('approval'),
  model: varchar('model', { length: 60 }).notNull().default('claude-opus-5'),
  effort: varchar('effort', { length: 10 }).notNull().default('low'),
  systemPromptKey: varchar('system_prompt_key', { length: 100 }),
  tools: jsonb('tools').notNull().default(sql`'[]'::jsonb`),
  thresholds: jsonb('thresholds').notNull().default(sql`'{}'::jsonb`),
  active: boolean('active').notNull().default(true),
  /** Date du dernier passage en mode automatique (après quatre semaines sans erreur). */
  autoSince: tz('auto_since'),
  updatedAt: updatedAt(),
}, (t) => [check('agents_effort', sql`${t.effort} IN ('low', 'medium', 'high')`)]);

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
  costMicros: integer('cost_micros').notNull().default(0),
  durationMs: integer('duration_ms'),
  status: agentRunStatusEnum('status').notNull().default('running'),
  error: text('error'),
  startedAt: createdAt(),
  finishedAt: tz('finished_at'),
}, (t) => [index('agent_runs_agent_idx').on(t.agentCode, t.startedAt), index('agent_runs_status_idx').on(t.status).where(sql`${t.status} IN ('running', 'awaiting_approval')`)]);

export const approvals = pgTable('approvals', {
  id: id(),
  agentRunId: uuid('agent_run_id').notNull().references(() => agentRuns.id),
  proposedAction: varchar('proposed_action', { length: 80 }).notNull(),
  data: jsonb('data').notNull(),
  justification: text('justification'),
  decision: approvalDecisionEnum('decision').notNull().default('pending'),
  decidedByUserId: uuid('decided_by_user_id'),
  decidedAt: tz('decided_at'),
  createdAt: createdAt(),
}, (t) => [index('approvals_pending_idx').on(t.createdAt).where(sql`${t.decision} = 'pending'`)]);

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
