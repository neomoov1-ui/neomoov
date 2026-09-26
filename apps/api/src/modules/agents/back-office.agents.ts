/**
 * Agents de l'arrière-guichet (prompt 13, tâches 7 à 9 ; section 5.16), écrits en enchaînements fixes plutôt qu'en
 * boucle d'outils : chaque étape appelle un outil interne (journalisé) ou demande au modèle une sortie structurée.
 * - Recrutement : sur un document téléversé, extraction des champs (vision), comparaison avec le profil, proposition
 *   `approve` ou `reject` avec motif ; la décision finale est toujours humaine en V1.
 * - Comptabilité : sur un relevé émis, contrôles déterministes des lignes, explication par le modèle, chaque anomalie
 *   signalée (`flagAnomaly`) pour validation.
 * - Analyse : rapport quotidien (07 h) et hebdomadaire (lundi), en français, envoyé au fondateur et visible dans My Hub ;
 *   lecture seule.
 */
import { schema } from '@neomoov/db';
import {
  asUntrustedData, checkStatement, shiftLocalDate, STATEMENT_ANOMALY_KINDS, type AgentRunView, type ReportPeriod, type StatementCheckLine, type StatementCheckRide,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { AgentRunnerService, type AgentExecution } from './agent-runner.service.js';
import { AgentToolsService } from './agent-tools.service.js';

export const RECRUITMENT = 'driver_recruitment';
export const ACCOUNTING = 'accounting';
export const ANALYTICS = 'analytics';

export const documentDecisionSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().describe('Motif court'),
  justification: z.string().describe('Justification factuelle pour la personne qui valide'),
});

export const statementReviewSchema = z.object({
  explanations: z.array(z.object({ index: z.number().int(), explanation: z.string() })).describe('Une explication par anomalie automatique, repérée par son numéro'),
  additional: z.array(z.object({ kind: z.enum(STATEMENT_ANOMALY_KINDS), lineIds: z.array(z.string()), amountCents: z.number().int(), explanation: z.string() })).describe('Anomalies supplémentaires appuyées sur des lignes précises'),
  summary: z.string(),
});

export const reportSchema = z.object({
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()),
  concerns: z.array(z.string()),
  body: z.string(),
});
export type AgentReport = z.infer<typeof reportSchema>;

const orText = (value: string, fallback: string, max: number) => (value.trim() || fallback).slice(0, max);

@Injectable()
export class RecruitmentAgent {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
  ) {}

  async handleDocument(documentId: string): Promise<AgentExecution<unknown>> {
    return this.runner.execute(RECRUITMENT, { name: 'document.uploaded', ref: documentId, input: { documentId } }, async (ctx) => {
      const extracted = await this.tools.call(ctx, 'extractDocumentFields', { documentId });
      if (!extracted.ok) throw new AppError('DOCUMENT_UNREADABLE', extracted.message, 422);
      const comparison = await this.tools.call(ctx, 'compareIdentity', { documentId });
      const proposal = await ctx.structured('document_decision', documentDecisionSchema, [{
        role: 'user',
        content: [
          'Tâche : proposer une décision sur ce document (la validation finale est humaine).',
          'Champs lus sur le document :', asUntrustedData('document', JSON.stringify(extracted.data)),
          'Comparaison avec le profil et la déclaration du chauffeur :', JSON.stringify(comparison.data),
        ].join('\n'),
      }]);
      const submitted = await this.tools.call(ctx, 'proposeDecision', {
        documentId, decision: proposal.decision,
        reason: orText(proposal.reason, 'Vérification humaine requise', 300), justification: orText(proposal.justification, 'Voir les champs extraits et la comparaison', 1_000),
      });
      return { extracted: extracted.data, comparison: comparison.data, proposal: { decision: proposal.decision, reason: proposal.reason.slice(0, 300) }, approvalId: submitted.approvalId, status: submitted.status };
    });
  }
}

@Injectable()
export class AccountingAgent {
  constructor(
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly settings: SettingsService,
  ) {}

  async handleStatement(statementId: string): Promise<AgentExecution<unknown>> {
    return this.runner.execute(ACCOUNTING, { name: 'statement.issued', ref: statementId, input: { statementId } }, async (ctx) => {
      const listed = await this.tools.call(ctx, 'listStatementLines', { statementId });
      if (!listed.ok) throw new AppError('STATEMENT_UNAVAILABLE', listed.message, 422);
      const data = listed.data as { statement: { creditsCents: number; debitsCents: number; netCents: number }; lines: StatementCheckLine[]; rides: StatementCheckRide[] };
      const anomalies = checkStatement({ ...data.statement, lines: data.lines, rides: data.rides, maxLineCents: await this.settings.number('agents.accounting_max_line_cents', 50_000) });
      const review = await ctx.structured('statement_review', statementReviewSchema, [{
        role: 'user',
        content: [
          'Tâche : expliquer les anomalies de ce relevé ; en signaler d\'autres seulement si des lignes précises les appuient.',
          asUntrustedData('releve', JSON.stringify(listed.data)),
          `Anomalies trouvées par les contrôles automatiques : ${JSON.stringify(anomalies.map((a, index) => ({ index, ...a })))}`,
        ].join('\n'),
      }]);
      const flagged: Array<{ kind: string; approvalId: string | null }> = [];
      for (const [index, anomaly] of anomalies.entries()) {
        const explanation = orText(review.explanations.find((e) => e.index === index)?.explanation ?? '', anomaly.detail, 1_000);
        const r = await this.tools.call(ctx, 'flagAnomaly', { statementId, kind: anomaly.kind, lineIds: anomaly.lineIds, amountCents: anomaly.amountCents, explanation, severity: anomaly.kind === 'totals_mismatch' ? 'high' : 'medium' });
        flagged.push({ kind: anomaly.kind, approvalId: r.approvalId });
      }
      const known = new Set(data.lines.map((l) => l.id));
      for (const extra of review.additional.slice(0, 10)) {
        // Une anomalie proposée par le modèle doit s'appuyer sur des lignes de ce relevé.
        if (!extra.lineIds.length || !extra.lineIds.every((id) => known.has(id))) continue;
        const r = await this.tools.call(ctx, 'flagAnomaly', { statementId, kind: extra.kind, lineIds: extra.lineIds.slice(0, 20), amountCents: Math.max(0, extra.amountCents), explanation: orText(extra.explanation, 'Écart signalé par l\'agent', 1_000), severity: 'low' });
        flagged.push({ kind: extra.kind, approvalId: r.approvalId });
      }
      return { anomalies: flagged, automaticChecks: anomalies.length, summary: review.summary.slice(0, 2_000) };
    });
  }
}

@Injectable()
export class AnalyticsAgent {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  /**
   * Rapport d'une période : indicateurs (et ceux de la période précédente, pour comparer), rédaction par le modèle,
   * envoi par courriel. La référence de la période rend la planification idempotente ; une demande manuelle sans
   * référence produit un nouveau rapport.
   */
  async runReport(period: ReportPeriod, options: { send: boolean; recipients?: string[]; scheduled: boolean }): Promise<AgentExecution<unknown>> {
    return this.runner.execute(ANALYTICS, { name: `report.${period.kind}`, ref: options.scheduled ? period.ref : null, input: { kind: period.kind, from: period.from, to: period.to, send: options.send } }, async (ctx) => {
      const days = Math.round((Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86_400_000) + 1;
      const previous = { from: shiftLocalDate(period.from, -days), to: shiftLocalDate(period.from, -1) };
      const current = await this.tools.call(ctx, 'queryMetrics', { from: period.from, to: period.to });
      if (!current.ok) throw new AppError('METRICS_UNAVAILABLE', current.message, 422);
      const before = await this.tools.call(ctx, 'queryMetrics', previous);
      const draft = await ctx.structured('report', reportSchema, [{
        role: 'user',
        content: [
          `Tâche : rédiger le rapport ${period.kind === 'daily' ? 'quotidien' : 'hebdomadaire'} du ${period.from} au ${period.to} pour le fondateur.`,
          'Indicateurs de la période :', asUntrustedData('indicateurs', JSON.stringify(current.data)),
          `Période précédente (${previous.from} au ${previous.to}) :`, asUntrustedData('indicateurs', JSON.stringify(before.ok ? before.data : null)),
        ].join('\n'),
      }]);
      const report: AgentReport = {
        title: orText(draft.title, `Rapport du ${period.from}`, 200), summary: draft.summary.slice(0, 1_500),
        highlights: draft.highlights.slice(0, 8).map((h) => h.slice(0, 300)), concerns: draft.concerns.slice(0, 8).map((c) => c.slice(0, 300)), body: draft.body.slice(0, 12_000),
      };
      const sentTo = options.send ? await this.send(report, options.recipients) : 0;
      return { kind: period.kind, from: period.from, to: period.to, ...report, sentTo };
    });
  }

  /** Rapport planifié de cette période en échec depuis moins de `withinMs` (reprise espacée). */
  async failedRecently(period: ReportPeriod, now: Date, withinMs: number): Promise<boolean> {
    const [row] = await this.database.db
      .select({ finishedAt: schema.agentRuns.finishedAt })
      .from(schema.agentRuns)
      .where(and(eq(schema.agentRuns.agentCode, ANALYTICS), eq(schema.agentRuns.trigger, `report.${period.kind}`), eq(schema.agentRuns.triggerRef, period.ref), eq(schema.agentRuns.status, 'failed')))
      .limit(1);
    return Boolean(row?.finishedAt && now.getTime() - row.finishedAt.getTime() < withinMs);
  }

  /** Texte du courriel : résumé, points forts, points d'attention, puis le corps du rapport. */
  static text(report: AgentReport): string {
    const list = (title: string, items: string[]) => (items.length ? `${title}\n${items.map((i) => `• ${i}`).join('\n')}\n\n` : '');
    return `${report.summary}\n\n${list('Points forts', report.highlights)}${list('Points d\'attention', report.concerns)}${report.body}\n\nLe rapport est aussi dans My Hub, rubrique Agents IA.`;
  }

  /** Destinataires : le réglage `agents.report_recipients`, sinon les administrateurs de My Hub. */
  private async send(report: AgentReport, recipients?: string[]): Promise<number> {
    const text = AnalyticsAgent.text(report);
    const configured = recipients ?? (await this.settings.get<unknown>('agents.report_recipients', []));
    const emails = (Array.isArray(configured) ? configured : []).filter((e): e is string => typeof e === 'string' && e.includes('@'));
    if (emails.length) {
      await this.outbox.queue(emails.map((email) => ({ recipientAddress: email, channel: 'email' as const, template: 'agent.report', language: 'fr' as const, data: { title: report.title, text } })));
      return emails.length;
    }
    const admins = await this.database.db.selectDistinct({ userId: schema.userRoles.userId }).from(schema.userRoles).where(inArray(schema.userRoles.role, ['admin']));
    await this.outbox.queue(admins.map((a) => ({ recipientUserId: a.userId, channel: 'email' as const, template: 'agent.report', language: 'fr' as const, data: { title: report.title, text } })));
    return admins.length;
  }

  static reportView(run: AgentRunView) {
    const out = (run.output ?? {}) as Partial<AgentReport & { kind: 'daily' | 'weekly'; from: string; to: string; sentTo: number }>;
    return {
      runId: run.id, kind: out.kind ?? 'daily', from: out.from ?? '', to: out.to ?? '', title: out.title ?? '', summary: out.summary ?? '',
      body: AnalyticsAgent.text({ title: out.title ?? '', summary: out.summary ?? '', highlights: out.highlights ?? [], concerns: out.concerns ?? [], body: out.body ?? '' }),
      sentTo: out.sentTo ?? 0, createdAt: run.startedAt,
    };
  }
}
