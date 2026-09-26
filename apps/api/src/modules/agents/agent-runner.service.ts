/**
 * Exécuteur des agents IA (section 5.16, prompt 13 tâche 4). Une exécution = une ligne `agent_runs` : déclencheur et
 * entrées minimisées, sorties, outils appelés, jetons (cache compris), coût en micro-dollars selon le barème des réglages
 * et le modèle qui a servi la requête, durée, statut. Modes : `auto`, `approval` (les actions financières ou de
 * suspension deviennent des lignes `approvals`), `manual` (aucun appel au modèle, l'humain prend le relais). Le plafond
 * quotidien de dépense (réglage global, seuil de l'agent) fait passer l'agent en `manual` dès qu'il est atteint.
 * Un déclencheur porteur d'une référence (message, document, relevé, période d'un rapport) ne s'exécute qu'une fois ;
 * une exécution en échec peut être reprise.
 */
import { schema } from '@neomoov/db';
import {
  addUsage, dailyBudgetExceeded, EMPTY_USAGE, llmCostMicros, localClock, priceFor, redactSensitive,
  type AgentEffort, type AgentMode, type AgentRunStatus, type AgentRunView, type AgentToolCall, type LlmPricing, type LlmUsage,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { LLM_PROVIDER, LlmError, type LlmMessage, type LlmProvider, type LlmTool, type LlmToolsResult } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

type RunRow = typeof schema.agentRuns.$inferSelect;

export interface AgentDefinition {
  code: string;
  name: string;
  mode: AgentMode;
  model: string;
  effort: AgentEffort;
  systemPromptKey: string | null;
  tools: string[];
  thresholds: Record<string, unknown>;
  active: boolean;
}

export interface AgentTrigger {
  /** Nature du déclencheur : `conversation.whatsapp`, `document.uploaded`, `statement.issued`, `report.daily`, `tool:refund`… */
  name: string;
  /** Référence d'idempotence (identifiant du message, du document, du relevé, de la période) ; null : toujours exécuté. */
  ref: string | null;
  /** Entrées journalisées, déjà minimisées par l'appelant (identifiants, longueurs, jamais de contenu sensible). */
  input: Record<string, unknown>;
}

export type SkipReason = 'manual_mode' | 'budget_exceeded' | 'inactive';

/** Contexte d'une exécution, passé à l'agent et à ses outils. */
export interface AgentRunContext {
  readonly runId: string;
  readonly agent: AgentDefinition;
  readonly mode: AgentMode;
  /** Client concerné (agent relation client) : les outils ne voient que ses courses et son compte. */
  readonly subjectUserId: string | null;
  readonly conversationId: string | null;
  readonly approvalIds: string[];
  /** Sortie structurée validée par Zod (décision, classification, extraction). */
  structured<T>(schemaName: string, outputSchema: z.ZodType<T>, messages: LlmMessage[]): Promise<T>;
  /** Boucle d'outils (agent qui agit). */
  runTools(tools: LlmTool[], messages: LlmMessage[]): Promise<LlmToolsResult>;
  recordToolCall(call: AgentToolCall): void;
}

export interface AgentExecution<T> {
  run: AgentRunView;
  result: T | null;
  /** Déclencheur déjà traité : l'exécution existante est renvoyée, rien n'est refait. */
  replayed: boolean;
}

export interface ExecuteOptions {
  subjectUserId?: string | null;
  conversationId?: string | null;
  /** Appelé quand l'agent ne s'exécute pas (mode manuel, plafond atteint, agent inactif) : relais humain. */
  onSkip?: (reason: SkipReason, runId: string) => Promise<void>;
}

const SENSITIVE_KEY = /(password|token|secret|otp|^code$|hash|totp|apiKey|^key$|authorization|cookie|card|iban|dataBase64)/i;

/** Copie journalisable : clés sensibles masquées, numéros de carte masqués, chaînes bornées, profondeur bornée. */
export function logSafe(value: unknown, maxString = 20_000, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth > 8) return '[profondeur]';
  if (typeof value === 'string') return redactSensitive(value.length > maxString ? `${value.slice(0, maxString)}…` : value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[${value.length} octets]`;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => logSafe(v, maxString, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[masqué]' : logSafe(v, maxString, depth + 1)]));
  }
  return String(value);
}

function errorMessage(error: unknown): string {
  if (error instanceof LlmError) return `${error.code} : ${error.message}`;
  if (error instanceof AppError) return `${error.code} : ${error.message}`;
  return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}

@Injectable()
export class AgentRunnerService {
  private readonly prompts = new Map<string, string>();

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  async agent(code: string): Promise<AgentDefinition> {
    const [row] = await this.db.select().from(schema.agents).where(eq(schema.agents.code, code)).limit(1);
    if (!row) throw AppError.notFound('AGENT_NOT_FOUND', 'Agent introuvable');
    return {
      code: row.code, name: row.name, mode: row.mode, model: row.model, effort: row.effort as AgentEffort, systemPromptKey: row.systemPromptKey,
      tools: Array.isArray(row.tools) ? (row.tools as string[]) : [], thresholds: (row.thresholds ?? {}) as Record<string, unknown>, active: row.active,
    };
  }

  /** Prompt système de la version en service (table `agent_prompts`, chargée depuis `docs/agents`) ; gardé en mémoire. */
  async systemPrompt(agent: AgentDefinition): Promise<string> {
    if (!agent.systemPromptKey) throw new AppError('AGENT_PROMPT_MISSING', `Aucun prompt système pour l'agent ${agent.code}`, 500);
    const cached = this.prompts.get(agent.systemPromptKey);
    if (cached) return cached;
    const [row] = await this.db.select({ body: schema.agentPrompts.body }).from(schema.agentPrompts).where(eq(schema.agentPrompts.key, agent.systemPromptKey)).limit(1);
    if (!row) throw new AppError('AGENT_PROMPT_MISSING', `Prompt ${agent.systemPromptKey} absent (données de départ à relancer)`, 500);
    this.prompts.set(agent.systemPromptKey, row.body);
    return row.body;
  }

  private async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  /** Dépense LLM du jour (heure de Montréal), de l'agent et de l'ensemble des agents, en micro-dollars. */
  async spentToday(agentCode: string): Promise<{ agentMicros: number; allAgentsMicros: number }> {
    const tz = await this.timeZone();
    const today = localClock(new Date(), tz).date;
    const [row] = await this.db
      .select({
        all: sql<string>`COALESCE(sum(${schema.agentRuns.costMicros}), 0)::bigint`,
        agent: sql<string>`COALESCE(sum(${schema.agentRuns.costMicros}) FILTER (WHERE ${schema.agentRuns.agentCode} = ${agentCode}), 0)::bigint`,
      })
      .from(schema.agentRuns)
      .where(sql`${schema.agentRuns.startedAt} >= (${today}::date::timestamp AT TIME ZONE ${tz})`);
    return { agentMicros: Number(row?.agent ?? 0), allAgentsMicros: Number(row?.all ?? 0) };
  }

  /** Plafonds du jour : global (`agents.daily_budget_micros`) et de l'agent (`thresholds.dailyBudgetMicros`). */
  async caps(agent: AgentDefinition): Promise<{ globalCapMicros: number | null; agentCapMicros: number | null }> {
    const global = await this.settings.get<unknown>('agents.daily_budget_micros', null);
    const own = agent.thresholds['dailyBudgetMicros'];
    return { globalCapMicros: typeof global === 'number' ? global : null, agentCapMicros: typeof own === 'number' ? own : null };
  }

  private async budgetExceeded(agent: AgentDefinition): Promise<boolean> {
    const [spent, caps] = await Promise.all([this.spentToday(agent.code), this.caps(agent)]);
    return dailyBudgetExceeded(spent, caps);
  }

  /** Plafond atteint : l'agent passe en mode manuel (journalisé, personnel prévenu) ; le fondateur le remet en service. */
  private async switchToManual(agent: AgentDefinition): Promise<void> {
    const [row] = await this.db
      .update(schema.agents)
      .set({ mode: 'manual', autoSince: null })
      .where(and(eq(schema.agents.code, agent.code), sql`${schema.agents.mode} <> 'manual'`))
      .returning({ code: schema.agents.code });
    if (!row) return;
    this.logger.warn({ agentCode: agent.code }, 'Plafond quotidien de dépense LLM atteint : agent en mode manuel');
    await this.audit.recordSystem({ action: 'agent.mode_manual_budget', entity: 'agents', before: { code: agent.code, mode: agent.mode }, after: { code: agent.code, mode: 'manual' } }, agent.code);
    await this.outbox.queueForStaff('alert.agent_budget', { agentCode: agent.code });
  }

  /** Réserve l'exécution d'un déclencheur ; un déclencheur déjà traité (ou en cours) est rejoué, un échec est repris. */
  private async claim(agentCode: string, trigger: AgentTrigger): Promise<{ row: RunRow; fresh: boolean }> {
    const values = { agentCode, trigger: trigger.name.slice(0, 60), triggerRef: trigger.ref?.slice(0, 120) ?? null, input: logSafe(trigger.input) as object, status: 'running' as const };
    if (!values.triggerRef) {
      const [row] = await this.db.insert(schema.agentRuns).values(values).returning();
      return { row: row!, fresh: true };
    }
    const [inserted] = await this.db.insert(schema.agentRuns).values(values).onConflictDoNothing().returning();
    if (inserted) return { row: inserted, fresh: true };
    const same = and(eq(schema.agentRuns.agentCode, agentCode), eq(schema.agentRuns.trigger, values.trigger), eq(schema.agentRuns.triggerRef, values.triggerRef));
    const [retried] = await this.db
      .update(schema.agentRuns)
      .set({ status: 'running', error: null, finishedAt: null, input: values.input })
      .where(and(same, eq(schema.agentRuns.status, 'failed')))
      .returning();
    if (retried) return { row: retried, fresh: true };
    const [existing] = await this.db.select().from(schema.agentRuns).where(same).limit(1);
    return { row: existing!, fresh: false };
  }

  private async finish(runId: string, patch: { status: AgentRunStatus; output?: unknown; error?: string | null; toolCalls?: AgentToolCall[]; usage?: LlmUsage; model?: string | null; costMicros?: number; durationMs: number }): Promise<RunRow> {
    const usage = patch.usage ?? EMPTY_USAGE;
    const [row] = await this.db
      .update(schema.agentRuns)
      .set({
        status: patch.status, output: patch.output === undefined ? null : (logSafe(patch.output) as object), error: patch.error ?? null, toolCalls: (patch.toolCalls ?? []) as object,
        inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadInputTokens, cacheWriteTokens: usage.cacheCreationInputTokens,
        model: patch.model ?? null, costMicros: patch.costMicros ?? 0, durationMs: patch.durationMs, finishedAt: new Date(),
      })
      .where(eq(schema.agentRuns.id, runId))
      .returning();
    return row!;
  }

  /**
   * Exécute un agent pour un déclencheur. `body` reçoit le contexte (appels au modèle comptés, outils journalisés) et
   * renvoie la sortie, gardée dans le journal. Une erreur (modèle, outil, donnée) termine l'exécution en `failed` sans
   * être relancée : l'appelant consulte le statut et organise le relais humain.
   */
  async execute<T>(code: string, trigger: AgentTrigger, body: (ctx: AgentRunContext) => Promise<T>, options: ExecuteOptions = {}): Promise<AgentExecution<T>> {
    const agent = await this.agent(code);
    const startedAt = Date.now();
    const claimed = await this.claim(agent.code, trigger);
    if (!claimed.fresh) return { run: AgentRunnerService.view(claimed.row), result: null, replayed: true };
    const runId = claimed.row.id;

    let skip: SkipReason | null = !agent.active ? 'inactive' : agent.mode === 'manual' ? 'manual_mode' : null;
    if (!skip && (await this.budgetExceeded(agent))) {
      await this.switchToManual(agent);
      skip = 'budget_exceeded';
    }
    if (skip) {
      try {
        await options.onSkip?.(skip, runId);
      } catch (error) {
        this.logger.error({ err: error, agentCode: agent.code, runId }, 'Relais humain d\'un agent en mode manuel impossible');
      }
      const row = await this.finish(runId, { status: 'skipped', output: { skipped: skip }, durationMs: Date.now() - startedAt });
      return { run: AgentRunnerService.view(row), result: null, replayed: false };
    }

    const [maxTokens, maxIterations, pricing] = await Promise.all([
      this.settings.number('agents.max_output_tokens', 16_000),
      this.settings.number('agents.max_tool_iterations', 8),
      this.settings.get<LlmPricing>('agents.llm_pricing', {}),
    ]);
    const state = { usage: EMPTY_USAGE, model: null as string | null };
    const toolCalls: AgentToolCall[] = [];
    const approvalIds: string[] = [];
    const ctx: AgentRunContext = {
      runId, agent, mode: agent.mode, subjectUserId: options.subjectUserId ?? null, conversationId: options.conversationId ?? null, approvalIds,
      structured: async <R>(schemaName: string, outputSchema: z.ZodType<R>, messages: LlmMessage[]) => {
        const system = await this.systemPrompt(agent);
        const result = await this.llm.structured({ model: agent.model, effort: agent.effort, system, messages, maxTokens, schemaName, schema: outputSchema });
        state.usage = addUsage(state.usage, result.usage);
        state.model = result.model;
        return result.output;
      },
      runTools: async (tools: LlmTool[], messages: LlmMessage[]) => {
        const system = await this.systemPrompt(agent);
        const result = await this.llm.runTools({ model: agent.model, effort: agent.effort, system, messages, maxTokens, tools, maxIterations });
        state.usage = addUsage(state.usage, result.usage);
        state.model = result.model;
        return result;
      },
      recordToolCall: (call) => {
        toolCalls.push(call);
      },
    };
    const cost = () => llmCostMicros(state.usage, priceFor(pricing, state.model ?? agent.model));
    let row: RunRow;
    let result: T | null = null;
    try {
      result = await body(ctx);
      row = await this.finish(runId, { status: approvalIds.length ? 'awaiting_approval' : 'succeeded', output: result, toolCalls, usage: state.usage, model: state.model, costMicros: cost(), durationMs: Date.now() - startedAt });
    } catch (error) {
      this.logger.warn({ err: error, agentCode: agent.code, runId }, 'Exécution d\'agent en échec');
      row = await this.finish(runId, { status: 'failed', error: errorMessage(error), toolCalls, usage: state.usage, model: state.model, costMicros: cost(), durationMs: Date.now() - startedAt });
    }
    if (await this.budgetExceeded(agent)) await this.switchToManual(agent);
    return { run: AgentRunnerService.view(row), result, replayed: false };
  }

  /** Une approbation décidée : l'exécution qui l'a proposée est terminée quand plus aucune n'attend. */
  async settleRun(runId: string): Promise<void> {
    await this.db.execute(sql`UPDATE agent_runs SET status = 'succeeded' WHERE id = ${runId} AND status = 'awaiting_approval'
      AND NOT EXISTS (SELECT 1 FROM approvals WHERE agent_run_id = ${runId} AND decision = 'pending')`);
  }

  async run(id: string): Promise<AgentRunView> {
    const [row] = await this.db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, id)).limit(1);
    if (!row) throw AppError.notFound('AGENT_RUN_NOT_FOUND', 'Exécution introuvable');
    return AgentRunnerService.view(row);
  }

  static view(row: RunRow): AgentRunView {
    return {
      id: row.id, agentCode: row.agentCode, trigger: row.trigger, triggerRef: row.triggerRef, status: row.status, model: row.model, input: row.input ?? null, output: row.output ?? null,
      toolCalls: Array.isArray(row.toolCalls) ? (row.toolCalls as AgentToolCall[]) : [], inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens,
      cacheWriteTokens: row.cacheWriteTokens, costMicros: row.costMicros, durationMs: row.durationMs, error: row.error, startedAt: row.startedAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }
}
