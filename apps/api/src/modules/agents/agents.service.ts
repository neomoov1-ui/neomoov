/**
 * Façade des routes internes (section 7.2, groupe « Agents (interne) ») : exécution d'un agent à la demande et appel
 * d'un outil par un compte de service (clé à portée `tools:*`, rattachée à un agent) ou par le personnel au nom d'un
 * agent. Chaque appel d'outil est une exécution journalisée de l'agent, dans son mode et ses plafonds.
 */
import { randomUUID } from 'node:crypto';
import {
  accountingRunSchema, analyticsRunSchema, customerRelationsRunSchema, recruitmentRunSchema, reportPeriod, type AgentRunView, type ToolResultView,
} from '@neomoov/domain';
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import type { Actor } from '../auth/actor.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { AgentToolsService, type ToolName } from './agent-tools.service.js';
import { AccountingAgent, ACCOUNTING, AnalyticsAgent, ANALYTICS, RecruitmentAgent, RECRUITMENT } from './back-office.agents.js';
import { CUSTOMER_RELATIONS, CustomerRelationsAgent } from './customer-relations.agent.js';

export interface RunOnDemandResult {
  run: AgentRunView | null;
  replayed: boolean;
  conversationId: string | null;
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Entrée de l\'agent invalide', 400, { issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), message: i.message })) });
  return parsed.data;
}

@Injectable()
export class AgentsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly customerRelations: CustomerRelationsAgent,
    private readonly recruitment: RecruitmentAgent,
    private readonly accounting: AccountingAgent,
    private readonly analytics: AnalyticsAgent,
  ) {}

  /** `POST /internal/agents/{code}/run` : même traitement que le déclencheur de l'agent. */
  async runOnDemand(code: string, input: Record<string, unknown>): Promise<RunOnDemandResult> {
    switch (code) {
      case CUSTOMER_RELATIONS: {
        const i = parse(customerRelationsRunSchema, input);
        const out = await this.customerRelations.handleInbound({ channel: i.channel, externalId: i.externalId ?? `manual-${randomUUID()}`, userId: i.userId ?? null, phone: i.phone ?? null, text: i.text, language: i.language ?? null, rideId: i.rideId ?? null });
        if (!out) throw new AppError('VALIDATION_ERROR', 'Message sans compte ni téléphone', 400);
        return { run: out.run, replayed: out.duplicate, conversationId: out.conversationId };
      }
      case RECRUITMENT: {
        const execution = await this.recruitment.handleDocument(parse(recruitmentRunSchema, input).documentId);
        return { run: execution.run, replayed: execution.replayed, conversationId: null };
      }
      case ACCOUNTING: {
        const execution = await this.accounting.handleStatement(parse(accountingRunSchema, input).statementId);
        return { run: execution.run, replayed: execution.replayed, conversationId: null };
      }
      case ANALYTICS: {
        const i = parse(analyticsRunSchema, input);
        const tz = await this.settings.string('service.time_zone', 'America/Toronto');
        const base = reportPeriod(i.kind, new Date(), tz);
        const period = i.from && i.to ? { ...base, from: i.from, to: i.to } : base;
        if (period.from > period.to) throw new AppError('VALIDATION_ERROR', 'Période invalide (début après la fin)', 400);
        const execution = await this.analytics.runReport(period, { send: i.send, scheduled: false });
        return { run: execution.run, replayed: execution.replayed, conversationId: null };
      }
      default:
        throw AppError.notFound('AGENT_NOT_RUNNABLE', 'Agent inconnu ou sans exécution à la demande (l\'agent vocal passe par les webhooks Vapi)');
    }
  }

  /**
   * `POST /internal/tools/{outil}` : l'agent est celui de la clé de service, ou `agentCode` pour le personnel et le
   * rôle `agent`. L'appel est une exécution de cet agent (journal, mode, plafonds) ; le client concerné borne les outils.
   */
  async callTool(name: ToolName, body: Record<string, unknown>, actor: Actor): Promise<ToolResultView> {
    const { subjectUserId, agentCode: requested, conversationId, ...input } = body as Record<string, unknown> & { subjectUserId?: string; agentCode?: string; conversationId?: string };
    if (actor.kind === 'service' && requested && requested !== actor.agentCode) throw AppError.forbidden('AGENT_MISMATCH', 'Cette clé agit pour un autre agent');
    const agentCode = actor.kind === 'service' ? actor.agentCode : requested;
    if (!agentCode) throw AppError.forbidden('AGENT_CODE_REQUIRED', 'Aucun agent : la clé doit être rattachée à un agent, ou la requête préciser agentCode');
    const caller = actor.kind === 'service' ? `key:${actor.name}` : `user:${actor.userId}`;
    const execution = await this.runner.execute(
      agentCode,
      { name: `tool:${name}`, ref: null, input: { tool: name, caller, subjectUserId: subjectUserId ?? null } },
      (ctx) => this.tools.call(ctx, name, input),
      { subjectUserId: subjectUserId ?? null, conversationId: conversationId ?? null },
    );
    if (execution.run.status === 'skipped') throw AppError.conflict('AGENT_NOT_RUNNING', `Agent ${agentCode} en mode manuel, inactif ou au plafond de dépense`);
    if (!execution.result) throw new AppError('TOOL_FAILED', 'L\'outil a échoué', 502, { runId: execution.run.id });
    return execution.result;
  }
}
