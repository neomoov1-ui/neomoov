/**
 * Marketing (phase 1 « Neomoov entreprise autonome », 2 octobre 2026) : les onze espaces de diffusion (dix réseaux et
 * sites, plus l'infolettre), leurs formats, leurs limites de longueur et de mots-clics (règles des réseaux, pas des
 * règles métier), les états d'un contenu et les appels à l'action. Fonctions pures, sans dépendance d'infrastructure.
 */

export const CONTENT_SPACES = ['site_blog', 'academy', 'google_business', 'facebook', 'instagram', 'linkedin', 'tiktok', 'youtube', 'x', 'snapchat', 'newsletter'] as const;
export type ContentSpace = (typeof CONTENT_SPACES)[number];

export const CONTENT_FORMATS = ['post', 'article', 'reel', 'story', 'video', 'short', 'newsletter'] as const;
export type ContentFormat = (typeof CONTENT_FORMATS)[number];

/** Cycle de vie d'un contenu : brouillon, approuvé, programmé, publié, en échec, mesuré ; `rejected` quand un humain le refuse. */
export const CONTENT_STATUSES = ['draft', 'approved', 'scheduled', 'published', 'failed', 'measured', 'rejected'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const CONTENT_LANGUAGES = ['fr', 'en'] as const;
export type ContentLanguage = (typeof CONTENT_LANGUAGES)[number];

/** Appel à l'action : réservation (neomoov.net/reserver), Academy, préinscription des chauffeurs, ou aucun. */
export const CTA_TARGETS = ['reserve', 'academy', 'preregister', 'none'] as const;
export type CtaTarget = (typeof CTA_TARGETS)[number];

/** État du média d'un contenu : aucun média attendu, à produire, gabarit HTML prêt (rendu différé), rendu, en échec. */
export const MEDIA_STATUSES = ['none', 'pending', 'html', 'ready', 'failed'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const VIDEO_FORMATS: readonly ContentFormat[] = ['reel', 'video', 'short'];

export function isVideoFormat(format: ContentFormat): boolean {
  return VIDEO_FORMATS.includes(format);
}

export interface SpaceRule {
  /** Nom affiché. */
  name: string;
  formats: readonly ContentFormat[];
  /** Longueur maximale du texte composé (corps, légende et mots-clics), règle du réseau. */
  maxChars: number;
  maxHashtags: number;
  /** Langues admises : français partout ; anglais aussi sur LinkedIn et X (version EN après la version FR). */
  languages: readonly ContentLanguage[];
  requiresTitle: boolean;
  /** Un visuel (photo réelle ou gabarit de marque) ou une vidéo est obligatoire pour publier. */
  requiresMedia: boolean;
  /** Les liens sont cliquables dans le texte (sinon, l'appel à l'action renvoie au lien du profil). */
  clickableLinks: boolean;
}

export const SPACE_RULES: Readonly<Record<ContentSpace, SpaceRule>> = {
  site_blog: { name: 'neomoov.net (blogue)', formats: ['article'], maxChars: 12_000, maxHashtags: 0, languages: ['fr'], requiresTitle: true, requiresMedia: false, clickableLinks: true },
  academy: { name: 'Neomoov Academy', formats: ['article', 'post'], maxChars: 8_000, maxHashtags: 0, languages: ['fr'], requiresTitle: true, requiresMedia: false, clickableLinks: true },
  google_business: { name: 'Fiche Google (Business Profile)', formats: ['post'], maxChars: 1_500, maxHashtags: 0, languages: ['fr'], requiresTitle: false, requiresMedia: false, clickableLinks: true },
  facebook: { name: 'Facebook', formats: ['post', 'reel', 'video'], maxChars: 2_000, maxHashtags: 5, languages: ['fr'], requiresTitle: false, requiresMedia: false, clickableLinks: true },
  instagram: { name: 'Instagram', formats: ['post', 'reel', 'story'], maxChars: 2_200, maxHashtags: 10, languages: ['fr'], requiresTitle: false, requiresMedia: true, clickableLinks: false },
  linkedin: { name: 'LinkedIn', formats: ['post', 'article'], maxChars: 3_000, maxHashtags: 5, languages: ['fr', 'en'], requiresTitle: false, requiresMedia: false, clickableLinks: true },
  tiktok: { name: 'TikTok', formats: ['short'], maxChars: 2_200, maxHashtags: 8, languages: ['fr'], requiresTitle: false, requiresMedia: true, clickableLinks: false },
  youtube: { name: 'YouTube', formats: ['video', 'short'], maxChars: 5_000, maxHashtags: 10, languages: ['fr'], requiresTitle: true, requiresMedia: true, clickableLinks: true },
  x: { name: 'X', formats: ['post'], maxChars: 280, maxHashtags: 3, languages: ['fr', 'en'], requiresTitle: false, requiresMedia: false, clickableLinks: true },
  snapchat: { name: 'Snapchat', formats: ['story', 'short'], maxChars: 250, maxHashtags: 3, languages: ['fr'], requiresTitle: false, requiresMedia: true, clickableLinks: false },
  newsletter: { name: 'Infolettre (Brevo)', formats: ['newsletter'], maxChars: 20_000, maxHashtags: 0, languages: ['fr'], requiresTitle: true, requiresMedia: false, clickableLinks: true },
};

export function spaceRule(space: ContentSpace): SpaceRule {
  return SPACE_RULES[space];
}

/** Mot-clic normalisé (`#` ajouté, espaces retirés) ; null si la forme est inacceptable. */
export function normalizeHashtag(raw: string): string | null {
  const tag = raw.trim().replace(/^#+/, '').replace(/\s+/g, '');
  return /^[\p{L}\p{N}_]{2,40}$/u.test(tag) ? `#${tag}` : null;
}

export interface ContentText {
  space: ContentSpace;
  title: string | null;
  body: string;
  caption: string | null;
  hashtags: readonly string[];
  ctaUrl: string | null;
}

/**
 * Texte publié tel que le réseau le reçoit : sur les réseaux à média (Instagram, TikTok, Snapchat, YouTube), la légende
 * d'abord (sinon le corps) ; ailleurs, le corps. Puis le lien d'appel à l'action (réseaux à liens cliquables) et les
 * mots-clics. Les connecteurs, simulés comme réels, publient ce texte.
 */
export function composeText(content: ContentText): string {
  const rule = SPACE_RULES[content.space];
  const main = rule.requiresMedia && content.caption?.trim() ? content.caption.trim() : content.body.trim();
  const parts = [main];
  if (content.ctaUrl && rule.clickableLinks && !main.includes(content.ctaUrl)) parts.push(content.ctaUrl);
  if (content.hashtags.length) parts.push(content.hashtags.join(' '));
  return parts.join('\n\n');
}
