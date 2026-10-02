/**
 * Calendrier de contenu (plan 4.2) : lecture par semaine et par espace pour My Hub, modification avant publication,
 * approbation en un clic (le contenu passe en `scheduled` à son créneau et son visuel est produit), refus motivé,
 * publication immédiate, média servi à la visionneuse. Chaque décision humaine est journalisée. Les règles du
 * domaine (`checkContent`) sont réappliquées à chaque modification : un contenu bloqué ou sensible exige un humain.
 */
import { schema } from '@neomoov/db';
import {
  assignSlots, checkContent, CONTENT_SPACES, EMPTY_METRICS, isSensitive, normalizeHashtag, parseSlots, SPACE_RULES, weekStartOf, localClock,
  type ContentCheckOptions, type ContentDraft, type ContentIssue, type ContentItemView, type ContentListQuery, type ContentMetricsRecord, type ContentSpace, type ContentUpdateInput, type CtaTarget, type MarketingSpaceView, type ContentCommentView,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SOCIAL_PUBLISHERS, type SocialPublishers } from '../../adapters/marketing.types.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { AuditService } from '../audit/audit.service.js';
import { VisualsService } from './visuals.service.js';

export type ContentItemRow = typeof schema.contentItems.$inferSelect;
type CommentRow = typeof schema.contentComments.$inferSelect;

export interface ContentActor {
  userId?: string | null;
  agentCode?: string | null;
}

const EDITABLE = ['draft', 'approved', 'scheduled', 'failed'];
const APPROVABLE = ['draft', 'failed', 'rejected'];

@Injectable()
export class ContentService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(SOCIAL_PUBLISHERS) private readonly publishers: SocialPublishers,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
  ) {}

  private get db() {
    return this.database.db;
  }

  static commentView(c: CommentRow): ContentCommentView {
    return { id: c.id, externalId: c.externalId, author: c.author, body: c.body, postedAt: c.postedAt.toISOString(), intent: c.intent as ContentCommentView['intent'], outcome: c.outcome as ContentCommentView['outcome'], replyBody: c.replyBody, createdAt: c.createdAt.toISOString() };
  }

  static view(row: ContentItemRow, comments: CommentRow[] = []): ContentItemView {
    const metrics = { ...EMPTY_METRICS, ...((row.metrics ?? {}) as Partial<ContentMetricsRecord>) };
    return {
      id: row.id, weekOf: row.weekOf, space: row.space as ContentSpace, format: row.format as ContentItemView['format'], language: row.language as ContentItemView['language'],
      title: row.title, body: row.body, caption: row.caption, hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [], cta: row.cta as CtaTarget, visualHeadline: row.visualHeadline,
      mediaStatus: row.mediaStatus as ContentItemView['mediaStatus'], mediaKind: (row.mediaKind as ContentItemView['mediaKind']) ?? null, scheduledAt: row.scheduledAt?.toISOString() ?? null,
      status: row.status as ContentItemView['status'], sensitive: row.sensitive, issues: Array.isArray(row.issues) ? (row.issues as ContentIssue[]) : [], promptVersion: row.promptVersion, agentRunId: row.agentRunId,
      approvedAt: row.approvedAt?.toISOString() ?? null, rejectedReason: row.rejectedReason, externalId: row.externalId, externalUrl: row.externalUrl, publishedAt: row.publishedAt?.toISOString() ?? null,
      attempts: row.attempts, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, lastError: row.lastError, metrics: { ...metrics, history: metrics.history ?? [] }, measureCount: row.measureCount,
      measureDueAt: row.measureDueAt?.toISOString() ?? null, comments: comments.map(ContentService.commentView), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async row(id: string): Promise<ContentItemRow> {
    const [row] = await this.db.select().from(schema.contentItems).where(eq(schema.contentItems.id, id)).limit(1);
    if (!row) throw AppError.notFound('CONTENT_NOT_FOUND', 'Contenu introuvable');
    return row;
  }

  async view(id: string): Promise<ContentItemView> {
    const row = await this.row(id);
    const comments = await this.db.select().from(schema.contentComments).where(eq(schema.contentComments.contentItemId, id)).orderBy(desc(schema.contentComments.postedAt)).limit(100);
    return ContentService.view(row, comments);
  }

  /** Contenus d'une semaine (lundi), par espace puis par créneau ; 200 au plus. */
  async list(query: ContentListQuery): Promise<ContentItemView[]> {
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const week = query.week ?? weekStartOf(localClock(new Date(), tz).date);
    const conditions: SQL[] = [eq(schema.contentItems.weekOf, week)];
    if (query.space) conditions.push(eq(schema.contentItems.space, query.space));
    if (query.status) conditions.push(eq(schema.contentItems.status, query.status));
    const rows = await this.db.select().from(schema.contentItems).where(and(...conditions)).orderBy(asc(schema.contentItems.space), asc(schema.contentItems.scheduledAt), asc(schema.contentItems.createdAt)).limit(200);
    if (!rows.length) return [];
    const comments = await this.db.select().from(schema.contentComments).where(inArray(schema.contentComments.contentItemId, rows.map((r) => r.id))).orderBy(desc(schema.contentComments.postedAt));
    return rows.map((r) => ContentService.view(r, comments.filter((c) => c.contentItemId === r.id)));
  }

  /** Espaces et connecteurs : nom, configuré ou non, créneaux (réglage ou défauts), formats admis. */
  async spaces(): Promise<MarketingSpaceView[]> {
    const slots = parseSlots(await this.settings.get<unknown>('marketing.slots', null));
    return CONTENT_SPACES.map((space) => {
      const publisher = this.publishers.get(space);
      return { space, name: SPACE_RULES[space].name, provider: publisher?.name ?? 'none', configured: publisher?.configured ?? false, formats: [...SPACE_RULES[space].formats], slots: [...slots[space]] };
    });
  }

  /** Espaces dont le connecteur est configuré (le calendrier ne planifie que ceux-là). */
  configuredSpaces(): ContentSpace[] {
    return CONTENT_SPACES.filter((space) => this.publishers.get(space)?.configured);
  }

  async checkOptions(): Promise<ContentCheckOptions> {
    const [prices, phones, ctaUrls] = await Promise.all([
      this.settings.get<unknown>('marketing.allowed_prices', []),
      this.settings.get<unknown>('marketing.allowed_phones', []),
      this.settings.get<Record<string, unknown>>('marketing.cta_urls', {}),
    ]);
    const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
    const urls: ContentCheckOptions['ctaUrls'] = {};
    for (const key of ['reserve', 'academy', 'preregister'] as const) {
      const value = ctaUrls[key];
      if (typeof value === 'string' && value) urls[key] = value;
    }
    return { allowedPrices: strings(prices), allowedPhones: strings(phones), allowedEmailDomains: ['neomoov.net'], ctaUrls: urls };
  }

  static draftOf(row: Pick<ContentItemRow, 'space' | 'format' | 'language' | 'title' | 'body' | 'caption' | 'hashtags' | 'cta'>): ContentDraft {
    return { space: row.space as ContentSpace, format: row.format as ContentDraft['format'], language: row.language as ContentDraft['language'], title: row.title, body: row.body, caption: row.caption, hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [], cta: row.cta as CtaTarget };
  }

  /** Modification avant publication : règles réappliquées, sensibilité recalculée (un contenu modifié repasse en brouillon s'il était programmé). */
  async update(id: string, input: ContentUpdateInput, actor: ContentActor): Promise<ContentItemView> {
    const row = await this.row(id);
    if (!EDITABLE.includes(row.status)) throw AppError.conflict('CONTENT_NOT_EDITABLE', `Un contenu ${row.status} ne se modifie plus`);
    const hashtags = input.hashtags ? input.hashtags.map(normalizeHashtag).filter((h): h is string => Boolean(h)) : undefined;
    const next = {
      ...row,
      ...(input.title !== undefined ? { title: input.title } : {}), ...(input.body !== undefined ? { body: input.body } : {}), ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(hashtags ? { hashtags } : {}), ...(input.cta !== undefined ? { cta: input.cta } : {}), ...(input.visualHeadline !== undefined ? { visualHeadline: input.visualHeadline } : {}),
    };
    const issues = checkContent(ContentService.draftOf(next), await this.checkOptions());
    const sensitive = isSensitive(row.sensitive, issues);
    const textChanged = ['title', 'body', 'caption', 'hashtags', 'cta', 'visualHeadline'].some((k) => (input as Record<string, unknown>)[k] !== undefined);
    const [updated] = await this.db
      .update(schema.contentItems)
      .set({
        title: next.title, body: next.body, caption: next.caption, hashtags: next.hashtags as object, cta: next.cta, visualHeadline: next.visualHeadline, issues: issues as object, sensitive,
        ...(input.scheduledAt ? { scheduledAt: new Date(input.scheduledAt) } : {}),
        // Un texte modifié après approbation doit être relu : retour au brouillon, visuel à refaire.
        ...(textChanged && row.status !== 'draft' ? { status: 'draft', mediaStatus: VisualsService.expected(row.space as ContentSpace) ? 'pending' : 'none', approvedAt: null, approvedByUserId: null } : {}),
      })
      .where(eq(schema.contentItems.id, id))
      .returning();
    this.audit.record({ action: 'marketing.content_updated', entity: 'content_items', entityId: id, before: { status: row.status }, after: { status: updated!.status, fields: Object.keys(input), issues: issues.length, actor } });
    return this.view(id);
  }

  /** Créneau d'un contenu approuvé : celui déjà prévu s'il est à venir, sinon le prochain créneau de son espace. */
  private async slotFor(row: ContentItemRow, now: Date): Promise<Date> {
    if (row.scheduledAt && row.scheduledAt > now) return row.scheduledAt;
    const [tz, raw] = await Promise.all([this.settings.string('service.time_zone', 'America/Toronto'), this.settings.get<unknown>('marketing.slots', null)]);
    return assignSlots([{ space: row.space as ContentSpace }], row.weekOf, parseSlots(raw), tz, now)[0]!;
  }

  /**
   * Approbation (humain dans My Hub, ou agent contenu en mode automatique pour un contenu ni sensible ni bloqué) : le
   * contenu est programmé à son créneau, son visuel est mis en production. Un contenu sensible n'est jamais approuvé par un agent.
   */
  async approve(id: string, actor: ContentActor, now = new Date()): Promise<ContentItemView> {
    const row = await this.row(id);
    if (!APPROVABLE.includes(row.status)) throw AppError.conflict('CONTENT_NOT_APPROVABLE', `Un contenu ${row.status} ne s'approuve pas`);
    const issues = Array.isArray(row.issues) ? (row.issues as ContentIssue[]) : [];
    if (actor.agentCode && (row.sensitive || issues.some((i) => i.blocking))) throw AppError.forbidden('CONTENT_REQUIRES_HUMAN', 'Contenu sensible ou bloqué : approbation humaine obligatoire');
    const scheduledAt = await this.slotFor(row, now);
    const mediaStatus = VisualsService.expected(row.space as ContentSpace) && row.mediaStatus !== 'ready' ? 'pending' : row.mediaStatus;
    await this.db
      .update(schema.contentItems)
      .set({ status: 'scheduled', scheduledAt, approvedByUserId: actor.userId ?? null, approvedAt: now, rejectedReason: null, attempts: 0, nextAttemptAt: null, lastError: null, mediaStatus })
      .where(eq(schema.contentItems.id, id));
    this.audit.record({ action: 'marketing.content_approved', entity: 'content_items', entityId: id, before: { status: row.status }, after: { status: 'scheduled', scheduledAt: scheduledAt.toISOString(), space: row.space, agentCode: actor.agentCode ?? null } });
    if (mediaStatus === 'pending') await this.enqueueMedia(id);
    return this.view(id);
  }

  async reject(id: string, reason: string, actor: ContentActor): Promise<ContentItemView> {
    const row = await this.row(id);
    if (!EDITABLE.includes(row.status)) throw AppError.conflict('CONTENT_NOT_EDITABLE', `Un contenu ${row.status} ne se refuse plus`);
    await this.db.update(schema.contentItems).set({ status: 'rejected', rejectedReason: reason.slice(0, 500), scheduledAt: null }).where(eq(schema.contentItems.id, id));
    this.audit.record({ action: 'marketing.content_rejected', entity: 'content_items', entityId: id, before: { status: row.status }, after: { status: 'rejected', reason: reason.slice(0, 500), actor } });
    return this.view(id);
  }

  /** Production du visuel ou de la vidéo, en tâche différée (file `marketing`) ; un échec de mise en file est journalisé, la publication le rattrape. */
  async enqueueMedia(id: string): Promise<void> {
    try {
      await this.queues.add('marketing', 'media', { kind: 'media', itemId: id }, { jobId: `marketing-media-${id}` });
    } catch (error) {
      this.logger.warn({ err: error, itemId: id }, 'Production du média non mise en file');
    }
  }

  /** Fichier du média pour la visionneuse de My Hub (PNG, MP4 ou gabarit HTML) ; 404 sans média. */
  async media(id: string): Promise<{ body: Buffer; contentType: string }> {
    const row = await this.row(id);
    if (!row.mediaKey) throw AppError.notFound('CONTENT_MEDIA_NOT_FOUND', 'Aucun média pour ce contenu');
    const file = await this.storage.getObject(row.mediaKey);
    if (!file) throw AppError.notFound('CONTENT_MEDIA_NOT_FOUND', 'Média introuvable dans le stockage');
    return file;
  }
}
