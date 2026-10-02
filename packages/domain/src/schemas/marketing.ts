/**
 * Schémas du marketing automatisé (phase 1 « entreprise autonome ») : contenus du calendrier (vue My Hub, modification,
 * décision), sorties structurées des agents `content` et `seo`, tâches de référencement, espaces et connecteurs.
 */
import { z } from 'zod';
import { CONTENT_FORMATS, CONTENT_ISSUE_KINDS, CONTENT_LANGUAGES, CONTENT_SPACES, CONTENT_STATUSES, CTA_TARGETS, MEDIA_STATUSES, SEO_ACTIONS, SEO_TARGET_KINDS, SEO_TASK_STATUSES, COMMENT_INTENTS } from '../marketing/index.js';
import { agentRunSchema } from './agents.js';
import { isoDate, localDateString, uuid } from './common.js';

const count = z.number().int().min(0);

export const contentIssueSchema = z.object({ kind: z.enum(CONTENT_ISSUE_KINDS), detail: z.string(), blocking: z.boolean() });

export const contentMetricsSchema = z.object({
  reach: count,
  interactions: count,
  clicks: count,
  measuredAt: isoDate.nullable(),
  history: z.array(z.object({ at: isoDate, day: z.number().int(), reach: count, interactions: count, clicks: count })),
});

export const contentCommentSchema = z.object({
  id: uuid,
  externalId: z.string(),
  author: z.string().nullable(),
  body: z.string(),
  postedAt: isoDate,
  intent: z.enum(COMMENT_INTENTS),
  outcome: z.enum(['replied', 'forwarded', 'escalated', 'ignored']),
  replyBody: z.string().nullable(),
  createdAt: isoDate,
});
export type ContentCommentView = z.infer<typeof contentCommentSchema>;

/** Contenu du calendrier, tel que My Hub le voit. */
export const contentItemSchema = z.object({
  id: uuid,
  weekOf: localDateString,
  space: z.enum(CONTENT_SPACES),
  format: z.enum(CONTENT_FORMATS),
  language: z.enum(CONTENT_LANGUAGES),
  title: z.string().nullable(),
  body: z.string(),
  caption: z.string().nullable(),
  hashtags: z.array(z.string()),
  cta: z.enum(CTA_TARGETS),
  visualHeadline: z.string().nullable(),
  mediaStatus: z.enum(MEDIA_STATUSES),
  mediaKind: z.enum(['image', 'video', 'html']).nullable(),
  scheduledAt: isoDate.nullable(),
  status: z.enum(CONTENT_STATUSES),
  sensitive: z.boolean(),
  issues: z.array(contentIssueSchema),
  promptVersion: z.string().nullable(),
  agentRunId: uuid.nullable(),
  approvedAt: isoDate.nullable(),
  rejectedReason: z.string().nullable(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  publishedAt: isoDate.nullable(),
  attempts: count,
  nextAttemptAt: isoDate.nullable(),
  lastError: z.string().nullable(),
  metrics: contentMetricsSchema,
  measureCount: count,
  measureDueAt: isoDate.nullable(),
  comments: z.array(contentCommentSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type ContentItemView = z.infer<typeof contentItemSchema>;

export const contentListQuerySchema = z.object({
  /** Lundi de la semaine affichée ; vide : la semaine en cours. */
  week: localDateString.optional(),
  space: z.enum(CONTENT_SPACES).optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
});
export type ContentListQuery = z.infer<typeof contentListQuerySchema>;

/** Modification d'un contenu avant sa publication (brouillon, approuvé, programmé ou en échec). */
export const contentUpdateSchema = z.object({
  title: z.string().trim().max(200).nullable().optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  caption: z.string().trim().max(2_200).nullable().optional(),
  hashtags: z.array(z.string().trim().min(2).max(41)).max(30).optional(),
  cta: z.enum(CTA_TARGETS).optional(),
  scheduledAt: isoDate.optional(),
  visualHeadline: z.string().trim().max(160).nullable().optional(),
}).refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Au moins un champ à modifier' });
export type ContentUpdateInput = z.input<typeof contentUpdateSchema>;

export const contentRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const contentPlanRequestSchema = z.object({
  /** Lundi de la semaine à planifier ; vide : la semaine suivante. */
  weekStart: localDateString.optional(),
  /** Vrai : une semaine déjà planifiée est replanifiée (nouvelle exécution) ; faux par défaut (rejeu idempotent). */
  force: z.boolean().default(false),
});
export type ContentPlanRequest = z.input<typeof contentPlanRequestSchema>;

export const marketingPlanResultSchema = z.object({ run: agentRunSchema.nullable(), replayed: z.boolean(), created: count, autoApproved: count });
export type MarketingPlanResult = z.infer<typeof marketingPlanResultSchema>;

/** Espace de diffusion et son connecteur (nom, configuré ou non, créneaux, formats). */
export const marketingSpaceSchema = z.object({
  space: z.enum(CONTENT_SPACES),
  name: z.string(),
  provider: z.string(),
  configured: z.boolean(),
  formats: z.array(z.enum(CONTENT_FORMATS)),
  slots: z.array(z.object({ day: z.number().int().min(1).max(7), time: z.string() })),
});
export type MarketingSpaceView = z.infer<typeof marketingSpaceSchema>;

// Sorties structurées des agents (aucune contrainte de longueur : bornées après lecture) -------------------------------

export const contentCalendarOutputSchema = z.object({
  items: z.array(z.object({
    space: z.enum(CONTENT_SPACES),
    format: z.enum(CONTENT_FORMATS),
    language: z.enum(CONTENT_LANGUAGES),
    title: z.string().nullable().describe('Titre (obligatoire pour un article, une vidéo YouTube ou une infolettre), sinon null'),
    body: z.string().describe('Texte principal : corps de l\'article, texte de la publication ou script de la vidéo'),
    caption: z.string().nullable().describe('Légende courte pour les réseaux à média (Instagram, TikTok, YouTube, Snapchat), sinon null'),
    hashtags: z.array(z.string()).describe('Mots-clics sans le signe #, dans la limite du réseau'),
    cta: z.enum(CTA_TARGETS).describe('Appel à l\'action : reserve (réservation), academy, preregister (devenir chauffeur), none'),
    sensitive: z.boolean().describe('Sujet sensible (sécurité, incident, réglementation, concurrence, argent) : approbation humaine obligatoire'),
    visualHeadline: z.string().describe('Phrase courte (60 caractères au plus) pour le visuel de marque'),
    rationale: z.string().describe('Pourquoi ce contenu cette semaine, en une phrase'),
  })),
  summary: z.string().describe('Fil conducteur de la semaine en deux phrases'),
});
export type ContentCalendarOutput = z.infer<typeof contentCalendarOutputSchema>;

export const seoPlanOutputSchema = z.object({
  tasks: z.array(z.object({
    action: z.enum(SEO_ACTIONS),
    targetRef: z.string().nullable().describe('Identifiant de la page visée (liste fournie), ou null pour le site'),
    keyword: z.string().nullable(),
    justification: z.string().describe('Constat chiffré ou règle, pour la personne qui approuve'),
    proposal: z.object({
      title: z.string().nullable().describe('Nouvelle balise titre (fix_title) ou titre de la page ou de l\'article à créer'),
      description: z.string().nullable().describe('Nouvelle description (fix_description) ou résumé'),
      question: z.string().nullable().describe('Question de FAQ (faq_question)'),
      answer: z.string().nullable().describe('Réponse de FAQ, factuelle, sans prix non décidé'),
      outline: z.array(z.string()).describe('Plan de la page ou de l\'article à créer (titres de sections)'),
      body: z.string().nullable().describe('Texte complet de la page ou de l\'article (brouillon WordPress), sinon null'),
      linkFrom: z.string().nullable().describe('Page d\'origine du lien interne'),
      linkTo: z.string().nullable().describe('Page de destination du lien interne'),
      anchor: z.string().nullable().describe('Texte du lien interne'),
    }),
  })),
  summary: z.string(),
});
export type SeoPlanOutput = z.infer<typeof seoPlanOutputSchema>;

// Tâches de référencement --------------------------------------------------------------------------------------------

export const seoMetricsSchema = z.object({ clicks: count, impressions: count, position: z.number().nullable(), queries: count, from: localDateString, to: localDateString });

export const seoTaskSchema = z.object({
  id: uuid,
  weekOf: localDateString,
  action: z.enum(SEO_ACTIONS),
  targetKind: z.enum(SEO_TARGET_KINDS),
  targetRef: z.string().nullable(),
  targetTitle: z.string().nullable(),
  targetUrl: z.string().nullable(),
  keyword: z.string().nullable(),
  justification: z.string(),
  proposal: z.record(z.string(), z.unknown()),
  status: z.enum(SEO_TASK_STATUSES),
  metricsBefore: seoMetricsSchema.nullable(),
  metricsAfter: seoMetricsSchema.nullable(),
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  agentRunId: uuid.nullable(),
  decidedAt: isoDate.nullable(),
  decisionNote: z.string().nullable(),
  appliedAt: isoDate.nullable(),
  measureDueAt: isoDate.nullable(),
  measuredAt: isoDate.nullable(),
  lastError: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type SeoTaskView = z.infer<typeof seoTaskSchema>;

export const seoTaskListQuerySchema = z.object({ status: z.enum(SEO_TASK_STATUSES).optional(), limit: z.coerce.number().int().min(1).max(200).default(100) });
export const seoTaskRejectSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const seoPlanRequestSchema = z.object({ weekStart: localDateString.optional(), force: z.boolean().default(false) });
export const seoPlanResultSchema = z.object({ run: agentRunSchema.nullable(), replayed: z.boolean(), created: count, applied: count });
export type SeoPlanResult = z.infer<typeof seoPlanResultSchema>;
