/**
 * Schémas des agents IA (section 5.16, prompt 13) : réglage d'un agent dans My Hub, journal des exécutions, rapports,
 * exécution à la demande (`/internal/agents/{code}/run`) et entrées des outils internes (`/internal/tools/*`). Les
 * entrées des outils sont celles que voit le modèle ; le contexte (agent, exécution, client concerné) est ajouté par
 * l'exécuteur ou, sur les routes internes, par le compte de service.
 */
import { z } from 'zod';
import { AGENT_EFFORTS, STATEMENT_ANOMALY_KINDS } from '../agents/agents.js';
import { AGENT_MODES, AGENT_RUN_STATUSES, CONVERSATION_CHANNELS, INCIDENT_SEVERITIES, LANGUAGES } from '../enums.js';
import { adminListQuerySchema } from './admin.js';
import { cents, isoDate, localDateString, phoneE164, uuid } from './common.js';

const count = z.number().int().min(0);
const thresholdKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);
const thresholdValue = z.union([z.number().int().min(0).max(10_000_000_000), z.boolean(), z.string().trim().max(60)]);

/** Réglage d'un agent (My Hub) : mode, effort, modèle, activité, seuils (fusionnés avec les seuils existants). */
export const agentUpdateSchema = z.object({
  mode: z.enum(AGENT_MODES).optional(),
  effort: z.enum(AGENT_EFFORTS).optional(),
  model: z.string().regex(/^claude-[a-z0-9-]{2,50}$/, 'Identifiant de modèle Claude attendu').optional(),
  active: z.boolean().optional(),
  thresholds: z.record(thresholdKey, thresholdValue.nullable()).optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Au moins un champ à modifier' });
export type AgentUpdate = z.infer<typeof agentUpdateSchema>;

/** Appel d'outil tel que journalisé dans `agent_runs.tool_calls` (entrées minimisées, résultat résumé). */
export const agentToolCallSchema = z.object({
  tool: z.string(),
  input: z.unknown(),
  ok: z.boolean(),
  result: z.unknown(),
  approvalId: uuid.nullable(),
  durationMs: count,
});
export type AgentToolCall = z.infer<typeof agentToolCallSchema>;

export const agentRunSchema = z.object({
  id: uuid,
  agentCode: z.string(),
  trigger: z.string(),
  triggerRef: z.string().nullable(),
  status: z.enum(AGENT_RUN_STATUSES),
  model: z.string().nullable(),
  input: z.unknown(),
  output: z.unknown(),
  toolCalls: z.array(agentToolCallSchema),
  inputTokens: count,
  outputTokens: count,
  cacheReadTokens: count,
  cacheWriteTokens: count,
  costMicros: count,
  durationMs: count.nullable(),
  error: z.string().nullable(),
  startedAt: isoDate,
  finishedAt: isoDate.nullable(),
});
export type AgentRunView = z.infer<typeof agentRunSchema>;

export const agentRunListQuerySchema = adminListQuerySchema.extend({ agentCode: z.string().regex(/^[a-z0-9_]{2,40}$/).optional() });
export type AgentRunListQuery = z.infer<typeof agentRunListQuerySchema>;

/** Rapport de l'agent d'analyse (quotidien ou hebdomadaire), visible dans My Hub. */
export const agentReportSchema = z.object({
  runId: uuid,
  kind: z.enum(['daily', 'weekly']),
  from: localDateString,
  to: localDateString,
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  sentTo: z.number().int().min(0),
  createdAt: isoDate,
});
export type AgentReportView = z.infer<typeof agentReportSchema>;

// Exécution à la demande -----------------------------------------------------------------------------------------------

export const customerRelationsRunSchema = z.object({
  channel: z.enum(CONVERSATION_CHANNELS),
  text: z.string().trim().min(1).max(4000),
  userId: uuid.optional(),
  phone: phoneE164.optional(),
  rideId: uuid.optional(),
  language: z.enum(LANGUAGES).optional(),
  externalId: z.string().trim().min(1).max(120).optional(),
}).refine((v) => v.userId || v.phone, { message: 'Un compte (userId) ou un téléphone est requis', path: ['userId'] });
export const recruitmentRunSchema = z.object({ documentId: uuid });
export const accountingRunSchema = z.object({ statementId: uuid });
export const analyticsRunSchema = z.object({
  kind: z.enum(['daily', 'weekly']).default('daily'),
  from: localDateString.optional(),
  to: localDateString.optional(),
  /** Envoi du rapport par courriel au fondateur (vrai par défaut). */
  send: z.boolean().default(true),
});

/** Exécution à la demande : entrée propre à chaque agent (validée par son schéma). */
export const agentRunRequestSchema = z.object({ input: z.record(z.string(), z.unknown()) });
export type AgentRunRequest = z.infer<typeof agentRunRequestSchema>;

// Outils internes : entrées vues par le modèle ---------------------------------------------------------------------------

const reason = z.string().trim().min(3).max(300);
const justification = z.string().trim().min(3).max(1000).describe('Justification de l\'action, affichée dans la file d\'approbation');

export const lookupRideToolSchema = z.object({
  rideId: uuid.optional().describe('Identifiant de la course'),
  publicNumber: z.string().trim().max(40).optional().describe('Numéro public de la course, par exemple NM-2026-09-25-0001'),
  limit: z.number().int().min(1).max(10).optional().describe('Sans identifiant : nombre de courses récentes du client (5 par défaut)'),
});
export const lookupClientToolSchema = z.object({ userId: uuid.optional().describe('Compte du client (par défaut : le client de la conversation)') });
export const lookupDriverToolSchema = z.object({ driverId: uuid.optional(), publicNumber: z.string().trim().max(40).optional() });
export const issueCreditToolSchema = z.object({
  amountCents: z.number().int().min(1).describe('Montant du crédit en cents (5 000 au plus)'),
  reason,
  rideId: uuid.optional().describe('Course concernée, s\'il y en a une'),
  justification,
});
export const refundToolSchema = z.object({
  rideId: uuid.describe('Course à rembourser (obtenue par lookupRide)'),
  amountCents: z.number().int().min(1).describe('Montant en cents (5 000 au plus)'),
  reason,
  mode: z.enum(['refund', 'credit']).default('refund').describe('Remboursement sur la carte, ou crédit sur le compte (au choix du client)'),
  justification,
});
export const openIncidentToolSchema = z.object({
  rideId: uuid.optional(),
  type: z.enum(['complaint', 'accident', 'lost_item', 'no_show_dispute', 'model_guarantee', 'other']),
  severity: z.enum(INCIDENT_SEVERITIES).default('medium'),
  description: z.string().trim().min(3).max(2000),
});
export const ESCALATION_REASONS = ['safety', 'hostile', 'over_limit', 'out_of_scope', 'client_request', 'other'] as const;
export const escalateToHumanToolSchema = z.object({ reason: z.enum(ESCALATION_REASONS), summary: z.string().trim().min(3).max(1000) });
export const sendMessageToolSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const extractDocumentFieldsToolSchema = z.object({ documentId: uuid });
export const compareIdentityToolSchema = z.object({ documentId: uuid });
export const proposeDecisionToolSchema = z.object({ documentId: uuid, decision: z.enum(['approve', 'reject']), reason, justification });
export const listStatementLinesToolSchema = z.object({ statementId: uuid });
export const flagAnomalyToolSchema = z.object({
  statementId: uuid,
  kind: z.enum(STATEMENT_ANOMALY_KINDS),
  lineIds: z.array(uuid).max(20).default([]),
  amountCents: cents,
  explanation: z.string().trim().min(3).max(1000),
  severity: z.enum(INCIDENT_SEVERITIES).default('medium'),
});
export const queryMetricsToolSchema = z.object({ from: localDateString, to: localDateString });

/** Contexte ajouté aux entrées sur les routes internes : client concerné, agent (personnel ou rôle `agent` ; une clé porte le sien). */
export const toolRouteContextSchema = z.object({
  subjectUserId: uuid.optional(),
  agentCode: z.string().regex(/^[a-z0-9_]{2,40}$/).optional(),
});
export const sendMessageRouteSchema = sendMessageToolSchema.extend({ conversationId: uuid });
export const agentRunResultSchema = z.object({ run: agentRunSchema.nullable(), replayed: z.boolean(), conversationId: uuid.nullable() });

/** Résultat d'un outil exposé sur les routes internes. */
export const toolResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['done', 'pending_approval', 'refused', 'not_found']),
  approvalId: uuid.nullable(),
  data: z.unknown(),
  message: z.string(),
});
export type ToolResultView = z.infer<typeof toolResultSchema>;

/** Message du client à l'assistance, depuis l'application ou la réservation web (`POST /me/support/messages`). */
export const supportMessageSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  rideId: uuid.optional(),
  channel: z.enum(['app', 'web']).default('app'),
});
export type SupportMessageInput = z.input<typeof supportMessageSchema>;
export const supportMessageAcceptedSchema = z.object({ accepted: z.literal(true), externalId: z.string() });

/** Conversation de l'assistance, vue par My Hub et par le client (ses propres messages). */
export const conversationMessageSchema = z.object({ id: uuid, direction: z.enum(['inbound', 'outbound']), author: z.string(), body: z.string(), createdAt: isoDate });
export const conversationSchema = z.object({
  id: uuid,
  channel: z.enum(CONVERSATION_CHANNELS),
  status: z.string(),
  language: z.string(),
  userId: uuid.nullable(),
  escalationReason: z.string().nullable(),
  messages: z.array(conversationMessageSchema),
  createdAt: isoDate,
});
export type ConversationView = z.infer<typeof conversationSchema>;
