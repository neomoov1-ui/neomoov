/**
 * Tâches de référencement (plan 4.1) : lecture pour My Hub, approbation (qui applique la tâche sur le site : balises
 * corrigées, brouillons créés, jamais publiés), refus motivé, mesure après application (Search Console, `seo.measure_days`).
 * L'agent `seo` crée les tâches ; en mode automatique il les applique lui-même par ce service.
 */
import { schema } from '@neomoov/db';
import { aggregateStats, shiftLocalDate, type SeoAction, type SeoTaskView, type SearchStat } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lte, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SEARCH_CONSOLE_PROVIDER, SITE_CONNECTOR, type SearchConsoleProvider, type SiteConnector } from '../../adapters/marketing.types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';

export type SeoTaskRow = typeof schema.seoTasks.$inferSelect;

export interface SeoProposal {
  title?: string | null;
  description?: string | null;
  question?: string | null;
  answer?: string | null;
  outline?: string[];
  body?: string | null;
  linkFrom?: string | null;
  linkTo?: string | null;
  anchor?: string | null;
  [key: string]: unknown;
}

export interface SeoActor {
  userId?: string | null;
  agentCode?: string | null;
}

export interface SeoMetricsRecord {
  clicks: number;
  impressions: number;
  position: number | null;
  queries: number;
  from: string;
  to: string;
}

@Injectable()
export class SeoService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SITE_CONNECTOR) private readonly site: SiteConnector,
    @Inject(SEARCH_CONSOLE_PROVIDER) private readonly searchConsole: SearchConsoleProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  static view(row: SeoTaskRow): SeoTaskView {
    return {
      id: row.id, weekOf: row.weekOf, action: row.action as SeoAction, targetKind: row.targetKind as SeoTaskView['targetKind'], targetRef: row.targetRef, targetTitle: row.targetTitle, targetUrl: row.targetUrl, keyword: row.keyword,
      justification: row.justification, proposal: (row.proposal ?? {}) as Record<string, unknown>, status: row.status as SeoTaskView['status'],
      metricsBefore: (row.metricsBefore as SeoMetricsRecord | null) ?? null, metricsAfter: (row.metricsAfter as SeoMetricsRecord | null) ?? null, externalId: row.externalId, externalUrl: row.externalUrl, agentRunId: row.agentRunId,
      decidedAt: row.decidedAt?.toISOString() ?? null, decisionNote: row.decisionNote, appliedAt: row.appliedAt?.toISOString() ?? null, measureDueAt: row.measureDueAt?.toISOString() ?? null, measuredAt: row.measuredAt?.toISOString() ?? null,
      lastError: row.lastError, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async row(id: string): Promise<SeoTaskRow> {
    const [row] = await this.db.select().from(schema.seoTasks).where(eq(schema.seoTasks.id, id)).limit(1);
    if (!row) throw AppError.notFound('SEO_TASK_NOT_FOUND', 'Tâche de référencement introuvable');
    return row;
  }

  async list(query: { status?: string | undefined; limit: number }): Promise<SeoTaskView[]> {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(schema.seoTasks.status, query.status));
    const rows = await this.db.select().from(schema.seoTasks).where(conditions.length ? and(...conditions) : undefined).orderBy(desc(schema.seoTasks.createdAt)).limit(query.limit);
    return rows.map(SeoService.view);
  }

  /** Statistiques de la Search Console des `days` derniers jours (par page) ; vide quand elle n'est pas configurée. */
  async stats(now: Date, days: number): Promise<{ rows: SearchStat[]; from: string; to: string }> {
    const to = now.toISOString().slice(0, 10);
    const from = shiftLocalDate(to, -days);
    if (!this.searchConsole.configured) return { rows: [], from, to };
    try {
      return { rows: await this.searchConsole.query({ from, to, byPage: true, rowLimit: 500 }), from, to };
    } catch (error) {
      this.logger.warn({ err: error }, 'Search Console indisponible : plan de référencement sans statistiques');
      return { rows: [], from, to };
    }
  }

  static metricsOf(stats: { rows: SearchStat[]; from: string; to: string }, targetUrl: string | null): SeoMetricsRecord {
    return { ...aggregateStats(stats.rows, targetUrl), from: stats.from, to: stats.to };
  }

  /** Vrai quand la proposition porte ce qu'il faut pour agir sur le site (balise ou brouillon) ; un lien interne reste manuel. */
  static applicable(action: string, proposal: SeoProposal): boolean {
    switch (action) {
      case 'fix_title':
        return Boolean(proposal.title?.trim());
      case 'fix_description':
        return Boolean(proposal.description?.trim());
      case 'new_page':
      case 'new_article':
        return Boolean(proposal.title?.trim() && (proposal.body?.trim() || proposal.outline?.length));
      case 'faq_question':
        return Boolean(proposal.question?.trim() && proposal.answer?.trim());
      default:
        return false;
    }
  }

  /** Applique une tâche sur le site : balises corrigées, brouillon créé (page, article ou question de FAQ en brouillon d'article). */
  async apply(id: string, actor: SeoActor, now = new Date()): Promise<SeoTaskView> {
    const row = await this.row(id);
    if (!['proposed', 'approved', 'failed'].includes(row.status)) throw AppError.conflict('SEO_TASK_NOT_APPLICABLE', `Une tâche ${row.status} ne s'applique plus`);
    const proposal = (row.proposal ?? {}) as SeoProposal;
    if (!SeoService.applicable(row.action, proposal)) {
      // Lien interne, ou proposition sans texte : la décision est prise, la modification reste humaine.
      await this.db.update(schema.seoTasks).set({ status: 'approved', decidedByUserId: actor.userId ?? null, decidedAt: now }).where(eq(schema.seoTasks.id, id));
      this.audit.record({ action: 'marketing.seo_task_approved', entity: 'seo_tasks', entityId: id, after: { action: row.action, applied: false, actor } });
      return SeoService.view(await this.row(id));
    }
    try {
      let externalId: string | null = row.externalId;
      let externalUrl: string | null = row.externalUrl;
      if (row.action === 'fix_title' || row.action === 'fix_description') {
        if (!row.targetRef) throw new AppError('SEO_TARGET_REQUIRED', 'Page visée absente', 422);
        await this.site.updateSeo(row.targetRef, row.action === 'fix_title' ? { title: proposal.title!.trim().slice(0, 70) } : { description: proposal.description!.trim().slice(0, 160) });
        externalId = row.targetRef;
      } else {
        const content = row.action === 'faq_question'
          ? `## ${proposal.question!.trim()}\n\n${proposal.answer!.trim()}\n\n(Question à intégrer à la page FAQ de neomoov.net ; brouillon créé par l'agent référencement.)`
          : (proposal.body?.trim() || (proposal.outline ?? []).map((h) => `## ${h}\n\n`).join(''));
        const draft = await this.site.createDraft({ kind: row.action === 'new_page' ? 'page' : 'post', title: (row.action === 'faq_question' ? proposal.question! : proposal.title!).trim().slice(0, 200), content, excerpt: proposal.description ?? null });
        externalId = draft.externalId;
        externalUrl = draft.url;
      }
      const measureDays = await this.settings.number('seo.measure_days', 28);
      await this.db
        .update(schema.seoTasks)
        .set({ status: 'applied', externalId, externalUrl, appliedAt: now, decidedByUserId: actor.userId ?? null, decidedAt: row.decidedAt ?? now, measureDueAt: new Date(now.getTime() + measureDays * 86_400_000), lastError: null })
        .where(eq(schema.seoTasks.id, id));
      this.audit.record({ action: 'marketing.seo_task_applied', entity: 'seo_tasks', entityId: id, after: { action: row.action, targetRef: row.targetRef, externalId, actor } });
    } catch (error) {
      const message = error instanceof AppError ? `${error.code} : ${error.message}` : error instanceof Error ? error.message : String(error);
      await this.db.update(schema.seoTasks).set({ status: 'failed', lastError: message.slice(0, 500), decidedByUserId: actor.userId ?? null, decidedAt: now }).where(eq(schema.seoTasks.id, id));
      this.audit.record({ action: 'marketing.seo_task_failed', entity: 'seo_tasks', entityId: id, after: { action: row.action, error: message.slice(0, 300) } });
    }
    return SeoService.view(await this.row(id));
  }

  async reject(id: string, reason: string, actor: SeoActor): Promise<SeoTaskView> {
    const row = await this.row(id);
    if (!['proposed', 'approved', 'failed'].includes(row.status)) throw AppError.conflict('SEO_TASK_NOT_APPLICABLE', `Une tâche ${row.status} ne se refuse plus`);
    await this.db.update(schema.seoTasks).set({ status: 'rejected', decisionNote: reason.slice(0, 500), decidedByUserId: actor.userId ?? null, decidedAt: new Date() }).where(eq(schema.seoTasks.id, id));
    this.audit.record({ action: 'marketing.seo_task_rejected', entity: 'seo_tasks', entityId: id, after: { action: row.action, reason: reason.slice(0, 500), actor } });
    return SeoService.view(await this.row(id));
  }

  /** Mesure après application (Search Console sur la page visée, ou le site) ; sans Search Console, la tâche reste appliquée. */
  async measureDue(now = new Date(), limit = 50): Promise<number> {
    if (!this.searchConsole.configured) return 0;
    const due = await this.db.select().from(schema.seoTasks).where(and(eq(schema.seoTasks.status, 'applied'), lte(schema.seoTasks.measureDueAt, now))).limit(limit);
    if (!due.length) return 0;
    const days = await this.settings.number('seo.stats_window_days', 28);
    const stats = await this.stats(now, days);
    for (const row of due) {
      await this.db.update(schema.seoTasks).set({ status: 'measured', measuredAt: now, metricsAfter: SeoService.metricsOf(stats, row.targetUrl ?? row.externalUrl) as object }).where(eq(schema.seoTasks.id, row.id));
    }
    return due.length;
  }
}
