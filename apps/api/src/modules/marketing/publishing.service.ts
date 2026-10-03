/**
 * Agent `publishing` (plan 4.2) : outils seulement, sans appel au modèle. Publie les contenus programmés à leur créneau
 * par le connecteur de leur espace (média produit à la demande s'il manque), mesure à J+1 et J+7, relit les
 * commentaires et répond aux commentaires simples (remerciement, horaires, lien de réservation : textes fixes du
 * domaine) ; tout autre commentaire part vers la relation client (`conversation.inbound`, canal `social`, quand ce canal
 * existe) ou vers un humain. Chaque passe est une exécution journalisée de l'agent ; un échec de connecteur donne une
 * nouvelle tentative espacée, puis l'état `failed` et une alerte au personnel.
 * Finalisation du 3 octobre 2026 : chaque acte passe par un outil déclaré de l'agent (`socialPublish`, `socialMetrics`,
 * `replyComment`, `forwardComment`) appelé par `AgentToolsService` (outil déclaré, entrée validée, journal homogène des
 * agents) ; l'infolettre part d'elle-même au créneau seulement si `marketing.newsletter_auto_send` est vrai (sinon
 * brouillon Brevo, décision du fondateur attendue).
 */
import { schema } from '@neomoov/db';
import {
  classifyComment, composeText, CONVERSATION_CHANNELS, forwardCommentToolSchema, nextMeasureAt, recordMeasure, replyCommentToolSchema, retryDelayMs, simpleReply, socialMetricsToolSchema, socialPublishToolSchema, SPACE_RULES,
  type ContentItemView, type ContentMetricsRecord, type ContentSpace, type ContentVisual, type CtaTarget,
} from '@neomoov/domain';
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { z } from 'zod';
import { MANUAL_RELAY_ERRORS, SOCIAL_PUBLISHERS, type SocialComment, type SocialMedia, type SocialPublisher, type SocialPublishers } from '../../adapters/marketing.types.js';
import { spaceLabel } from '../../adapters/real/marketing.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AgentRunnerService, type AgentRunContext } from '../agents/agent-runner.service.js';
import { AgentToolsService, done, type ToolResult } from '../agents/agent-tools.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { ContentService, type ContentItemRow } from './content.service.js';
import { VisualsService } from './visuals.service.js';

export const PUBLISHING = 'publishing';

export interface PublishPassReport {
  published: number;
  retried: number;
  failed: number;
}

export interface CommentsPassReport {
  checked: number;
  replied: number;
  forwarded: number;
  escalated: number;
}

/** Commentaire en cours de relais : lu par l'outil `forwardComment`, dont l'entrée journalisée ne porte que des identifiants. */
interface PendingComment {
  row: ContentItemRow;
  comment: SocialComment;
  language: 'fr' | 'en';
}

@Injectable()
export class PublishingService implements OnModuleInit {
  /** Tentatives de publication réellement exécutées par l'outil (`<contenu>:<tentative>`) : un refus avant l'outil est compté à part. */
  private readonly publishRuns = new Set<string>();
  private readonly pendingComments = new Map<string, PendingComment>();

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SOCIAL_PUBLISHERS) private readonly publishers: SocialPublishers,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly runner: AgentRunnerService,
    private readonly audit: AuditService,
    private readonly outbox: NotificationsOutbox,
    private readonly events: DomainEventsService,
    private readonly content: ContentService,
    private readonly visuals: VisualsService,
    @Optional() private readonly tools?: AgentToolsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Outils de l'agent de diffusion, enregistrés dans le socle des agents (mêmes règles et même journal que les autres). */
  onModuleInit() {
    if (!this.tools) return;
    this.tools.register('socialPublish', { description: 'Publie un contenu programmé par le connecteur de son espace (média produit à la demande) ; échec compté, nouvelle tentative espacée.', schema: socialPublishToolSchema, run: (_c, i) => this.publishTool(i) });
    this.tools.register('socialMetrics', { description: 'Relève les mesures d\'une publication (portée, interactions, clics) à J+1 puis J+7.', schema: socialMetricsToolSchema, run: (_c, i) => this.metricsTool(i) });
    this.tools.register('replyComment', { description: 'Répond publiquement à un commentaire simple par un texte fixe (remerciement, horaires, lien de réservation).', schema: replyCommentToolSchema, run: (_c, i) => this.replyTool(i) });
    this.tools.register('forwardComment', { description: 'Confie un commentaire à la relation client (boîte unifiée) ou, à défaut, au personnel.', schema: forwardCommentToolSchema, run: (_c, i) => this.forwardTool(i) });
  }

  /** Appel d'un outil de l'agent ; sans socle des agents (essais unitaires), l'outil est exécuté directement. */
  private async callTool(ctx: AgentRunContext, name: 'socialPublish' | 'socialMetrics' | 'replyComment' | 'forwardComment', input: Record<string, unknown>, run: () => Promise<ToolResult>): Promise<ToolResult> {
    return this.tools ? this.tools.call(ctx, name, input) : run();
  }

  private publisher(space: string): SocialPublisher {
    const publisher = this.publishers.get(space as ContentSpace);
    if (!publisher) throw new AppError('SOCIAL_SPACE_UNKNOWN', `Aucun connecteur pour l'espace ${space}`, 500);
    return publisher;
  }

  /** L'agent de diffusion agit en modes automatique et approbation (l'approbation porte sur chaque contenu) ; en manuel, rien ne part. */
  private async active(): Promise<boolean> {
    const agent = await this.runner.agent(PUBLISHING);
    if (!agent.active || agent.mode === 'manual') {
      this.logger.warn({ mode: agent.mode, active: agent.active }, 'Agent de diffusion hors service : aucune publication automatique');
      return false;
    }
    return true;
  }

  // Publication --------------------------------------------------------------------------------------------------------

  /** Contenus programmés dont le créneau (et le délai de nouvelle tentative) est passé. */
  async publishDue(now = new Date(), limit = 20): Promise<PublishPassReport> {
    const report: PublishPassReport = { published: 0, retried: 0, failed: 0 };
    if (!(await this.active())) return report;
    const due = await this.db
      .select({ id: schema.contentItems.id, space: schema.contentItems.space })
      .from(schema.contentItems)
      .where(and(eq(schema.contentItems.status, 'scheduled'), ne(schema.contentItems.delivery, 'manual'), lte(schema.contentItems.scheduledAt, now), or(isNull(schema.contentItems.nextAttemptAt), lte(schema.contentItems.nextAttemptAt, now))))
      .orderBy(asc(schema.contentItems.scheduledAt))
      .limit(limit);
    for (const { id, space } of due) {
      // Réseau sans connecteur utilisable (non configuré, approbation du réseau en attente) : relais manuel plutôt qu'un échec
      // (décision du fondateur du 3 octobre 2026) ; la tâche apparaît dans la vue « À relayer » de My Hub.
      if (this.publishers.get(space as ContentSpace)?.configured !== true) {
        await this.db.update(schema.contentItems).set({ delivery: 'manual', nextAttemptAt: null }).where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.status, 'scheduled')));
        continue;
      }
      const view = await this.publishItem(id, now);
      if (view.status === 'published') report.published += 1;
      else if (view.status === 'scheduled') report.retried += 1;
      else report.failed += 1;
    }
    return report;
  }

  /** Média d'un contenu : produit s'il est encore attendu, lu dans le stockage, adresse signée pour les réseaux qui le téléchargent. */
  private async mediaFor(row: ContentItemRow): Promise<{ media: SocialMedia | null; row: ContentItemRow }> {
    let current = row;
    if (current.mediaStatus === 'pending') current = await this.prepareMedia(current.id);
    if (!current.mediaKey || current.mediaStatus === 'failed' || current.mediaStatus === 'none') return { media: null, row: current };
    const file = await this.storage.getObject(current.mediaKey);
    if (!file) return { media: null, row: current };
    const url = await this.storage.getSignedUrl(current.mediaKey, 3_600).catch(() => null);
    return { media: { key: current.mediaKey, contentType: file.contentType, body: file.body, url }, row: current };
  }

  /** Production du visuel ou de la vidéo d'un contenu (tâche `media` de la file, ou à la demande avant publication). */
  async prepareMedia(id: string): Promise<ContentItemRow> {
    const row = await this.content.row(id);
    // Publication multiréseau : visuel de la variante du réseau (blogue compris, image à la une 1200 × 630).
    if (row.visual) return this.prepareVariantMedia(row);
    if (!VisualsService.expected(row.space as ContentSpace)) {
      if (row.mediaStatus !== 'none') await this.db.update(schema.contentItems).set({ mediaStatus: 'none' }).where(eq(schema.contentItems.id, id));
      return this.content.row(id);
    }
    try {
      const result = await this.visuals.prepare({ id: row.id, space: row.space as ContentSpace, format: row.format as ContentItemView['format'], language: row.language as 'fr' | 'en', title: row.title, body: row.body, headline: row.visualHeadline });
      await this.db.update(schema.contentItems).set({ mediaKey: result.mediaKey, mediaKind: result.mediaKind, mediaStatus: result.mediaStatus }).where(eq(schema.contentItems.id, id));
      this.audit.record({ action: 'marketing.media_prepared', entity: 'content_items', entityId: id, after: { mediaStatus: result.mediaStatus, mediaKind: result.mediaKind, assets: result.assets.length } });
    } catch (error) {
      this.logger.warn({ err: error, itemId: id }, 'Production du média en échec');
      await this.db.update(schema.contentItems).set({ mediaStatus: 'failed', lastError: `Média : ${error instanceof Error ? error.message.slice(0, 300) : String(error)}` }).where(eq(schema.contentItems.id, id));
    }
    return this.content.row(id);
  }

  /** Visuel d'un contenu de publication : variante produite, empreinte et miniature gardées dans `visual`. */
  private async prepareVariantMedia(row: ContentItemRow): Promise<ContentItemRow> {
    const visual = row.visual as ContentVisual;
    try {
      const result = await this.visuals.prepareVariant(
        { id: row.id, space: row.space as ContentSpace, format: row.format as ContentItemView['format'], language: row.language as 'fr' | 'en', title: row.title, body: row.body, headline: row.visualHeadline },
        visual,
        visual.photoUrl ? { url: visual.photoUrl, alt: visual.photoCredit } : null,
      );
      const next: ContentVisual = { ...visual, width: result.width, height: result.height, fingerprint: result.fingerprint, thumbnailKey: result.thumbnailKey };
      await this.db.update(schema.contentItems).set({ mediaKey: result.mediaKey, mediaKind: result.mediaKind, mediaStatus: result.mediaStatus, visual: next as object }).where(eq(schema.contentItems.id, row.id));
      this.audit.record({ action: 'marketing.media_prepared', entity: 'content_items', entityId: row.id, after: { mediaStatus: result.mediaStatus, mediaKind: result.mediaKind, template: visual.template, size: `${result.width}x${result.height}`, assets: result.assets.length } });
    } catch (error) {
      this.logger.warn({ err: error, itemId: row.id }, 'Production du visuel de la variante en échec');
      await this.db.update(schema.contentItems).set({ mediaStatus: 'failed', lastError: `Média : ${error instanceof Error ? error.message.slice(0, 300) : String(error)}` }).where(eq(schema.contentItems.id, row.id));
    }
    return this.content.row(row.id);
  }

  /**
   * Publie un contenu programmé (ou à la demande depuis My Hub) dans une exécution de l'agent de diffusion : réussite
   * (`published`, identifiant externe, première mesure à J+1), ou échec compté (nouvelle tentative espacée, puis `failed`).
   */
  async publishItem(id: string, now = new Date()): Promise<ContentItemView> {
    const current = await this.content.row(id);
    if (current.status !== 'scheduled') throw AppError.conflict('CONTENT_NOT_SCHEDULED', `Un contenu ${current.status} ne se publie pas`);
    if (current.delivery === 'manual') throw AppError.conflict('CONTENT_MANUAL_RELAY', 'Contenu en relais manuel : à publier à la main depuis la vue « À relayer », puis à marquer publié');
    // Réservation de la tentative (deux passes en même temps ne publient pas deux fois) : le compteur sert de verrou optimiste.
    const [row] = await this.db
      .update(schema.contentItems)
      .set({ attempts: current.attempts + 1, nextAttemptAt: new Date(now.getTime() + retryDelayMs(1)) })
      .where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.status, 'scheduled'), eq(schema.contentItems.attempts, current.attempts)))
      .returning();
    if (!row) throw AppError.conflict('CONTENT_PUBLISH_IN_PROGRESS', 'Publication déjà en cours pour ce contenu');
    const attempt = row.attempts;
    await this.runner.execute(
      PUBLISHING,
      { name: 'content.publish', ref: `publish:${id}:${attempt}`, input: { itemId: id, space: row.space, format: row.format, attempt, scheduledAt: row.scheduledAt?.toISOString() ?? null } },
      async (ctx) => {
        const key = `${id}:${attempt}`;
        const input = { itemId: id, at: now.toISOString() };
        try {
          const result = await this.callTool(ctx, 'socialPublish', input, () => this.publishTool(input));
          if (result.ok) return result.data;
          // Outil refusé avant d'agir (non déclaré pour l'agent, entrée invalide) : l'échec est compté comme un échec du connecteur.
          if (!this.publishRuns.has(key)) await this.recordFailure(row, attempt, new AppError('AGENT_TOOL_REFUSED', result.message, 409), now);
          const code = (result.data as { errorCode?: unknown } | null)?.errorCode;
          throw new AppError(typeof code === 'string' ? code : 'SOCIAL_PUBLISH_FAILED', result.message, 502);
        } finally {
          this.publishRuns.delete(key);
        }
      },
      {
        onSkip: async () => {
          await this.db.update(schema.contentItems).set({ lastError: 'Agent de diffusion hors service (mode manuel, inactif ou plafond atteint)' }).where(eq(schema.contentItems.id, id));
        },
      },
    );
    return this.content.view(id);
  }

  /** Outil `socialPublish` : publication de la tentative réservée ; un échec est compté (nouvelle tentative espacée ou `failed`). */
  private async publishTool(input: z.infer<typeof socialPublishToolSchema>): Promise<ToolResult> {
    const now = input.at ? new Date(input.at) : new Date();
    const row = await this.content.row(input.itemId);
    if (row.status !== 'scheduled') throw AppError.conflict('CONTENT_NOT_SCHEDULED', `Un contenu ${row.status} ne se publie pas`);
    this.publishRuns.add(`${row.id}:${row.attempts}`);
    try {
      const result = await this.send(row, now);
      return done(result, result.draft ? 'Contenu déposé en brouillon chez le réseau' : 'Contenu publié');
    } catch (error) {
      await this.recordFailure(row, row.attempts, error, now);
      throw error;
    }
  }

  /** Infolettre : envoi automatique au créneau seulement sur décision du fondateur (`marketing.newsletter_auto_send`), sinon brouillon. */
  private async draftFor(space: string): Promise<boolean> {
    if (space !== 'newsletter') return false;
    return (await this.settings.get<unknown>('marketing.newsletter_auto_send', false)) !== true;
  }

  private async send(row: ContentItemRow, now: Date): Promise<{ externalId: string; draft: boolean; notice: string | null }> {
    const publisher = this.publisher(row.space);
    const { media, row: current } = await this.mediaFor(row);
    const rule = SPACE_RULES[current.space as ContentSpace];
    if (rule.requiresMedia && publisher.name !== 'mock' && current.mediaStatus !== 'ready') {
      throw new AppError('SOCIAL_MEDIA_NOT_READY', `${rule.name} exige un visuel rendu : ${current.mediaStatus === 'html' ? 'rendu différé (BROWSER_BIN absent)' : `média ${current.mediaStatus}`}`, 422);
    }
    const ctaUrls = (await this.content.checkOptions()).ctaUrls;
    const ctaUrl = current.cta === 'none' ? null : (ctaUrls[current.cta as CtaTarget] ?? null);
    const hashtags = Array.isArray(current.hashtags) ? (current.hashtags as string[]) : [];
    const result = await publisher.publish({
      itemId: current.id, space: current.space as ContentSpace, format: current.format as ContentItemView['format'], language: current.language as 'fr' | 'en', title: current.title, body: current.body, caption: current.caption, hashtags,
      text: composeText({ space: current.space as ContentSpace, title: current.title, body: current.body, caption: current.caption, hashtags, ctaUrl }), ctaUrl, cta: current.cta as CtaTarget, media, draft: await this.draftFor(current.space),
    });
    const measureDays = await this.measureDays();
    await this.db
      .update(schema.contentItems)
      .set({ status: 'published', externalId: result.externalId, externalUrl: result.url, publishedAt: now, nextAttemptAt: null, lastError: null, publishNotice: result.notice?.slice(0, 500) ?? null, measureDueAt: nextMeasureAt(now, measureDays, 0), measureCount: 0 })
      .where(eq(schema.contentItems.id, row.id));
    await this.audit.recordSystem({ action: 'marketing.content_published', entity: 'content_items', entityId: row.id, after: { space: row.space, externalId: result.externalId, url: result.url, draft: result.draft, notice: result.notice ?? null } }, PUBLISHING);
    return { externalId: result.externalId, draft: result.draft, notice: result.notice ?? null };
  }

  private async recordFailure(row: ContentItemRow, attempt: number, error: unknown, now: Date): Promise<void> {
    const max = await this.settings.number('marketing.publish_max_attempts', 3);
    const message = error instanceof AppError ? `${error.code} : ${error.message}` : error instanceof Error ? error.message : String(error);
    // Relais manuel (compte en mode manuel, approbation en attente chez le réseau) : aucune nouvelle tentative, la
    // publication attend un humain (état `failed`, `lastError` commençant par SOCIAL_MANUAL_RELAY ou SOCIAL_APPROVAL_PENDING).
    const manualRelay = error instanceof AppError && MANUAL_RELAY_ERRORS.includes(error.code);
    const definitive = manualRelay || attempt >= max;
    // Limite atteinte (429) : le nouvel essai attend au moins le délai demandé par le réseau (borné à 26 heures).
    const retryAfter = error instanceof AppError ? Number((error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds ?? 0) || 0 : 0;
    const delay = Math.max(retryDelayMs(attempt), Math.min(retryAfter, 26 * 3_600) * 1_000);
    await this.db
      .update(schema.contentItems)
      .set({ lastError: message.slice(0, 500), ...(definitive ? { status: 'failed', nextAttemptAt: null } : { nextAttemptAt: new Date(now.getTime() + delay) }) })
      .where(eq(schema.contentItems.id, row.id));
    await this.audit.recordSystem({ action: manualRelay ? 'marketing.content_manual_relay' : definitive ? 'marketing.content_failed' : 'marketing.content_retry', entity: 'content_items', entityId: row.id, after: { space: row.space, attempt, error: message.slice(0, 300) } }, PUBLISHING);
    if (manualRelay) await this.outbox.queueForStaff('alert.agent_escalation', { reason: 'marketing_manual_relay', summary: `${spaceLabel(row.space)} : publication à relayer à la main (${(error as AppError).message.slice(0, 200)})`, contentItemId: row.id });
    else if (definitive) await this.outbox.queueForStaff('alert.agent_escalation', { reason: 'marketing_publish_failed', summary: `${spaceLabel(row.space)} : publication en échec après ${attempt} tentatives (${message.slice(0, 160)})`, contentItemId: row.id });
  }

  private async measureDays(): Promise<number[]> {
    const raw = await this.settings.get<unknown>('marketing.measure_days', [1, 7]);
    const days = Array.isArray(raw) ? raw.filter((d): d is number => typeof d === 'number' && d > 0) : [];
    return days.length ? days : [1, 7];
  }

  // Mesures ---------------------------------------------------------------------------------------------------------------

  /**
   * Outil `socialMetrics` : mesure due d'une publication ; la dernière clôt le contenu en `measured`. Un échec reporte la
   * lecture d'une heure (sans bloquer les autres contenus) et revient au modèle comme un refus motivé.
   */
  private async metricsTool(input: z.infer<typeof socialMetricsToolSchema>): Promise<ToolResult> {
    const now = input.at ? new Date(input.at) : new Date();
    const row = await this.content.row(input.itemId);
    if (row.status !== 'published' || !row.externalId) throw AppError.conflict('CONTENT_NOT_PUBLISHED', 'Contenu non publié : aucune mesure');
    try {
      const measureDays = await this.measureDays();
      const reading = await this.publisher(row.space).metrics({ itemId: row.id, externalId: row.externalId, externalUrl: row.externalUrl });
      const count = row.measureCount + 1;
      const day = measureDays[row.measureCount] ?? measureDays[measureDays.length - 1]!;
      const metrics = recordMeasure((row.metrics ?? null) as Partial<ContentMetricsRecord> | null, { reach: reading.reach, interactions: reading.interactions, clicks: reading.clicks }, now, day);
      const next = nextMeasureAt(row.publishedAt ?? now, measureDays, count);
      await this.db.update(schema.contentItems).set({ metrics: metrics as object, measureCount: count, measureDueAt: next, ...(next ? {} : { status: 'measured' }) }).where(eq(schema.contentItems.id, row.id));
      return done({ day, reach: reading.reach, interactions: reading.interactions, clicks: reading.clicks }, 'Mesure relevée');
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      await this.db.update(schema.contentItems).set({ measureDueAt: new Date(now.getTime() + 3_600_000), lastError: `Mesure : ${message}` }).where(eq(schema.contentItems.id, row.id));
      throw new AppError('SOCIAL_METRICS_FAILED', `Mesure reportée d'une heure : ${message}`, 502);
    }
  }

  /** Mesures dues (J+1, puis J+7) ; la dernière mesure clôt le contenu en `measured`. */
  async measureDue(now = new Date(), limit = 50): Promise<number> {
    const due = await this.db.select().from(schema.contentItems).where(and(eq(schema.contentItems.status, 'published'), isNotNull(schema.contentItems.externalId), lte(schema.contentItems.measureDueAt, now))).orderBy(asc(schema.contentItems.measureDueAt)).limit(limit);
    if (!due.length) return 0;
    let measured = 0;
    await this.runner.execute(PUBLISHING, { name: 'content.measure', ref: null, input: { due: due.length } }, async (ctx) => {
      for (const row of due) {
        const input = { itemId: row.id, at: now.toISOString() };
        const result = await this.callTool(ctx, 'socialMetrics', input, () => this.metricsTool(input)).catch((error: unknown) => {
          this.logger.warn({ err: error, itemId: row.id }, 'Mesure non relevée');
          return null;
        });
        if (result?.ok) measured += 1;
      }
      return { measured, due: due.length };
    });
    return measured;
  }

  // Autorisations des réseaux ---------------------------------------------------------------------------------------------

  /** Alertes déjà envoyées (réseau et jour) : une seule par jour et par réseau, même si la passe tourne toutes les cinq minutes. */
  private readonly credentialAlerts = new Set<string>();

  /**
   * Autorisations des réseaux à jeton OAuth (Fiche Google, LinkedIn, YouTube, X, TikTok) : alerte au personnel quand le
   * jeton doit être refait à la main dans moins de `marketing.token_alert_days` jours (jeton LinkedIn de 60 jours sans
   * rafraîchissement, jetons de rafraîchissement d'un an), ou quand l'échange du jeton échoue (révoqué, application
   * suspendue). Rend le nombre d'alertes envoyées.
   */
  async credentialsPass(now = new Date()): Promise<number> {
    const days = await this.settings.number('marketing.token_alert_days', 7);
    const day = now.toISOString().slice(0, 10);
    let alerts = 0;
    for (const publisher of new Set(this.publishers.values())) {
      if (!publisher.configured || !publisher.credentials) continue;
      const key = `${publisher.space}:${day}`;
      if (this.credentialAlerts.has(key)) continue;
      let status: Awaited<ReturnType<NonNullable<SocialPublisher['credentials']>>>;
      try {
        status = await publisher.credentials();
      } catch (error) {
        status = { renewable: false, renewBy: null, problem: error instanceof Error ? error.message.slice(0, 300) : String(error) };
      }
      const expiring = status.renewBy !== null && status.renewBy.getTime() - now.getTime() < days * 86_400_000;
      if (!expiring && !status.problem) continue;
      this.credentialAlerts.add(key);
      const name = spaceLabel(publisher.space);
      const summary = status.problem
        ? `${name} : autorisation en échec (${status.problem.slice(0, 200)}). Refaire l'autorisation : docs/marketing/connecteurs.md`
        : `${name} : autorisation à refaire avant le ${status.renewBy!.toISOString().slice(0, 10)} (docs/marketing/connecteurs.md, commande oauth:jeton)`;
      await this.outbox.queueForStaff('alert.agent_escalation', { reason: 'marketing_token_expiring', summary });
      await this.audit.recordSystem({ action: 'marketing.token_alert', entity: 'content_items', after: { space: publisher.space, renewBy: status.renewBy?.toISOString() ?? null, problem: status.problem !== null } }, PUBLISHING);
      alerts += 1;
    }
    return alerts;
  }

  // Commentaires ----------------------------------------------------------------------------------------------------------

  /**
   * Commentaires reçus sur les publications récentes : réponse automatique aux commentaires simples, relais sinon.
   * Un seul répondant par commentaire : sur Facebook et Instagram, la boîte unifiée reçoit déjà les commentaires par le
   * webhook Meta et l'agent relation client y répond ; la diffusion ne répond donc jamais elle-même sur ces réseaux, elle
   * relaie (même identifiant externe : la relation client ne traite le commentaire qu'une fois, quel que soit le chemin).
   */
  async commentsPass(now = new Date(), limit = 50): Promise<CommentsPassReport> {
    const report: CommentsPassReport = { checked: 0, replied: 0, forwarded: 0, escalated: 0 };
    const windowDays = await this.settings.number('marketing.comments_window_days', 7);
    const rows = await this.db
      .select()
      .from(schema.contentItems)
      .where(and(inArray(schema.contentItems.status, ['published', 'measured']), isNotNull(schema.contentItems.externalId), gte(schema.contentItems.publishedAt, new Date(now.getTime() - windowDays * 86_400_000))))
      .orderBy(asc(schema.contentItems.publishedAt))
      .limit(limit);
    if (!rows.length) return report;
    const fresh: Array<{ row: ContentItemRow; comments: SocialComment[] }> = [];
    for (const row of rows) {
      report.checked += 1;
      try {
        const since = row.commentsCheckedAt ?? row.publishedAt ?? now;
        const comments = await this.publisher(row.space).comments({ itemId: row.id, externalId: row.externalId!, externalUrl: row.externalUrl }, since);
        const known = comments.length ? new Set((await this.db.select({ externalId: schema.contentComments.externalId }).from(schema.contentComments).where(and(eq(schema.contentComments.contentItemId, row.id), inArray(schema.contentComments.externalId, comments.map((c) => c.externalId))))).map((c) => c.externalId)) : new Set<string>();
        const unseen = comments.filter((c) => !known.has(c.externalId));
        if (unseen.length) fresh.push({ row, comments: unseen });
        await this.db.update(schema.contentItems).set({ commentsCheckedAt: now }).where(eq(schema.contentItems.id, row.id));
      } catch (error) {
        this.logger.warn({ err: error, itemId: row.id }, 'Commentaires illisibles pour ce contenu');
      }
    }
    if (!fresh.length) return report;
    const manual = !(await this.active());
    const [hours, ctaUrls] = await Promise.all([this.settings.get<{ fr?: string; en?: string }>('marketing.service_hours', {}), this.settings.get<Record<string, unknown>>('marketing.cta_urls', {})]);
    const texts = { hours: { fr: hours.fr ?? 'Réservez au moins 2 heures à l\'avance sur neomoov.net.', en: hours.en ?? 'Book at least 2 hours ahead at neomoov.net.' }, bookingUrl: typeof ctaUrls['reserve'] === 'string' ? (ctaUrls['reserve'] as string) : 'https://neomoov.net/reserver' };
    const socialChannel = (CONVERSATION_CHANNELS as readonly string[]).includes('social');
    await this.runner.execute(PUBLISHING, { name: 'content.comments', ref: null, input: { items: fresh.length, comments: fresh.reduce((n, f) => n + f.comments.length, 0) } }, async (ctx) => {
      for (const { row, comments } of fresh) {
        for (const comment of comments) {
          const read = classifyComment(comment.text);
          // Avis noté 3 sur 5 ou moins (Fiche Google) : jamais de réponse automatique, même s'il remercie.
          const classification = typeof comment.rating === 'number' && comment.rating <= 3 ? { ...read, negative: true, simple: false } : read;
          const inboxOwns = socialChannel && INBOX_COMMENT_NETWORKS.has(row.space);
          const reply = manual || inboxOwns ? null : simpleReply(classification, texts);
          let outcome: 'replied' | 'forwarded' | 'escalated' = 'escalated';
          let replyExternalId: string | null = null;
          if (reply) {
            const input = { itemId: row.id, commentId: comment.externalId, text: reply };
            const replied = await this.callTool(ctx, 'replyComment', input, () => this.replyTool(input)).catch(() => null);
            if (replied?.ok) {
              replyExternalId = (replied.data as { externalId: string }).externalId;
              outcome = 'replied';
              report.replied += 1;
            } else this.logger.warn({ itemId: row.id }, 'Réponse au commentaire impossible : relais humain');
          }
          if (outcome !== 'replied') {
            const key = `${row.id}:${comment.externalId}`;
            this.pendingComments.set(key, { row, comment, language: classification.language });
            const input = { itemId: row.id, commentId: comment.externalId, intent: classification.intent, negative: classification.negative };
            const forwarded = await this.callTool(ctx, 'forwardComment', input, () => this.forwardTool(input)).catch(() => null).finally(() => this.pendingComments.delete(key));
            // Outil refusé (non déclaré, panne) : le personnel est prévenu directement, le commentaire n'est jamais perdu.
            outcome = forwarded?.ok ? (forwarded.data as { outcome: 'forwarded' | 'escalated' }).outcome : await this.escalateComment(row, comment, classification.negative);
            if (outcome === 'forwarded') report.forwarded += 1;
            else report.escalated += 1;
          }
          await this.db
            .insert(schema.contentComments)
            .values({ contentItemId: row.id, externalId: comment.externalId, author: comment.author?.slice(0, 120) ?? null, body: comment.text.slice(0, 4_000), postedAt: comment.postedAt, intent: classification.intent, outcome, replyBody: outcome === 'replied' ? reply : null, replyExternalId })
            .onConflictDoNothing();
        }
      }
      return { ...report };
    });
    return report;
  }

  /** Outil `replyComment` : réponse publique, texte fixe du domaine, sous la publication. */
  private async replyTool(input: z.infer<typeof replyCommentToolSchema>): Promise<ToolResult> {
    const row = await this.content.row(input.itemId);
    if (!row.externalId) throw AppError.conflict('CONTENT_NOT_PUBLISHED', 'Contenu non publié : aucun commentaire');
    try {
      const { externalId } = await this.publisher(row.space).replyComment({ itemId: row.id, externalId: row.externalId, externalUrl: row.externalUrl }, input.commentId, input.text);
      return done({ externalId }, 'Réponse publiée');
    } catch (error) {
      throw error instanceof AppError ? error : new AppError('SOCIAL_REPLY_FAILED', error instanceof Error ? error.message.slice(0, 300) : String(error), 502);
    }
  }

  /**
   * Outil `forwardComment` : la relation client reprend le fil sur le canal social de la boîte unifiée (même forme et même
   * identifiant externe que les commentaires reçus par le connecteur Meta : un commentaire vu par les deux chemins n'est
   * traité qu'une fois ; les connecteurs de diffusion ne donnent pas l'identifiant de l'auteur, l'adresse de la
   * conversation est celle du commentaire) ; sans canal social, le personnel est prévenu.
   */
  private async forwardTool(input: z.infer<typeof forwardCommentToolSchema>): Promise<ToolResult> {
    const pending = this.pendingComments.get(`${input.itemId}:${input.commentId}`);
    if (!pending) throw AppError.notFound('COMMENT_NOT_PENDING', 'Commentaire inconnu de cette passe');
    const { row, comment, language } = pending;
    if (!(CONVERSATION_CHANNELS as readonly string[]).includes('social')) return done({ outcome: await this.escalateComment(row, comment, input.negative) }, 'Commentaire remis au personnel');
    this.events.emit('conversation.inbound', {
      channel: 'social', externalId: `social:${row.space}:comment:${comment.externalId}`.slice(0, 120), userId: null, phone: null, text: comment.text, language, rideId: null, receivedAt: comment.postedAt,
      address: `${row.space}:comment:${comment.externalId}`.slice(0, 254), network: INBOX_NETWORK_OF[row.space] ?? row.space, kind: 'comment', threadRef: comment.externalId, displayName: comment.author?.slice(0, 120) ?? null,
      metadata: { commentId: comment.externalId, postId: row.externalId, contentItemId: row.id },
    });
    return done({ outcome: 'forwarded' }, 'Commentaire confié à la relation client');
  }

  /** Commentaire remis au personnel (courriel d'alerte). */
  private async escalateComment(row: ContentItemRow, comment: SocialComment, negative: boolean): Promise<'escalated'> {
    const summary = `${SPACE_RULES[row.space as ContentSpace].name} : « ${comment.text.slice(0, 200)} »${comment.author ? ` (${comment.author})` : ''}`;
    await this.outbox.queueForStaff('alert.agent_escalation', { reason: negative ? 'social_comment_negative' : 'social_comment', summary, contentItemId: row.id });
    return 'escalated';
  }
}

/** Réseaux dont la boîte unifiée reçoit les commentaires (connecteur Meta) : elle seule y répond. */
export const INBOX_COMMENT_NETWORKS: ReadonlySet<string> = new Set(['facebook', 'instagram']);

/**
 * Nom du réseau dans la boîte unifiée quand il diffère de l'espace : les avis de la Fiche Google y arrivent sous `gbp`,
 * réseau à relais humain (la réponse de la relation client ne part jamais par le connecteur Meta).
 */
export const INBOX_NETWORK_OF: Readonly<Partial<Record<string, string>>> = { google_business: 'gbp' };
