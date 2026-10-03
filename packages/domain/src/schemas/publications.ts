/**
 * Schémas des publications multiréseau (chantier « Réseaux sociaux » du 3 octobre 2026) : lot importé (miroir exécutable
 * de docs/marketing/lancement-50-publications.schema.json, vérifié par un test), saisie du composer, groupes de
 * contenus, approbation et programmation en lot, tâches « À relayer », commentaires et messages par réseau.
 */
import { z } from 'zod';
import { SOCIAL_NETWORKS } from '../enums.js';
import { CONTENT_FORMATS, CONTENT_LANGUAGES, CTA_TARGETS, DELIVERY_MODES, PUBLICATION_SPACES, PHOTO_CROPS, TITLE_POSITIONS, VISUAL_TEMPLATES, type ContentSpace } from '../marketing/index.js';
import { isoDate, localDateString, uuid } from './common.js';
import { contentItemSchema } from './marketing.js';

const count = z.number().int().min(0);
const space = z.enum(PUBLICATION_SPACES);
const hashtag = z.string().trim().regex(/^#?[\p{L}\p{N}_]{2,40}$/u, 'Mot-clic invalide (lettres, chiffres, souligné ; 2 à 40 caractères)');
const hashtags = z.array(hashtag).max(10);
const imageText = z.string().trim().min(3).max(70);
const spaceSelection = z.union([z.literal('all'), z.array(space).min(1)]);

export const publicationVariantSchema = z.object({
  format: z.enum(CONTENT_FORMATS).optional(),
  language: z.enum(CONTENT_LANGUAGES).optional(),
  title: z.string().trim().max(100).optional(),
  body: z.string().trim().min(1).max(12_000).optional(),
  caption: z.string().trim().max(2_200).optional(),
  hashtags: hashtags.optional(),
  imageText: imageText.optional(),
  en: z.object({ title: z.string().trim().max(100).optional(), body: z.string().trim().min(1).max(3_000), hashtags: hashtags.optional() }).strict().optional(),
}).strict();
export type PublicationVariant = z.infer<typeof publicationVariantSchema>;

const variants = z.object(Object.fromEntries(PUBLICATION_SPACES.map((s) => [s, publicationVariantSchema.optional()])) as Record<(typeof PUBLICATION_SPACES)[number], z.ZodOptional<typeof publicationVariantSchema>>).strict();

/** Une publication du lot (mêmes champs que le schéma JSON). */
export const publicationSchema = z.object({
  ref: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/, 'Référence : lettres, chiffres, tirets (40 au plus)'),
  pillar: z.enum(['service', 'aeroport', 'montreal', 'electrique', 'securite', 'chauffeurs', 'academy', 'marque', 'coulisses', 'faq']).optional(),
  audience: z.enum(['clients', 'chauffeurs', 'entreprises', 'tous']).optional(),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(40).max(12_000),
  short: z.string().trim().min(20).max(200),
  imageText: imageText.optional(),
  cta: z.enum(CTA_TARGETS).optional(),
  hashtags: hashtags.optional(),
  language: z.enum(CONTENT_LANGUAGES).optional(),
  spaces: spaceSelection.optional(),
  variants: variants.optional(),
  photoHints: z.array(z.string().trim().min(2).max(40)).max(6).optional(),
  day: z.number().int().min(1).max(90).optional(),
  scheduledAt: isoDate.optional(),
  sensitive: z.boolean().optional(),
  notes: z.string().max(1_000).optional(),
}).strict();
export type PublicationInput = z.infer<typeof publicationSchema>;

export const publicationsImportSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  campaign: z.string().regex(/^[a-z0-9][a-z0-9-]{2,59}$/, 'Code de campagne : minuscules, chiffres et tirets (3 à 60)'),
  title: z.string().trim().max(160).optional(),
  startDate: localDateString.optional(),
  defaults: z.object({ spaces: spaceSelection.optional(), cta: z.enum(CTA_TARGETS).optional(), hashtags: hashtags.optional(), language: z.enum(CONTENT_LANGUAGES).optional() }).strict().optional(),
  publications: z.array(publicationSchema).min(1).max(200),
}).strict().superRefine((v, ctx) => {
  const seen = new Set<string>();
  v.publications.forEach((p, i) => {
    if (seen.has(p.ref)) ctx.addIssue({ code: 'custom', path: ['publications', i, 'ref'], message: `Référence en double : ${p.ref}` });
    seen.add(p.ref);
  });
});
export type PublicationsImport = z.infer<typeof publicationsImportSchema>;

/** Composer de My Hub : une publication (référence facultative) et sa diffusion. */
export const publicationComposeSchema = publicationSchema.omit({ ref: true, day: true, scheduledAt: true }).extend({
  ref: publicationSchema.shape.ref.optional(),
  spaces: spaceSelection,
  /** `now` : publiée tout de suite ; `at` : à l'instant donné ; `slots` : au prochain créneau de chaque réseau ; `draft` : brouillons à relire. */
  schedule: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('now') }),
    z.object({ mode: z.literal('at'), at: isoDate }),
    z.object({ mode: z.literal('slots') }),
    z.object({ mode: z.literal('draft') }),
  ]),
}).strict();
export type PublicationComposeInput = z.input<typeof publicationComposeSchema>;

/** Visuel d'un contenu de publication : variante appliquée, taille, empreinte (toutes différentes dans une publication). */
export const contentVisualSchema = z.object({
  template: z.enum(VISUAL_TEMPLATES),
  accent: z.string(),
  titlePosition: z.enum(TITLE_POSITIONS),
  crop: z.enum(PHOTO_CROPS),
  zoom: z.number().int(),
  photoIndex: z.number().int().min(0).nullable(),
  imageText: z.string(),
  tagline: z.string(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  /** Photo réelle utilisée (médiathèque du site) et sa description. */
  photoUrl: z.string().nullable(),
  photoCredit: z.string().nullable(),
  /** Empreinte SHA-256 du visuel produit (PNG, sinon gabarit HTML). */
  fingerprint: z.string().nullable(),
  /** Miniature d'une vidéo YouTube (1280 × 720), si produite. */
  thumbnailKey: z.string().nullable(),
});
export type ContentVisual = z.infer<typeof contentVisualSchema>;

export const publicationItemSchema = contentItemSchema.extend({
  groupId: uuid.nullable(),
  delivery: z.enum(DELIVERY_MODES),
  visual: contentVisualSchema.nullable(),
  relayedAt: isoDate.nullable(),
  /** Mention du connecteur à la publication (vidéo privée tant que l'audit YouTube ou TikTok n'est pas accordé). */
  notice: z.string().nullable(),
  /** À publier à la main (relais manuel programmé, ou refus du connecteur avec un code de relais manuel). */
  awaitsRelay: z.boolean(),
});
export type PublicationItemView = z.infer<typeof publicationItemSchema>;

export const publicationGroupSchema = z.object({
  id: uuid,
  campaign: z.string().nullable(),
  ref: z.string().nullable(),
  source: z.enum(['composer', 'import']),
  title: z.string(),
  body: z.string(),
  short: z.string(),
  imageText: z.string().nullable(),
  cta: z.enum(CTA_TARGETS),
  hashtags: z.array(z.string()),
  photoHints: z.array(z.string()),
  day: z.number().int().nullable(),
  pillar: z.string().nullable(),
  notes: z.string().nullable(),
  items: z.array(publicationItemSchema),
  /** Compteurs par état des contenus (brouillon, programmé, publié, en échec, à relayer, refusé). */
  counts: z.object({ draft: count, scheduled: count, published: count, failed: count, relay: count, rejected: count, blocked: count }),
  createdAt: isoDate,
});
export type PublicationGroupView = z.infer<typeof publicationGroupSchema>;

export const publicationListQuerySchema = z.object({
  campaign: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type PublicationListQuery = z.infer<typeof publicationListQuerySchema>;

export const publicationImportResultSchema = z.object({
  campaign: z.string(),
  /** Publications créées, déjà présentes (même campagne et même référence : rien n'est recréé), contenus créés, contenus bloqués par les règles. */
  created: count,
  existing: count,
  items: count,
  blocked: count,
  groups: z.array(z.object({ id: uuid, ref: z.string(), items: count, blocked: count, existing: z.boolean() })),
});
export type PublicationImportResult = z.infer<typeof publicationImportResultSchema>;

/** Approuver et programmer en lot : une campagne ou des publications, réparties sur `days` jours (ou `perDay` par jour). */
export const publicationScheduleSchema = z.object({
  campaign: z.string().trim().max(60).optional(),
  groupIds: z.array(uuid).max(200).optional(),
  startDate: localDateString.optional(),
  days: z.number().int().min(1).max(90).optional(),
  perDay: z.number().int().min(1).max(50).optional(),
}).strict().refine((v) => Boolean(v.campaign) || Boolean(v.groupIds?.length), { message: 'Une campagne ou une liste de publications est requise' });
export type PublicationScheduleInput = z.infer<typeof publicationScheduleSchema>;

export const publicationScheduleResultSchema = z.object({
  approved: count,
  relay: count,
  skipped: z.array(z.object({ itemId: uuid, space: z.string(), reason: z.string() })),
  firstAt: isoDate.nullable(),
  lastAt: isoDate.nullable(),
});
export type PublicationScheduleResult = z.infer<typeof publicationScheduleResultSchema>;

/** Tâche du relais manuel : texte prêt à copier, fichier à télécharger, lien direct vers le réseau. */
export const relayTaskSchema = z.object({
  item: publicationItemSchema,
  groupTitle: z.string().nullable(),
  text: z.string(),
  link: z.string(),
  fileName: z.string().nullable(),
  thumbnailFileName: z.string().nullable(),
  /** En retard : l'heure prévue est passée. */
  late: z.boolean(),
});
export type RelayTaskView = z.infer<typeof relayTaskSchema>;

export const relayListQuerySchema = z.object({
  /** Jour affiché (date locale) ; vide : aujourd'hui. Les tâches en retard des jours précédents sont toujours incluses. */
  date: localDateString.optional(),
});
export const relayListSchema = z.object({ date: localDateString, tasks: z.array(relayTaskSchema), doneToday: count });
export type RelayListView = z.infer<typeof relayListSchema>;

export const relayDoneSchema = z.object({ url: z.string().trim().url().max(500).optional() }).strict();
export type RelayDoneInput = z.infer<typeof relayDoneSchema>;

/** Textes adaptés par l'agent de contenu, à la demande du composer. */
export const publicationAdaptRequestSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(20).max(12_000),
  cta: z.enum(CTA_TARGETS).default('none'),
  spaces: z.array(space).min(1),
}).strict();
export const publicationAdaptOutputSchema = z.object({
  variants: z.array(z.object({
    space: space,
    title: z.string().nullable().describe('Titre propre au réseau (blogue et YouTube), sinon null'),
    body: z.string().describe('Texte complet pour ce réseau, sans lien ni mot-clic'),
    caption: z.string().nullable().describe('Légende courte des réseaux à média (Instagram, TikTok, Snapchat, YouTube), sinon null'),
    hashtags: z.array(z.string()).describe('Mots-clics sans le signe #, dans la limite du réseau'),
    imageText: z.string().describe('Texte court sur l\'image, 70 caractères au plus, différent pour chaque réseau'),
  })),
});
export type PublicationAdaptOutput = z.infer<typeof publicationAdaptOutputSchema>;
export const publicationAdaptResultSchema = z.object({
  variants: z.record(z.string(), publicationVariantSchema),
  runId: uuid.nullable(),
});
export type PublicationAdaptResult = z.infer<typeof publicationAdaptResultSchema>;

/** Commentaires et messages par réseau (boîte unifiée, canal `social`) : non lus, remis à l'humain, réponses à relayer. */
export const socialInboxSummarySchema = z.object({
  networks: z.array(z.object({ network: z.enum(SOCIAL_NETWORKS), unread: count, escalated: count, relayPending: count, open: count })),
  total: z.object({ unread: count, escalated: count, relayPending: count }),
});
export type SocialInboxSummaryView = z.infer<typeof socialInboxSummarySchema>;

/** Réseau de la boîte unifiée d'un espace de publication (null : pas de commentaires, comme la chaîne WhatsApp). */
export function inboxNetworkOf(spaceCode: ContentSpace): (typeof SOCIAL_NETWORKS)[number] | null {
  if (spaceCode === 'google_business') return 'gbp';
  return (SOCIAL_NETWORKS as readonly string[]).includes(spaceCode) ? (spaceCode as (typeof SOCIAL_NETWORKS)[number]) : null;
}
