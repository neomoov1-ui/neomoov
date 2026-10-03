/**
 * Publication multiréseau de My Hub (chantier « Réseaux sociaux » du 3 octobre 2026). Une publication (`content_groups`)
 * est un sujet décliné en un contenu par réseau (`content_items` liés par `group_id`) : texte adapté à chaque réseau
 * (domaine : `adaptForSpace`), visuel propre à chaque réseau à sa taille exacte (variante : gabarit, photo réelle,
 * recadrage, accent, position et texte différents, jamais deux images identiques), règles éditoriales appliquées.
 * Entrées : le composer (un sujet, publié tout de suite, à une heure donnée, aux prochains créneaux ou gardé en
 * brouillon) et l'import d'un lot JSON (docs/marketing/lancement-50-publications.schema.json), rejouable par campagne et
 * référence, puis « Approuver et programmer » en lot sur N jours selon `marketing.slots`. Diffusion : par le connecteur
 * du réseau, ou relais manuel (chaîne WhatsApp, Snapchat, réseau sans connecteur utilisable : décision du fondateur,
 * aucun agrégateur) avec la vue « À relayer » : texte prêt à copier, fichier à la bonne taille, lien direct, « Marquer
 * comme publié ». Commentaires et messages : compteurs par réseau de la boîte unifiée (canal `social`) et réponse par le
 * connecteur du réseau quand il existe.
 */
import { randomUUID } from 'node:crypto';
import { schema } from '@neomoov/db';
import {
  adaptForSpace, asUntrustedData, awaitsManualRelay, assignSlots, composeText, imageTextFor, isSensitive, localClock, mediaFileName, normalizeHashtag, parseSlots, planVariants, publicationAdaptOutputSchema, rankPhotos,
  MANUAL_RELAY_CODES, relayLink, RELAY_ONLY_SPACES, resolveSpaces, scheduleCampaign, shiftLocalDate, SOCIAL_NETWORKS, SPACE_RULES, thumbnailSize, visualSize, weekStartOf, zonedInstant,
  type ContentIssue, type ContentSpace, type ContentVisual, type CtaTarget, type DeliveryMode, type PublicationAdaptResult, type PublicationComposeInput, type PublicationGroupView, type PublicationImportResult,
  type PublicationInput, type PublicationItemView, type PublicationListQuery, type PublicationPublishInput, type PublicationScheduleInput, type PublicationScheduleResult, type PublicationsImport, type PublicationVariant,
  type RelayListView, type RelayTaskView, type SocialInboxSummaryView,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, like, lt, or, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { SITE_CONNECTOR, SOCIAL_PUBLISHERS, type SiteConnector, type SiteMediaItem, type SocialPublishers } from '../../adapters/marketing.types.js';
import { STORAGE_PROVIDER, type StorageProvider } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';
import { AgentRunnerService } from '../agents/agent-runner.service.js';
import { ConversationsService } from '../agents/conversations.service.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { CONTENT } from './content.agent.js';
import { ContentService, type ContentItemRow } from './content.service.js';
import { EditorialLinesService } from './editorial.js';

type GroupRow = typeof schema.contentGroups.$inferSelect;

/** Saisie normalisée d'une publication (composer ou lot), avec les valeurs par défaut du lot appliquées. */
interface PublicationDraftInput {
  ref: string | null;
  campaign: string | null;
  source: 'composer' | 'import';
  position: number;
  startDate: string | null;
  title: string;
  body: string;
  short: string;
  imageText: string | null;
  cta: CtaTarget;
  hashtags: string[];
  language: 'fr' | 'en';
  spaces: ContentSpace[];
  variants: Partial<Record<ContentSpace, PublicationVariant>>;
  photoHints: string[];
  day: number | null;
  scheduledAt: string | null;
  sensitive: boolean;
  pillar: string | null;
  audience: string | null;
  notes: string | null;
}

const SCHEDULABLE = ['draft', 'failed'];

@Injectable()
export class PublicationsService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(SOCIAL_PUBLISHERS) private readonly publishers: SocialPublishers,
    @Inject(SITE_CONNECTOR) private readonly site: SiteConnector,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly queues: QueueService,
    private readonly content: ContentService,
    private readonly runner: AgentRunnerService,
    private readonly editorial: EditorialLinesService,
    private readonly conversations: ConversationsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  /** Récapitulatifs du relais manuel déjà envoyés (date locale) : un seul par jour et par processus. */
  private readonly digests = new Set<string>();

  private get db() {
    return this.database.db;
  }

  private async timeZone(): Promise<string> {
    return this.settings.string('service.time_zone', 'America/Toronto');
  }

  // Vues ------------------------------------------------------------------------------------------------------------------

  static itemView(row: ContentItemRow): PublicationItemView {
    return {
      ...ContentService.view(row), groupId: row.groupId, delivery: row.delivery as DeliveryMode, visual: (row.visual as ContentVisual | null) ?? null, relayedAt: row.relayedAt?.toISOString() ?? null,
      notice: row.publishNotice ?? null, awaitsRelay: awaitsManualRelay(row),
    };
  }

  static groupView(group: GroupRow, items: ContentItemRow[]): PublicationGroupView {
    const views = items.map(PublicationsService.itemView);
    const blocking = (i: PublicationItemView) => i.issues.some((x) => x.blocking);
    return {
      id: group.id, campaign: group.campaign, ref: group.ref, source: group.source as 'composer' | 'import', title: group.title, body: group.body, short: group.shortText, imageText: group.imageText,
      cta: group.cta as CtaTarget, hashtags: Array.isArray(group.hashtags) ? (group.hashtags as string[]) : [], photoHints: Array.isArray(group.photoHints) ? (group.photoHints as string[]) : [], day: group.day,
      pillar: group.pillar, notes: group.notes, items: views,
      counts: {
        draft: views.filter((i) => i.status === 'draft').length,
        scheduled: views.filter((i) => i.status === 'scheduled' && !i.awaitsRelay).length,
        published: views.filter((i) => i.status === 'published' || i.status === 'measured').length,
        failed: views.filter((i) => i.status === 'failed' && !i.awaitsRelay).length,
        relay: views.filter((i) => i.awaitsRelay).length,
        rejected: views.filter((i) => i.status === 'rejected').length,
        blocked: views.filter((i) => i.status === 'draft' && blocking(i)).length,
      },
      createdAt: group.createdAt.toISOString(),
    };
  }

  private async itemsOf(groupIds: string[]): Promise<ContentItemRow[]> {
    if (!groupIds.length) return [];
    return this.db.select().from(schema.contentItems).where(inArray(schema.contentItems.groupId, groupIds)).orderBy(asc(schema.contentItems.createdAt));
  }

  async get(id: string): Promise<PublicationGroupView> {
    const [group] = await this.db.select().from(schema.contentGroups).where(eq(schema.contentGroups.id, id)).limit(1);
    if (!group) throw AppError.notFound('PUBLICATION_NOT_FOUND', 'Publication introuvable');
    return PublicationsService.groupView(group, await this.itemsOf([id]));
  }

  /** Publications les plus récentes d'abord (ou d'une campagne, dans l'ordre du lot). */
  async list(query: PublicationListQuery): Promise<PublicationGroupView[]> {
    const groups = await this.db
      .select()
      .from(schema.contentGroups)
      .where(query.campaign ? eq(schema.contentGroups.campaign, query.campaign) : undefined)
      .orderBy(query.campaign ? asc(schema.contentGroups.createdAt) : desc(schema.contentGroups.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    const items = await this.itemsOf(groups.map((g) => g.id));
    return groups.map((g) => PublicationsService.groupView(g, items.filter((i) => i.groupId === g.id)));
  }

  // Diffusion ---------------------------------------------------------------------------------------------------------------

  /**
   * Diffusion d'un réseau : relais manuel pour la chaîne WhatsApp et Snapchat (aucune API ouverte), pour les réseaux
   * forcés en manuel par le réglage `marketing.relay_spaces`, et pour tout réseau sans connecteur utilisable (non
   * configuré, approbation du réseau en attente) ; sinon le connecteur publie.
   */
  async deliveryFor(space: ContentSpace): Promise<DeliveryMode> {
    if (RELAY_ONLY_SPACES.includes(space)) return 'manual';
    const forced = await this.settings.get<unknown>('marketing.relay_spaces', []);
    if (Array.isArray(forced) && forced.includes(space)) return 'manual';
    return this.publishers.get(space)?.configured === true ? 'auto' : 'manual';
  }

  /** Photos réelles de la médiathèque du site, classées selon les mots donnés ; liste vide sans médiathèque (jamais d'image inventée). */
  private async photos(hints: readonly string[]): Promise<SiteMediaItem[]> {
    try {
      return rankPhotos(await this.site.mediaLibrary(40), hints);
    } catch (error) {
      this.logger.warn({ err: error }, 'Médiathèque du site indisponible : visuels sans photo');
      return [];
    }
  }

  // Création ----------------------------------------------------------------------------------------------------------------

  private normalize(input: PublicationInput | PublicationComposeInput, meta: { campaign: string | null; source: 'composer' | 'import'; position: number; startDate: string | null; defaults?: PublicationsImport['defaults'] }): PublicationDraftInput {
    const d = meta.defaults ?? {};
    const spaces = resolveSpaces((input.spaces ?? d.spaces ?? 'all') as 'all' | ContentSpace[]);
    return {
      ref: input.ref ?? null, campaign: meta.campaign, source: meta.source, position: meta.position, startDate: meta.startDate,
      title: input.title.trim(), body: input.body.trim(), short: input.short.trim(), imageText: input.imageText?.trim() || null,
      cta: input.cta ?? d.cta ?? 'none', hashtags: [...(input.hashtags ?? d.hashtags ?? [])], language: input.language ?? d.language ?? 'fr', spaces,
      variants: (input.variants ?? {}) as Partial<Record<ContentSpace, PublicationVariant>>, photoHints: [...(input.photoHints ?? [])],
      day: 'day' in input && typeof input.day === 'number' ? input.day : null, scheduledAt: 'scheduledAt' in input && typeof input.scheduledAt === 'string' ? input.scheduledAt : null,
      sensitive: input.sensitive ?? false, pillar: input.pillar ?? null, audience: input.audience ?? null, notes: input.notes ?? null,
    };
  }

  /**
   * Crée une publication et ses contenus en brouillon : texte adapté par réseau, règles appliquées, variante de visuel
   * propre à chaque contenu (photo différente par réseau quand la médiathèque le permet), visuels mis en production.
   * Une publication déjà importée (même campagne, même référence) n'est pas recréée : `existing` est vrai.
   */
  private async createGroup(input: PublicationDraftInput, userId: string | null, now: Date): Promise<{ group: GroupRow; items: ContentItemRow[]; existing: boolean }> {
    if (input.campaign && input.ref) {
      const [found] = await this.db.select().from(schema.contentGroups).where(and(eq(schema.contentGroups.campaign, input.campaign), eq(schema.contentGroups.ref, input.ref))).limit(1);
      if (found) return { group: found, items: await this.itemsOf([found.id]), existing: true };
    }
    const options = await this.content.checkOptions();
    const base = { title: input.title, body: input.body, short: input.short, imageText: input.imageText, cta: input.cta, hashtags: input.hashtags, language: input.language };
    const adapted = input.spaces.flatMap((space) => adaptForSpace(space, base, input.variants[space as keyof typeof input.variants], options).map((a) => ({ space, ...a })));
    if (!adapted.length) throw new AppError('VALIDATION_ERROR', 'Aucun réseau visé', 400);
    const photos = await this.photos(input.photoHints.length ? input.photoHints : [input.title]);
    const seed = `${input.campaign ?? 'composer'}:${input.ref ?? randomUUID()}`;
    const variants = planVariants(seed, adapted.map((a) => ({ space: a.space, language: a.draft.language, imageText: a.imageText })), photos.length);
    const [group] = await this.db
      .insert(schema.contentGroups)
      .values({
        campaign: input.campaign, ref: input.ref, source: input.source, title: input.title.slice(0, 200), body: input.body, shortText: input.short.slice(0, 300), imageText: input.imageText?.slice(0, 80) ?? null,
        cta: input.cta, hashtags: input.hashtags.map(normalizeHashtag).filter(Boolean) as object, photoHints: input.photoHints as object, day: input.day, pillar: input.pillar, audience: input.audience,
        notes: input.notes, sensitive: input.sensitive, createdByUserId: userId,
        input: { spaces: input.spaces, variants: input.variants, position: input.position, startDate: input.startDate, scheduledAt: input.scheduledAt } as object,
      })
      .onConflictDoNothing()
      .returning();
    if (!group) {
      // Import concurrent de la même référence : la publication existe déjà.
      const [found] = await this.db.select().from(schema.contentGroups).where(and(eq(schema.contentGroups.campaign, input.campaign ?? ''), eq(schema.contentGroups.ref, input.ref ?? ''))).limit(1);
      if (!found) throw AppError.conflict('PUBLICATION_CONFLICT', 'Publication en cours de création');
      return { group: found, items: await this.itemsOf([found.id]), existing: true };
    }
    const tz = await this.timeZone();
    const weekOf = weekStartOf(localClock(now, tz).date);
    const deliveries = new Map<ContentSpace, DeliveryMode>();
    for (const space of input.spaces) deliveries.set(space, await this.deliveryFor(space));
    const rows = await this.db
      .insert(schema.contentItems)
      .values(adapted.map((a, index) => {
        const variant = variants[index]!;
        const photo = variant.photoIndex === null ? null : (photos[variant.photoIndex] ?? null);
        const dims = visualSize(a.space, a.draft.format);
        const visual: ContentVisual = { ...variant, width: dims.width, height: dims.height, photoUrl: photo?.url ?? null, photoCredit: photo?.alt ?? null, fingerprint: null, thumbnailKey: null };
        return {
          weekOf, space: a.space, format: a.draft.format, language: a.draft.language, title: a.draft.title, body: a.draft.body, caption: a.draft.caption, hashtags: [...a.draft.hashtags] as object, cta: a.draft.cta,
          visualHeadline: a.imageText.slice(0, 160), mediaStatus: 'pending', status: 'draft', sensitive: isSensitive(input.sensitive, a.issues), issues: a.issues as object,
          groupId: group.id, delivery: deliveries.get(a.space) ?? 'manual', visual: visual as object,
        };
      }))
      .returning();
    this.audit.record({ action: 'marketing.publication_created', entity: 'content_groups', entityId: group.id, after: { source: input.source, campaign: input.campaign, ref: input.ref, items: rows.length, spaces: input.spaces, blocked: adapted.filter((a) => a.issues.some((i) => i.blocking)).length } });
    for (const row of rows) await this.content.enqueueMedia(row.id);
    return { group, items: rows, existing: false };
  }

  /**
   * Programme un contenu (décision humaine) : à l'instant donné, diffusion recalculée (connecteur ou relais manuel),
   * visuel mis en production s'il manque. La semaine du calendrier suit la date de diffusion.
   */
  private async scheduleItem(row: ContentItemRow, at: Date, userId: string | null, now: Date): Promise<ContentItemRow> {
    const tz = await this.timeZone();
    const delivery = await this.deliveryFor(row.space as ContentSpace);
    const mediaStatus = row.mediaStatus === 'ready' || row.mediaStatus === 'html' ? row.mediaStatus : 'pending';
    const [updated] = await this.db
      .update(schema.contentItems)
      .set({ status: 'scheduled', scheduledAt: at, weekOf: weekStartOf(localClock(at, tz).date), delivery, approvedByUserId: userId, approvedAt: now, rejectedReason: null, attempts: 0, nextAttemptAt: null, lastError: null, mediaStatus })
      .where(and(eq(schema.contentItems.id, row.id), inArray(schema.contentItems.status, SCHEDULABLE)))
      .returning();
    if (!updated) throw AppError.conflict('CONTENT_NOT_APPROVABLE', `Un contenu ${row.status} ne se programme pas`);
    this.audit.record({ action: 'marketing.content_approved', entity: 'content_items', entityId: row.id, before: { status: row.status }, after: { status: 'scheduled', scheduledAt: at.toISOString(), space: row.space, delivery, groupId: row.groupId } });
    if (mediaStatus === 'pending') await this.content.enqueueMedia(row.id);
    return updated;
  }

  /** Composer : crée la publication, puis la diffuse selon `schedule` (`publishGroup`), ou la garde en brouillons pour l'aperçu. */
  async compose(input: PublicationComposeInput, userId: string, now = new Date()): Promise<PublicationGroupView> {
    const draft = this.normalize(input, { campaign: null, source: 'composer', position: 0, startDate: null });
    const { group } = await this.createGroup(draft, userId, now);
    if (input.schedule.mode === 'draft') return this.get(group.id);
    return this.publishGroup(group.id, input.schedule, userId, now);
  }

  /**
   * Diffuse les brouillons d'une publication (après l'aperçu des visuels, ou directement depuis le composer) : tout de
   * suite, à une heure donnée ou aux prochains créneaux de chaque réseau. Un contenu qui touche une règle bloquante reste
   * en brouillon, à corriger ; un contenu en relais manuel apparaît dans « À relayer » à son heure.
   */
  async publishGroup(groupId: string, schedule: PublicationPublishInput['schedule'], userId: string, now = new Date()): Promise<PublicationGroupView> {
    const items = (await this.itemsOf([groupId])).filter((i) => SCHEDULABLE.includes(i.status));
    if (!items.length) {
      await this.get(groupId);
      throw AppError.conflict('PUBLICATION_NOTHING_TO_PUBLISH', 'Aucun brouillon à diffuser dans cette publication');
    }
    const ready = items.filter((i) => !(i.issues as ContentIssue[]).some((x) => x.blocking));
    let instants: Date[];
    if (schedule.mode === 'slots') {
      const [tz, raw] = await Promise.all([this.timeZone(), this.settings.get<unknown>('marketing.slots', null)]);
      instants = assignSlots(ready.map((r) => ({ space: r.space as ContentSpace })), weekStartOf(localClock(now, tz).date), parseSlots(raw), tz, now);
    } else {
      const at = schedule.mode === 'at' ? new Date(schedule.at) : now;
      if (schedule.mode === 'at' && at.getTime() < now.getTime() - 60_000) throw new AppError('VALIDATION_ERROR', 'L\'heure de diffusion est déjà passée', 400);
      instants = ready.map(() => at);
    }
    for (const [index, row] of ready.entries()) {
      const scheduled = await this.scheduleItem(row, instants[index]!, userId, now);
      // « Publier maintenant » : la file publie dès que le visuel est prêt (la passe de cinq minutes rattrape un échec de mise en file).
      if (schedule.mode === 'now' && scheduled.delivery === 'auto') {
        await this.queues.add('marketing', 'publish', { kind: 'publish', itemId: row.id }, { jobId: `marketing-publish-${row.id}` }).catch((error: unknown) => this.logger.warn({ err: error, itemId: row.id }, 'Publication immédiate non mise en file'));
      }
    }
    return this.get(groupId);
  }

  /** Import d'un lot (format docs/marketing/lancement-50-publications.schema.json) : brouillons groupés, rejouable sans doublon. */
  async importBatch(payload: PublicationsImport, userId: string, now = new Date()): Promise<PublicationImportResult> {
    const result: PublicationImportResult = { campaign: payload.campaign, created: 0, existing: 0, items: 0, blocked: 0, groups: [] };
    for (const [position, publication] of payload.publications.entries()) {
      const draft = this.normalize(publication, { campaign: payload.campaign, source: 'import', position, startDate: payload.startDate ?? null, defaults: payload.defaults });
      const { group, items, existing } = await this.createGroup(draft, userId, now);
      const blocked = items.filter((i) => (i.issues as ContentIssue[]).some((x) => x.blocking)).length;
      result.groups.push({ id: group.id, ref: publication.ref, items: items.length, blocked, existing });
      if (existing) result.existing += 1;
      else {
        result.created += 1;
        result.items += items.length;
        result.blocked += blocked;
      }
    }
    this.audit.record({ action: 'marketing.publications_imported', entity: 'content_groups', after: { campaign: payload.campaign, created: result.created, existing: result.existing, items: result.items, blocked: result.blocked } });
    return result;
  }

  /**
   * « Approuver et programmer » en lot : les publications d'une campagne (ou choisies) sont réparties sur des jours de
   * diffusion (`days` jours, ou `perDay` par jour ; jour ou instant du lot respectés) et chaque réseau prend son créneau.
   * Jamais en lot : un contenu bloqué par une règle ou sensible (approbation un par un dans le calendrier).
   */
  async scheduleBatch(input: PublicationScheduleInput, userId: string, now = new Date()): Promise<PublicationScheduleResult> {
    const conditions = [];
    if (input.campaign) conditions.push(eq(schema.contentGroups.campaign, input.campaign));
    if (input.groupIds?.length) conditions.push(inArray(schema.contentGroups.id, input.groupIds));
    const groups = (await this.db.select().from(schema.contentGroups).where(and(...conditions))).sort((a, b) => ((a.input as { position?: number }).position ?? 0) - ((b.input as { position?: number }).position ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
    if (!groups.length) throw AppError.notFound('PUBLICATION_NOT_FOUND', 'Aucune publication pour cette sélection');
    const items = await this.itemsOf(groups.map((g) => g.id));
    const result: PublicationScheduleResult = { approved: 0, relay: 0, skipped: [], firstAt: null, lastAt: null };
    const plan: Array<{ group: GroupRow; rows: ContentItemRow[] }> = [];
    for (const group of groups) {
      const rows: ContentItemRow[] = [];
      for (const row of items.filter((i) => i.groupId === group.id)) {
        if (!SCHEDULABLE.includes(row.status)) continue;
        const issues = row.issues as ContentIssue[];
        if (issues.some((i) => i.blocking)) result.skipped.push({ itemId: row.id, space: row.space, reason: `Règle bloquante : ${issues.filter((i) => i.blocking).map((i) => i.detail).join(' ; ').slice(0, 300)}` });
        else if (row.sensitive || group.sensitive) result.skipped.push({ itemId: row.id, space: row.space, reason: 'Sujet sensible : approbation humaine un par un' });
        else rows.push(row);
      }
      if (rows.length) plan.push({ group, rows });
    }
    if (!plan.length) return result;
    const [tz, raw] = await Promise.all([this.timeZone(), this.settings.get<unknown>('marketing.slots', null)]);
    const first = groups[0]!.input as { startDate?: string | null };
    const startDate = input.startDate ?? first.startDate ?? localClock(now, tz).date;
    const perDay = input.perDay ?? (input.days ? Math.ceil(plan.length / input.days) : await this.settings.number('marketing.publications_per_day', 5));
    const instants = scheduleCampaign(
      plan.map(({ group, rows }) => {
        const at = (group.input as { scheduledAt?: string | null }).scheduledAt;
        return { day: group.day ?? null, at: at && new Date(at).getTime() > now.getTime() ? new Date(at) : null, spaces: rows.map((r) => r.space as ContentSpace) };
      }),
      startDate, parseSlots(raw), tz, now, perDay,
    );
    for (const [g, { rows }] of plan.entries()) {
      for (const [i, row] of rows.entries()) {
        const at = instants[g]![i]!;
        const scheduled = await this.scheduleItem(row, at, userId, now);
        result.approved += 1;
        if (scheduled.delivery === 'manual') result.relay += 1;
        if (!result.firstAt || at.toISOString() < result.firstAt) result.firstAt = at.toISOString();
        if (!result.lastAt || at.toISOString() > result.lastAt) result.lastAt = at.toISOString();
      }
    }
    this.audit.record({ action: 'marketing.publications_scheduled', entity: 'content_groups', after: { campaign: input.campaign ?? null, groups: plan.length, approved: result.approved, relay: result.relay, skipped: result.skipped.length, startDate, perDay } });
    return result;
  }

  // Relais manuel -------------------------------------------------------------------------------------------------------------

  private async relayTask(row: ContentItemRow, group: GroupRow | null, now: Date, ctaUrls: Readonly<Partial<Record<CtaTarget, string | null>>>): Promise<RelayTaskView> {
    const space = row.space as ContentSpace;
    const hashtags = Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [];
    const ctaUrl = row.cta === 'none' ? null : (ctaUrls[row.cta as CtaTarget] ?? null);
    const text = composeText({ space, title: row.title, body: row.body, caption: row.caption, hashtags, ctaUrl });
    const visual = row.visual as ContentVisual | null;
    const dims = visual ? { width: visual.width, height: visual.height } : visualSize(space, row.format as PublicationItemView['format']);
    const kind = row.mediaKind === 'video' ? 'video' : 'image';
    const thumb = thumbnailSize(space);
    return {
      item: PublicationsService.itemView(row), groupTitle: group?.title ?? null, text: SPACE_RULES[space].requiresTitle && row.title ? `${row.title}\n\n${text}` : text,
      link: relayLink(space, text), fileName: row.mediaKey && row.mediaKind !== 'html' ? mediaFileName(space, dims, kind, group?.ref) : null,
      thumbnailFileName: visual?.thumbnailKey && thumb ? mediaFileName(space, thumb, 'thumbnail', group?.ref) : null,
      late: Boolean(row.scheduledAt && row.scheduledAt.getTime() < now.getTime()),
    };
  }

  /**
   * Tâches « À relayer » d'un jour (aujourd'hui par défaut) : contenus en relais manuel programmés jusqu'à la fin du jour,
   * retards compris, et contenus refusés par leur connecteur avec un code de relais manuel (compte en mode manuel,
   * approbation du réseau en attente : `SOCIAL_MANUAL_RELAY`, `SOCIAL_APPROVAL_PENDING`), présentés comme des tâches.
   */
  async relayList(date: string | undefined, now = new Date()): Promise<RelayListView> {
    const tz = await this.timeZone();
    const day = date ?? localClock(now, tz).date;
    const end = zonedInstant(shiftLocalDate(day, 1), '00:00', tz);
    const start = zonedInstant(day, '00:00', tz);
    const rows = await this.db
      .select()
      .from(schema.contentItems)
      .where(and(
        lt(schema.contentItems.scheduledAt, end),
        or(
          and(eq(schema.contentItems.delivery, 'manual'), eq(schema.contentItems.status, 'scheduled')),
          and(eq(schema.contentItems.status, 'failed'), or(...MANUAL_RELAY_CODES.map((code) => like(schema.contentItems.lastError, `${code}%`)))),
        ),
      ))
      .orderBy(asc(schema.contentItems.scheduledAt))
      .limit(200);
    const groupIds = [...new Set(rows.map((r) => r.groupId).filter((g): g is string => Boolean(g)))];
    const groups = groupIds.length ? await this.db.select().from(schema.contentGroups).where(inArray(schema.contentGroups.id, groupIds)) : [];
    const { ctaUrls } = await this.content.checkOptions();
    const tasks: RelayTaskView[] = [];
    for (const row of rows) tasks.push(await this.relayTask(row, groups.find((g) => g.id === row.groupId) ?? null, now, ctaUrls));
    const [done] = await this.db.select({ n: sql<number>`count(*)::int` }).from(schema.contentItems).where(and(gte(schema.contentItems.relayedAt, start), lt(schema.contentItems.relayedAt, end)));
    return { date: day, tasks, doneToday: Number(done?.n ?? 0) };
  }

  /**
   * Récapitulatif quotidien du relais manuel : à partir de l'heure réglée (`marketing.relay_digest_hour`, 8 h, heure de
   * Montréal ; -1 le coupe), une alerte au personnel avec le nombre de publications à relayer aujourd'hui, retards compris.
   */
  async relayDigest(now = new Date()): Promise<number> {
    const tz = await this.timeZone();
    const clock = localClock(now, tz);
    const hour = await this.settings.number('marketing.relay_digest_hour', 8);
    if (hour < 0 || clock.hour < hour || this.digests.has(clock.date)) return 0;
    this.digests.add(clock.date);
    const { tasks } = await this.relayList(clock.date, now);
    if (!tasks.length) return 0;
    const bySpace = new Map<string, number>();
    for (const task of tasks) bySpace.set(task.item.space, (bySpace.get(task.item.space) ?? 0) + 1);
    const detail = [...bySpace.entries()].map(([space, n]) => `${SPACE_RULES[space as ContentSpace].name} ${n}`).join(', ');
    await this.outbox.queueForStaff('alert.agent_escalation', { reason: 'marketing_relay_digest', summary: `${tasks.length} publication(s) à relayer à la main aujourd'hui (${detail}) : My Hub, Marketing, Publier, À relayer` });
    return tasks.length;
  }

  /** Relais fait : le contenu est publié (lien de la publication facultatif). Aucune mesure ni lecture des commentaires sans connecteur. */
  async markRelayed(id: string, url: string | null, userId: string, now = new Date()): Promise<PublicationItemView> {
    const row = await this.content.row(id);
    if (!awaitsManualRelay(row)) throw AppError.conflict('CONTENT_NOT_RELAYABLE', `Un contenu ${row.status} (${row.delivery === 'manual' ? 'relais manuel' : 'connecteur'}) ne se marque pas publié à la main`);
    const [updated] = await this.db
      .update(schema.contentItems)
      .set({ status: 'published', delivery: 'manual', publishedAt: now, externalUrl: url, relayedAt: now, relayedByUserId: userId, nextAttemptAt: null, lastError: null })
      .where(and(eq(schema.contentItems.id, id), eq(schema.contentItems.status, row.status), eq(schema.contentItems.attempts, row.attempts)))
      .returning();
    if (!updated) throw AppError.conflict('CONTENT_NOT_RELAYABLE', 'Contenu déjà marqué publié');
    this.audit.record({ action: 'marketing.content_relayed', entity: 'content_items', entityId: id, before: { status: row.status }, after: { status: 'published', space: row.space, url } });
    return PublicationsService.itemView(updated);
  }

  /** Fichier à télécharger (visuel, vidéo ou miniature) avec son nom à la bonne taille. */
  async download(id: string, asset: 'main' | 'thumbnail'): Promise<{ body: Buffer; contentType: string; fileName: string }> {
    const row = await this.content.row(id);
    const visual = row.visual as ContentVisual | null;
    const key = asset === 'thumbnail' ? visual?.thumbnailKey : row.mediaKey;
    if (!key) throw AppError.notFound('CONTENT_MEDIA_NOT_FOUND', 'Aucun fichier pour ce contenu');
    const file = await this.storage.getObject(key);
    if (!file) throw AppError.notFound('CONTENT_MEDIA_NOT_FOUND', 'Fichier introuvable dans le stockage');
    const [group] = row.groupId ? await this.db.select({ ref: schema.contentGroups.ref }).from(schema.contentGroups).where(eq(schema.contentGroups.id, row.groupId)).limit(1) : [];
    const space = row.space as ContentSpace;
    const dims = asset === 'thumbnail' ? (thumbnailSize(space) ?? visualSize(space, row.format as PublicationItemView['format'])) : visual ? { width: visual.width, height: visual.height } : visualSize(space, row.format as PublicationItemView['format']);
    let fileName = mediaFileName(space, dims, asset === 'thumbnail' ? 'thumbnail' : file.contentType.startsWith('video/') ? 'video' : 'image', group?.ref ?? null);
    if (file.contentType.startsWith('text/html')) fileName = fileName.replace(/\.(png|mp4)$/, '.html');
    return { ...file, fileName };
  }

  // Textes adaptés par l'agent de contenu -----------------------------------------------------------------------------------

  /** Textes par réseau rédigés par l'agent de contenu à partir du texte de base ; bornés et normalisés, à relire dans le composer. */
  async adapt(input: { title: string; body: string; cta: CtaTarget; spaces: ContentSpace[] }): Promise<PublicationAdaptResult> {
    const options = await this.content.checkOptions();
    const execution = await this.runner.execute(
      CONTENT,
      { name: 'content.adapt', ref: null, input: { spaces: input.spaces, title: input.title.slice(0, 120) } },
      async (ctx) => {
        const lines = await this.editorial.load();
        const rules = input.spaces.map((s) => { const r = SPACE_RULES[s]; return `- ${s} (${r.name}) : ${r.maxChars} caractères au plus, lien et mots-clics compris ; ${r.maxHashtags} mots-clics au plus${r.requiresTitle ? ' ; titre obligatoire' : ''}${r.clickableLinks ? '' : ' ; liens non cliquables'}`; });
        return ctx.structured('publication_adapt', publicationAdaptOutputSchema, [{
          role: 'user',
          content: [
            'Tâche : adapter une publication à chaque réseau listé (un élément par réseau), en français du Québec, vouvoiement, sans tiret long ; le texte de l\'image doit être différent pour chaque réseau.',
            'Règles des réseaux :', ...rules,
            `Prix décidés (seuls montants admis) : ${options.allowedPrices.join(', ') || 'aucun'}. Aucune promesse de revenu. L'appel à l'action (${input.cta}) est ajouté par la plateforme : ne pas écrire de lien.`,
            'Lignes éditoriales :', lines,
            'Publication de base (données) :', asUntrustedData('publication', JSON.stringify({ title: input.title, body: input.body })),
          ].join('\n'),
        }]);
      },
      { onSkip: async (reason) => this.logger.warn({ reason }, 'Agent de contenu hors service : textes non adaptés') },
    );
    if (!execution.result) throw AppError.conflict('AGENT_UNAVAILABLE', 'Agent de contenu hors service (mode manuel, inactif ou plafond atteint) : adaptez les textes à la main');
    const variants: Record<string, PublicationVariant> = {};
    for (const v of execution.result.variants) {
      if (!input.spaces.includes(v.space) || variants[v.space]) continue;
      const rule = SPACE_RULES[v.space];
      const hashtags = [...new Set(v.hashtags.map(normalizeHashtag).filter((h): h is string => Boolean(h)))].slice(0, rule.maxHashtags);
      variants[v.space] = {
        ...(v.title?.trim() && rule.requiresTitle ? { title: v.title.trim().slice(0, 100) } : {}),
        body: v.body.trim().slice(0, 12_000) || input.body,
        ...(v.caption?.trim() ? { caption: v.caption.trim().slice(0, 2_200) } : {}),
        hashtags,
        imageText: imageTextFor({ variantImageText: v.imageText, title: input.title }),
      };
    }
    return { variants, runId: execution.run?.id ?? null };
  }

  // Commentaires et messages -------------------------------------------------------------------------------------------------

  /** Compteurs de la boîte unifiée (canal `social`) par réseau : non lus (dernier message reçu), remis à l'humain, réponses à relayer, ouverts. */
  async socialSummary(): Promise<SocialInboxSummaryView> {
    const pending = sql`EXISTS (SELECT 1 FROM conversation_messages r WHERE r.conversation_id = conversations.id AND r.relay_status = 'pending')`;
    const lastInbound = sql`(SELECT l.direction FROM conversation_messages l WHERE l.conversation_id = conversations.id ORDER BY l.created_at DESC LIMIT 1) = 'inbound'`;
    const rows = await this.db
      .select({
        network: schema.conversations.network,
        unread: sql<number>`count(*) FILTER (WHERE ${schema.conversations.status} = 'open' AND NOT ${pending} AND ${lastInbound})::int`,
        escalated: sql<number>`count(*) FILTER (WHERE ${schema.conversations.status} = 'escalated')::int`,
        relayPending: sql<number>`count(*) FILTER (WHERE ${pending})::int`,
        open: sql<number>`count(*)::int`,
      })
      .from(schema.conversations)
      .where(and(eq(schema.conversations.channel, 'social'), sql`${schema.conversations.status} <> 'closed'`, sql`${schema.conversations.network} IS NOT NULL`))
      .groupBy(schema.conversations.network);
    const networks = SOCIAL_NETWORKS.map((network) => {
      const r = rows.find((x) => x.network === network);
      return { network, unread: Number(r?.unread ?? 0), escalated: Number(r?.escalated ?? 0), relayPending: Number(r?.relayPending ?? 0), open: Number(r?.open ?? 0) };
    });
    return { networks, total: { unread: networks.reduce((n, x) => n + x.unread, 0), escalated: networks.reduce((n, x) => n + x.escalated, 0), relayPending: networks.reduce((n, x) => n + x.relayPending, 0) } };
  }

  /**
   * Réponse à un commentaire en attente de relais, envoyée par le connecteur du réseau quand il existe (commentaire relu
   * par l'agent de diffusion sur une publication de la plateforme) ; sinon refus clair et relais manuel dans la boîte.
   */
  async sendReply(messageId: string, userId: string) {
    const [message] = await this.db.select().from(schema.conversationMessages).where(and(eq(schema.conversationMessages.id, messageId), eq(schema.conversationMessages.relayStatus, 'pending'))).limit(1);
    if (!message) throw AppError.notFound('RELAY_NOT_PENDING', 'Aucune réponse en attente de relais pour ce message');
    const inbound = await this.db
      .select({ metadata: schema.conversationMessages.metadata })
      .from(schema.conversationMessages)
      .where(and(eq(schema.conversationMessages.conversationId, message.conversationId), eq(schema.conversationMessages.direction, 'inbound')))
      .orderBy(desc(schema.conversationMessages.createdAt))
      .limit(10);
    const ref = inbound.map((m) => m.metadata as { contentItemId?: unknown; commentId?: unknown } | null).find((m) => typeof m?.contentItemId === 'string' && typeof m.commentId === 'string');
    if (!ref) throw AppError.conflict('RELAY_NO_CONNECTOR', 'Ce message ne vient pas d\'une publication suivie par la plateforme : réponse à coller sur le réseau');
    const item = await this.content.row(String(ref.contentItemId));
    const publisher = this.publishers.get(item.space as ContentSpace);
    if (!publisher?.configured || !item.externalId) throw AppError.conflict('RELAY_NO_CONNECTOR', `${SPACE_RULES[item.space as ContentSpace].name} : aucun connecteur utilisable, réponse à coller sur le réseau`);
    await publisher.replyComment({ itemId: item.id, externalId: item.externalId, externalUrl: item.externalUrl }, String(ref.commentId), message.body);
    this.audit.record({ action: 'marketing.comment_replied', entity: 'conversation_messages', entityId: messageId, after: { space: item.space, contentItemId: item.id } });
    return this.conversations.markRelayed(messageId, userId);
  }
}

