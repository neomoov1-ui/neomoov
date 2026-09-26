/**
 * File d'approbation des agents (prompt 13, tâche 4 ; parcours 19 de la section 9.2) et réglage des agents dans My Hub.
 * Approuver exécute l'action proposée une seule fois : la décision est prise par une mise à jour conditionnelle (une
 * approbation déjà décidée répond 409), l'action porte une clé d'idempotence (`approval-<id>`) ; une exécution en échec
 * garde son erreur et peut être relancée par une nouvelle approbation, sans double effet. Refuser exige un motif.
 */
import { schema } from '@neomoov/db';
import { effectiveDailyCap, type AdminAgent, type AdminApproval, type AdminListQuery, type AgentReportView, type AgentRunListQuery, type AgentRunView, type AgentUpdate, type Page } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { AgentToolsService, type ApprovalAction } from './agent-tools.service.js';
import { AnalyticsAgent, ANALYTICS, RECRUITMENT } from './back-office.agents.js';
import { ConversationsService } from './conversations.service.js';

type ApprovalRow = typeof schema.approvals.$inferSelect;

const ACTIONS: readonly string[] = ['refund', 'issueCredit', 'proposeDecision', 'flagAnomaly'];
/** Modes interdits par agent en V1 : le recrutement n'est jamais automatique (validation humaine obligatoire). */
const LOCKED_MODES: Record<string, readonly string[]> = { [RECRUITMENT]: ['auto'] };

@Injectable()
export class AgentApprovalsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly audit: AuditService,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly conversations: ConversationsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  static view(a: ApprovalRow, agentCode: string | null): AdminApproval {
    return {
      id: a.id, agentCode, proposedAction: a.proposedAction, data: a.data, justification: a.justification, decision: a.decision, decidedAt: a.decidedAt?.toISOString() ?? null,
      decisionNote: a.decisionNote, executedAt: a.executedAt?.toISOString() ?? null, executionResult: a.executionResult ?? null, executionError: a.executionError, createdAt: a.createdAt.toISOString(),
    };
  }

  async list(query: AdminListQuery): Promise<Page<AdminApproval>> {
    const decision = (['pending', 'approved', 'rejected'].includes(query.status ?? '') ? query.status : 'pending') as AdminApproval['decision'];
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ approval: schema.approvals, agentCode: schema.agentRuns.agentCode })
        .from(schema.approvals)
        .leftJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.approvals.agentRunId))
        .where(eq(schema.approvals.decision, decision))
        .orderBy(desc(schema.approvals.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.approvals).where(eq(schema.approvals.decision, decision)),
    ]);
    return { items: rows.map(({ approval, agentCode }) => AgentApprovalsService.view(approval, agentCode)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async decide(id: string, input: { decision: 'approved' | 'rejected'; note?: string | undefined }, actor: UserActor): Promise<AdminApproval> {
    const note = input.note?.trim() || null;
    if (input.decision === 'rejected' && (!note || note.length < 3)) throw new AppError('REJECTION_REASON_REQUIRED', 'Un motif est requis pour refuser', 400);
    let [row] = await this.db
      .update(schema.approvals)
      .set({ decision: input.decision, decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: note })
      .where(and(eq(schema.approvals.id, id), eq(schema.approvals.decision, 'pending')))
      .returning();
    if (!row && input.decision === 'approved') {
      // Nouvelle tentative d'une exécution en échec (clé d'idempotence inchangée : aucun double effet).
      [row] = await this.db
        .update(schema.approvals)
        .set({ executionError: null, decidedByUserId: actor.userId, decidedAt: new Date() })
        .where(and(eq(schema.approvals.id, id), eq(schema.approvals.decision, 'approved'), isNull(schema.approvals.executedAt), isNotNull(schema.approvals.executionError)))
        .returning();
    }
    if (!row) {
      const [existing] = await this.db.select({ id: schema.approvals.id }).from(schema.approvals).where(eq(schema.approvals.id, id)).limit(1);
      if (!existing) throw AppError.notFound('APPROVAL_NOT_FOUND', 'Approbation introuvable');
      throw AppError.conflict('APPROVAL_ALREADY_DECIDED', 'Cette action a déjà été décidée');
    }
    const [run] = await this.db.select({ agentCode: schema.agentRuns.agentCode }).from(schema.agentRuns).where(eq(schema.agentRuns.id, row.agentRunId)).limit(1);
    const agentCode = run?.agentCode ?? 'unknown';
    this.audit.record({ action: `admin.approval_${input.decision}`, entity: 'approvals', entityId: id, after: { decision: input.decision, note, proposedAction: row.proposedAction } });

    if (input.decision === 'approved') {
      if (!ACTIONS.includes(row.proposedAction)) {
        [row] = await this.db.update(schema.approvals).set({ executionError: `Action inconnue : ${row.proposedAction}` }).where(eq(schema.approvals.id, id)).returning();
      } else {
        try {
          const result = await this.tools.executeAction(row.proposedAction as ApprovalAction, (row.data ?? {}) as Record<string, unknown>, { approvalId: id, approverUserId: actor.userId, agentCode, idempotencyKey: `approval-${id}` });
          [row] = await this.db.update(schema.approvals).set({ executedAt: new Date(), executionResult: result, executionError: null }).where(eq(schema.approvals.id, id)).returning();
        } catch (error) {
          const message = error instanceof AppError ? `${error.code} : ${error.message}` : error instanceof Error ? error.message : String(error);
          this.logger.warn({ err: error, approvalId: id }, 'Action approuvée non exécutée');
          [row] = await this.db.update(schema.approvals).set({ executionError: message.slice(0, 500) }).where(eq(schema.approvals.id, id)).returning();
        }
      }
    } else {
      // Refus d'une action proposée au client : un humain reprend la conversation.
      const conversationId = (row.data as Record<string, unknown> | null)?.['conversationId'];
      if (typeof conversationId === 'string') await this.conversations.escalate(conversationId, 'approval_rejected', note ?? '').catch((error: unknown) => this.logger.warn({ err: error }, 'Conversation non escaladée'));
    }
    await this.runner.settleRun(row!.agentRunId);
    return AgentApprovalsService.view(row!, agentCode);
  }

  // Agents ----------------------------------------------------------------------------------------------------------

  async agents(): Promise<AdminAgent[]> {
    const since = new Date(Date.now() - 7 * 86_400_000);
    const [agents, runs, pending] = await Promise.all([
      this.db.select().from(schema.agents).orderBy(schema.agents.code),
      this.db.select({ code: schema.agentRuns.agentCode, n: count() }).from(schema.agentRuns).where(gte(schema.agentRuns.startedAt, since)).groupBy(schema.agentRuns.agentCode),
      this.db.select({ code: schema.agentRuns.agentCode, n: count() }).from(schema.approvals).innerJoin(schema.agentRuns, eq(schema.agentRuns.id, schema.approvals.agentRunId)).where(eq(schema.approvals.decision, 'pending')).groupBy(schema.agentRuns.agentCode),
    ]);
    return Promise.all(agents.map(async (a) => {
      const definition = await this.runner.agent(a.code);
      const [spent, caps] = await Promise.all([this.runner.spentToday(a.code), this.runner.caps(definition)]);
      return {
        code: a.code, name: a.name, mode: a.mode, model: a.model, effort: a.effort, runs7d: runs.find((r) => r.code === a.code)?.n ?? 0, pendingApprovals: pending.find((p) => p.code === a.code)?.n ?? 0,
        active: a.active, thresholds: definition.thresholds, systemPromptKey: a.systemPromptKey, modeLocked: Boolean(LOCKED_MODES[a.code]),
        spentTodayMicros: spent.agentMicros, dailyCapMicros: effectiveDailyCap(caps.globalCapMicros, caps.agentCapMicros),
      };
    }));
  }

  /** Mode, effort, modèle, activité et seuils d'un agent ; un seuil à null est retiré. Passage en `auto` daté. */
  async update(code: string, input: AgentUpdate): Promise<AdminAgent> {
    const agent = await this.runner.agent(code);
    if (input.mode && LOCKED_MODES[code]?.includes(input.mode)) throw AppError.conflict('AGENT_MODE_LOCKED', 'Validation humaine obligatoire en V1 : cet agent ne peut pas passer en mode automatique');
    const thresholds = { ...agent.thresholds };
    for (const [key, value] of Object.entries(input.thresholds ?? {})) {
      if (value === null) delete thresholds[key];
      else thresholds[key] = value;
    }
    const modePatch = !input.mode ? {} : input.mode !== 'auto' ? { mode: input.mode, autoSince: null } : agent.mode === 'auto' ? { mode: input.mode } : { mode: input.mode, autoSince: new Date() };
    await this.db
      .update(schema.agents)
      .set({
        ...modePatch,
        ...(input.effort ? { effort: input.effort } : {}), ...(input.model ? { model: input.model } : {}), ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.thresholds ? { thresholds } : {}),
      })
      .where(eq(schema.agents.code, code));
    this.audit.record({ action: 'admin.agent_updated', entity: 'agents', before: { code, mode: agent.mode, effort: agent.effort, model: agent.model, active: agent.active, thresholds: agent.thresholds }, after: { code, ...input } });
    const list = await this.agents();
    return list.find((a) => a.code === code)!;
  }

  async runs(query: AgentRunListQuery): Promise<Page<AgentRunView>> {
    const conditions: SQL[] = [];
    if (query.agentCode) conditions.push(eq(schema.agentRuns.agentCode, query.agentCode));
    if (query.status) conditions.push(sql`${schema.agentRuns.status}::text = ${query.status}`);
    const where = conditions.length ? and(...conditions) : undefined;
    const [rows, [total]] = await Promise.all([
      this.db.select().from(schema.agentRuns).where(where).orderBy(desc(schema.agentRuns.startedAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
      this.db.select({ n: count() }).from(schema.agentRuns).where(where),
    ]);
    return { items: rows.map((r) => AgentRunnerService.view(r)), total: total?.n ?? 0, page: query.page, pageSize: query.pageSize };
  }

  async reports(query: AdminListQuery): Promise<Page<AgentReportView>> {
    const page = await this.runs({ ...query, status: 'succeeded', agentCode: ANALYTICS });
    return { ...page, items: page.items.map((run) => AnalyticsAgent.reportView(run)) };
  }
}
