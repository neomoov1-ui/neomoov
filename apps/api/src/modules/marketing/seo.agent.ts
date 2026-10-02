/**
 * Agent `seo` (plan 4.1) : le lundi (réglages `seo.weekday`, `seo.hour`), lit les pages du site (API WordPress :
 * titres, descriptions, en-têtes, liens), les mots-clés cibles (`seo.keywords`) et la Search Console (si elle est
 * configurée), passe les contrôles déterministes du domaine (`seoFindings`), puis demande au modèle une proposition
 * concrète par constat (titre, description, question de FAQ, plan et texte d'article) ; les constats que le modèle
 * n'a pas repris deviennent des tâches sans texte. En mode automatique, les corrections de balises sont appliquées et
 * les brouillons créés tout de suite ; sinon tout attend l'approbation dans My Hub. Une semaine n'est produite qu'une fois.
 */
import { schema } from '@neomoov/db';
import { asUntrustedData, localClock, seoFindings, seoPlanOutputSchema, weekStartOf, type SeoFinding, type SeoPlanOutput, type SeoPlanResult, type SitePage } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SITE_CONNECTOR, type SiteConnector } from '../../adapters/marketing.types.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AgentRunnerService, type AgentRunContext } from '../agents/agent-runner.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SeoService, type SeoProposal } from './seo.service.js';

export const SEO = 'seo';

const OPEN_STATUSES = ['proposed', 'approved', 'applied'];

@Injectable()
export class SeoAgent {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SITE_CONNECTOR) private readonly site: SiteConnector,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly runner: AgentRunnerService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly seo: SeoService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async planWeek(options: { weekStart?: string; force?: boolean; now?: Date } = {}): Promise<SeoPlanResult> {
    const now = options.now ?? new Date();
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const weekStart = options.weekStart ?? weekStartOf(localClock(now, tz).date);
    const execution = await this.runner.execute<{ created: number; applied: number; findings: number; summary: string }>(
      SEO,
      { name: 'seo.weekly', ref: options.force ? null : `seo:${weekStart}`, input: { weekStart } },
      (ctx) => this.produce(ctx, weekStart, now),
      { onSkip: async (reason) => this.logger.warn({ reason, weekStart }, 'Plan de référencement non produit (agent hors service)') },
    );
    return { run: execution.run, replayed: execution.replayed, created: execution.result?.created ?? 0, applied: execution.result?.applied ?? 0 };
  }

  private async produce(ctx: AgentRunContext, weekStart: string, now: Date) {
    const [keywordsRaw, maxTasks, statsDays] = await Promise.all([this.settings.get<unknown>('seo.keywords', []), this.settings.number('seo.max_tasks_per_run', 10), this.settings.number('seo.stats_window_days', 28)]);
    const keywords = Array.isArray(keywordsRaw) ? keywordsRaw.filter((k): k is string => typeof k === 'string' && k.trim().length > 0) : [];
    const pages = await this.site.pages();
    const stats = await this.seo.stats(now, statsDays);
    const findings = seoFindings(pages, keywords, stats.rows);
    const output = await ctx.structured('seo_plan', seoPlanOutputSchema, [{
      role: 'user',
      content: [
        `Tâche : proposer le plan de référencement de la semaine du ${weekStart} (${maxTasks} tâches au plus), avec une proposition concrète par constat.`,
        `Mots-clés cibles, par priorité : ${keywords.join(' ; ') || 'aucun'}.`,
        'Pages du site (identifiant, adresse, titres, balises, en-têtes, liens internes, mots) :', asUntrustedData('pages', JSON.stringify(pages.map((p) => ({ id: p.id, kind: p.kind, url: p.url, title: p.title, metaTitle: p.metaTitle, metaDescription: p.metaDescription, h1: p.h1, headings: p.headings.slice(0, 12), internalLinks: p.internalLinks, wordCount: p.wordCount })))),
        'Constats des contrôles automatiques (chacun attend une proposition) :', asUntrustedData('constats', JSON.stringify(findings)),
        `Search Console des ${statsDays} derniers jours (clics, impressions, position par requête et par page) :`, asUntrustedData('search_console', JSON.stringify(stats.rows.slice(0, 200))),
        'Réponds par la structure demandée : tasks (une par constat, targetRef = identifiant de page fourni ou null) et summary.',
      ].join('\n'),
    }]);
    const candidates = this.merge(output, findings, pages, maxTasks);
    const existing = await this.db.select({ action: schema.seoTasks.action, targetRef: schema.seoTasks.targetRef, keyword: schema.seoTasks.keyword }).from(schema.seoTasks).where(and(inArray(schema.seoTasks.status, OPEN_STATUSES)));
    const open = new Set(existing.map((e) => `${e.action}|${e.targetRef ?? ''}|${(e.keyword ?? '').toLowerCase()}`));
    const fresh = candidates.filter((c) => !open.has(`${c.action}|${c.targetRef ?? ''}|${(c.keyword ?? '').toLowerCase()}`));
    if (!fresh.length) return { created: 0, applied: 0, findings: findings.length, summary: output.summary.slice(0, 1_000) };
    const rows = await this.db
      .insert(schema.seoTasks)
      .values(fresh.map((c) => ({
        weekOf: weekStart, action: c.action, targetKind: c.targetKind, targetRef: c.targetRef, targetTitle: c.targetTitle?.slice(0, 200) ?? null, targetUrl: c.targetUrl, keyword: c.keyword?.slice(0, 120) ?? null,
        justification: c.justification.slice(0, 2_000), proposal: c.proposal as object, status: 'proposed' as const, metricsBefore: SeoService.metricsOf(stats, c.targetUrl) as object, agentRunId: ctx.runId,
      })))
      .returning({ id: schema.seoTasks.id, action: schema.seoTasks.action });
    let applied = 0;
    if (ctx.mode === 'auto') {
      for (const row of rows) {
        const view = await this.seo.apply(row.id, { agentCode: ctx.agent.code }, now);
        if (view.status === 'applied') applied += 1;
      }
    }
    await this.audit.recordSystem({ action: 'marketing.seo_planned', entity: 'seo_tasks', after: { weekStart, created: rows.length, applied, findings: findings.length, mode: ctx.mode } }, ctx.agent.code);
    return { created: rows.length, applied, findings: findings.length, summary: output.summary.slice(0, 1_000) };
  }

  /** Tâches du modèle validées (page connue, texte borné), complétées par les constats non repris, bornées à `max`. */
  private merge(output: SeoPlanOutput, findings: SeoFinding[], pages: SitePage[], max: number) {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const tasks: Array<{ action: SeoFinding['action']; targetKind: SeoFinding['targetKind']; targetRef: string | null; targetTitle: string | null; targetUrl: string | null; keyword: string | null; justification: string; proposal: SeoProposal }> = [];
    const seen = new Set<string>();
    const key = (action: string, ref: string | null, keyword: string | null) => `${action}|${ref ?? ''}|${(keyword ?? '').toLowerCase()}`;
    const bounded = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null);
    for (const task of output.tasks) {
      const page = task.targetRef ? byId.get(task.targetRef) : undefined;
      if (task.targetRef && !page) continue;
      if ((task.action === 'fix_title' || task.action === 'fix_description' || task.action === 'internal_link') && !page) continue;
      const k = key(task.action, page?.id ?? null, task.keyword);
      if (seen.has(k)) continue;
      seen.add(k);
      tasks.push({
        action: task.action, targetKind: page ? page.kind : 'site', targetRef: page?.id ?? null, targetTitle: page?.title ?? null, targetUrl: page?.url ?? null, keyword: bounded(task.keyword, 120),
        justification: task.justification.trim() || 'Proposition de l\'agent référencement',
        proposal: {
          title: bounded(task.proposal.title, 200), description: bounded(task.proposal.description, 300), question: bounded(task.proposal.question, 300), answer: bounded(task.proposal.answer, 2_000),
          outline: task.proposal.outline.slice(0, 12).map((h) => h.slice(0, 120)), body: bounded(task.proposal.body, 20_000), linkFrom: bounded(task.proposal.linkFrom, 300), linkTo: bounded(task.proposal.linkTo, 300), anchor: bounded(task.proposal.anchor, 120),
        },
      });
    }
    for (const finding of findings) {
      const k = key(finding.action, finding.targetRef, finding.keyword);
      if (seen.has(k)) continue;
      seen.add(k);
      const page = finding.targetRef ? byId.get(finding.targetRef) : undefined;
      tasks.push({ action: finding.action, targetKind: finding.targetKind, targetRef: finding.targetRef, targetTitle: finding.targetTitle, targetUrl: page?.url ?? null, keyword: finding.keyword, justification: finding.justification, proposal: { ...finding.proposal } });
    }
    return tasks.slice(0, Math.max(1, max));
  }
}
