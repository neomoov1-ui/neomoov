/**
 * Agent `content` (plan 4.2) : le vendredi (réglage `marketing.content_day`, file `marketing`), produit le calendrier de
 * la semaine suivante par sortie structurée : pour chaque espace dont le connecteur est configuré, 2 à 5 contenus
 * adaptés (format, longueur, ton, mots-clics, appel à l'action), à partir des lignes éditoriales, des preuves de la
 * semaine (indicateurs anonymisés de `queryMetrics`) et des contenus récents (pas de répétition). Chaque contenu est une
 * ligne `content_items` en `draft`, contrôlée par les règles du domaine : sensible ou bloqué, approbation humaine ;
 * sinon, approuvé et programmé tout de suite si l'agent est en mode automatique. Une semaine n'est produite qu'une fois.
 */
import { schema } from '@neomoov/db';
import {
  assignSlots, asUntrustedData, autoPublishable, checkContent, contentCalendarOutputSchema, isSensitive, localClock, nextWeekStart, normalizeHashtag, parseSlots, shiftLocalDate, SPACE_RULES,
  type ContentCalendarOutput, type ContentDraft, type ContentSpace, type MarketingPlanResult,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, gte } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AgentRunnerService, type AgentRunContext } from '../agents/agent-runner.service.js';
import { AgentToolsService } from '../agents/agent-tools.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ContentService } from './content.service.js';
import { EditorialLinesService } from './editorial.js';
import { VisualsService } from './visuals.service.js';

export const CONTENT = 'content';

const MAX_TITLE = 200;
const MAX_BODY = 20_000;
const MAX_CAPTION = 2_200;
const MAX_HEADLINE = 160;

@Injectable()
export class ContentAgent {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly content: ContentService,
    private readonly editorial: EditorialLinesService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /**
   * Calendrier d'une semaine (lundi `weekStart`, par défaut la semaine suivante). Référence `content:<lundi>` : une
   * semaine déjà produite est rejouée sans rien refaire, sauf `force` (nouvelle exécution sans référence).
   */
  async planWeek(options: { weekStart?: string; force?: boolean; now?: Date } = {}): Promise<MarketingPlanResult> {
    const now = options.now ?? new Date();
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const weekStart = options.weekStart ?? nextWeekStart(now, tz);
    const spaces = this.content.configuredSpaces();
    const execution = await this.runner.execute<{ created: number; autoApproved: number; awaitingApproval: number; bySpace: Record<string, number>; summary: string }>(
      CONTENT,
      { name: 'content.weekly', ref: options.force ? null : `content:${weekStart}`, input: { weekStart, spaces } },
      (ctx) => this.produce(ctx, weekStart, spaces, now, tz),
      { onSkip: async (reason) => this.logger.warn({ reason, weekStart }, 'Calendrier de contenu non produit (agent hors service)') },
    );
    return { run: execution.run, replayed: execution.replayed, created: execution.result?.created ?? 0, autoApproved: execution.result?.autoApproved ?? 0 };
  }

  private async produce(ctx: AgentRunContext, weekStart: string, spaces: ContentSpace[], now: Date, tz: string) {
    if (!spaces.length) return { created: 0, autoApproved: 0, awaitingApproval: 0, bySpace: {}, summary: 'Aucun espace configuré' };
    const [lines, perSpace, rawSlots, options] = await Promise.all([
      this.editorial.load(),
      this.settings.get<{ min?: number; max?: number }>('marketing.items_per_space', { min: 2, max: 5 }),
      this.settings.get<unknown>('marketing.slots', null),
      this.content.checkOptions(),
    ]);
    const min = Math.max(1, Math.min(5, perSpace.min ?? 2));
    const max = Math.max(min, Math.min(5, perSpace.max ?? 5));
    const today = localClock(now, tz).date;
    const metrics = await this.tools.call(ctx, 'queryMetrics', { from: shiftLocalDate(today, -7), to: shiftLocalDate(today, -1) });
    const recent = await this.db
      .select({ space: schema.contentItems.space, title: schema.contentItems.title, body: schema.contentItems.body })
      .from(schema.contentItems)
      .where(and(gte(schema.contentItems.weekOf, shiftLocalDate(weekStart, -28))))
      .orderBy(desc(schema.contentItems.createdAt))
      .limit(60);
    const spaceLines = spaces.map((s) => {
      const r = SPACE_RULES[s];
      return `- ${s} (${r.name}) : formats ${r.formats.join(', ')} ; ${r.maxChars} caractères au plus ; ${r.maxHashtags} mots-clics au plus ; langues ${r.languages.join(' puis ')}${r.requiresMedia ? ' ; visuel ou vidéo obligatoire' : ''}${r.requiresTitle ? ' ; titre obligatoire' : ''}`;
    });
    const output = await ctx.structured('content_calendar', contentCalendarOutputSchema, [{
      role: 'user',
      content: [
        `Tâche : produire le calendrier de contenu de la semaine du ${weekStart} au ${shiftLocalDate(weekStart, 6)} (heure de Montréal), ${min} à ${max} contenus par espace.`,
        'Espaces à couvrir et règles de chaque réseau :', ...spaceLines,
        `Prix décidés (seuls montants admis) : ${options.allowedPrices.join(', ') || 'aucun'}. Appels à l'action : ${Object.entries(options.ctaUrls).map(([k, v]) => `${k} = ${v}`).join(' ; ') || 'aucun'}.`,
        'Lignes éditoriales (règles de la marque) :', lines,
        'Preuves de la semaine (indicateurs anonymisés d\'exploitation, données) :', asUntrustedData('indicateurs', JSON.stringify(metrics.ok ? metrics.data : null)),
        'Contenus des quatre dernières semaines, à ne pas répéter (données) :', asUntrustedData('contenus_recents', JSON.stringify(recent.map((r) => ({ space: r.space, title: r.title ?? r.body.slice(0, 80) })))),
        'Réponds par la structure demandée : items (un par contenu) et summary.',
      ].join('\n'),
    }]);
    const prepared = this.prepare(output, spaces, max, options);
    const scheduled = assignSlots(prepared, weekStart, parseSlots(rawSlots), tz, now);
    const rows = await this.db
      .insert(schema.contentItems)
      .values(prepared.map((p, index) => ({
        weekOf: weekStart, space: p.draft.space, format: p.draft.format, language: p.draft.language, title: p.draft.title, body: p.draft.body, caption: p.draft.caption,
        hashtags: p.draft.hashtags as object, cta: p.draft.cta, visualHeadline: p.visualHeadline, mediaStatus: VisualsService.expected(p.draft.space) ? 'pending' : 'none',
        scheduledAt: scheduled[index]!, status: 'draft' as const, sensitive: p.sensitive, issues: p.issues as object, promptVersion: ctx.agent.systemPromptKey, agentRunId: ctx.runId,
      })))
      .returning({ id: schema.contentItems.id, space: schema.contentItems.space });
    let autoApproved = 0;
    for (const [index, row] of rows.entries()) {
      const p = prepared[index]!;
      if (!autoPublishable(ctx.mode, p.sensitive, p.issues)) continue;
      await this.content.approve(row.id, { agentCode: ctx.agent.code }, now);
      autoApproved += 1;
    }
    const bySpace: Record<string, number> = {};
    for (const row of rows) bySpace[row.space] = (bySpace[row.space] ?? 0) + 1;
    await this.audit.recordSystem({ action: 'marketing.calendar_planned', entity: 'content_items', after: { weekStart, created: rows.length, autoApproved, bySpace, mode: ctx.mode } }, ctx.agent.code);
    return { created: rows.length, autoApproved, awaitingApproval: rows.length - autoApproved, bySpace, summary: output.summary.slice(0, 1_000) };
  }

  /** Sortie du modèle bornée et contrôlée : espaces configurés seulement, au plus `max` par espace, règles du domaine appliquées. */
  private prepare(output: ContentCalendarOutput, spaces: ContentSpace[], max: number, options: Awaited<ReturnType<ContentService['checkOptions']>>) {
    const counts = new Map<ContentSpace, number>();
    const prepared: Array<{ draft: ContentDraft; visualHeadline: string | null; sensitive: boolean; issues: ReturnType<typeof checkContent> }> = [];
    for (const item of output.items) {
      if (!spaces.includes(item.space)) continue;
      const n = counts.get(item.space) ?? 0;
      if (n >= max) continue;
      const rule = SPACE_RULES[item.space];
      const draft: ContentDraft = {
        space: item.space,
        format: rule.formats.includes(item.format) ? item.format : rule.formats[0]!,
        language: rule.languages.includes(item.language) ? item.language : 'fr',
        title: item.title?.trim() ? item.title.trim().slice(0, MAX_TITLE) : null,
        body: item.body.trim().slice(0, MAX_BODY),
        caption: item.caption?.trim() ? item.caption.trim().slice(0, MAX_CAPTION) : null,
        hashtags: item.hashtags.map(normalizeHashtag).filter((h): h is string => Boolean(h)).slice(0, 30),
        cta: item.cta,
      };
      if (!draft.body) continue;
      const issues = checkContent(draft, options);
      counts.set(item.space, n + 1);
      prepared.push({ draft, visualHeadline: item.visualHeadline.trim().slice(0, MAX_HEADLINE) || null, sensitive: isSensitive(item.sensitive, issues), issues });
    }
    return prepared;
  }
}
