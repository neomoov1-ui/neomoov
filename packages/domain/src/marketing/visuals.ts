/**
 * Visuels par réseau (chantier « Réseaux sociaux » du 3 octobre 2026) : tailles exactes de chaque espace (table unique,
 * documentée dans docs/marketing/publication-multireseau.md), variantes de mise en page pour qu'une même publication
 * n'ait jamais deux images identiques (gabarit, photo réelle, recadrage, accent de couleur de la marque, position du
 * titre, texte court adapté au réseau) et liens directs du relais manuel. Fonctions pures.
 */
import type { ContentFormat, ContentLanguage, ContentSpace } from './spaces.js';

export interface VisualSize {
  width: number;
  height: number;
}

const size = (width: number, height: number): VisualSize => ({ width, height });

/**
 * Tailles par espace : `feed` (publication du fil), `vertical` (story, reel, short ; null si le réseau n'en a pas),
 * `landscape` (vidéo longue), `thumbnail` (miniature d'une vidéo). Sources : règles publiées des réseaux, octobre 2026.
 */
export const VISUAL_SIZES: Readonly<Record<ContentSpace, { feed: VisualSize; vertical: VisualSize | null; landscape: VisualSize | null; thumbnail: VisualSize | null }>> = {
  site_blog: { feed: size(1200, 630), vertical: null, landscape: null, thumbnail: null },
  academy: { feed: size(1200, 630), vertical: null, landscape: null, thumbnail: null },
  google_business: { feed: size(1200, 900), vertical: null, landscape: null, thumbnail: null },
  facebook: { feed: size(1080, 1350), vertical: size(1080, 1920), landscape: null, thumbnail: null },
  instagram: { feed: size(1080, 1350), vertical: size(1080, 1920), landscape: null, thumbnail: null },
  linkedin: { feed: size(1200, 1200), vertical: null, landscape: null, thumbnail: null },
  x: { feed: size(1600, 900), vertical: null, landscape: null, thumbnail: null },
  tiktok: { feed: size(1080, 1920), vertical: size(1080, 1920), landscape: null, thumbnail: null },
  snapchat: { feed: size(1080, 1920), vertical: size(1080, 1920), landscape: null, thumbnail: null },
  telegram: { feed: size(1280, 720), vertical: null, landscape: null, thumbnail: null },
  // YouTube : l'API n'accepte que la vidéo (Short vertical) ; la miniature est un visuel à part.
  youtube: { feed: size(1080, 1920), vertical: size(1080, 1920), landscape: size(1280, 720), thumbnail: size(1280, 720) },
  whatsapp_channel: { feed: size(1080, 1080), vertical: null, landscape: null, thumbnail: null },
  newsletter: { feed: size(1200, 630), vertical: null, landscape: null, thumbnail: null },
};

/** Taille du visuel d'un contenu : vertical pour les stories, reels et shorts, paysage pour une vidéo YouTube longue, sinon le fil. */
export function visualSize(space: ContentSpace, format: ContentFormat): VisualSize {
  const sizes = VISUAL_SIZES[space];
  if ((format === 'story' || format === 'reel' || format === 'short') && sizes.vertical) return sizes.vertical;
  if (format === 'video' && sizes.landscape) return sizes.landscape;
  return sizes.feed;
}

/** Miniature d'une vidéo (YouTube), ou null. */
export function thumbnailSize(space: ContentSpace): VisualSize | null {
  return VISUAL_SIZES[space].thumbnail;
}

/** Format par défaut d'un espace dans le composer et l'import (texte et visuel du fil, vidéo courte sur TikTok et YouTube). */
export const DEFAULT_FORMATS: Readonly<Record<ContentSpace, ContentFormat>> = {
  site_blog: 'article', academy: 'article', google_business: 'post', facebook: 'post', instagram: 'post', linkedin: 'post', x: 'post',
  tiktok: 'short', snapchat: 'story', telegram: 'post', youtube: 'short', whatsapp_channel: 'post', newsletter: 'newsletter',
};

// Variantes ---------------------------------------------------------------------------------------------------------------

/** Gabarits de mise en page (au moins cinq, exigence du fondateur) : chacun place la photo, le titre et l'accent autrement. */
export const VISUAL_TEMPLATES = ['banner', 'frame', 'diagonal', 'card', 'fullbleed', 'split'] as const;
export type VisualTemplate = (typeof VISUAL_TEMPLATES)[number];

/** Accents de couleur de la marque (lime de l'Academy, vert, bleu et bleu pâle de neomoov.net). */
export const VISUAL_ACCENTS = ['#c4f45c', '#6cc04a', '#1485e0', '#e3f1fc'] as const;
export const TITLE_POSITIONS = ['top', 'center', 'bottom'] as const;
export type TitlePosition = (typeof TITLE_POSITIONS)[number];
/** Recadrage de la photo : point d'ancrage et agrandissement (pourcentage). */
export const PHOTO_CROPS = ['center', 'top', 'bottom', 'left', 'right'] as const;
export type PhotoCrop = (typeof PHOTO_CROPS)[number];
export const PHOTO_ZOOMS = [100, 115, 130] as const;

export interface VisualVariant {
  template: VisualTemplate;
  accent: string;
  titlePosition: TitlePosition;
  crop: PhotoCrop;
  zoom: number;
  /** Rang de la photo réelle dans la liste retenue (médiathèque filtrée), ou null sans photo. */
  photoIndex: number | null;
  /** Texte court écrit sur l'image (70 caractères au plus). */
  imageText: string;
  /** Mention du réseau sur l'image (« À la une », « En bref »…). */
  tagline: string;
}

/** Empreinte stable d'un texte (FNV-1a sur 32 bits) : graine des variantes, sans dépendance cryptographique. */
export function variantSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mention du réseau sur l'image, en français et en anglais. */
export const SPACE_TAGLINES: Readonly<Record<ContentSpace, Readonly<Record<ContentLanguage, string>>>> = {
  site_blog: { fr: 'À lire sur neomoov.net', en: 'On neomoov.net' },
  academy: { fr: 'Neomoov Academy', en: 'Neomoov Academy' },
  google_business: { fr: 'Neomoov à Montréal', en: 'Neomoov in Montréal' },
  facebook: { fr: 'Neomoov à Montréal', en: 'Neomoov in Montréal' },
  instagram: { fr: 'Avancez vers demain', en: 'Move toward tomorrow' },
  linkedin: { fr: 'Mobilité électrique à Montréal', en: 'Electric mobility in Montréal' },
  x: { fr: 'En bref', en: 'In brief' },
  tiktok: { fr: 'Neomoov en vidéo', en: 'Neomoov on video' },
  snapchat: { fr: 'À découvrir', en: 'Discover' },
  telegram: { fr: 'À la une', en: 'Headline' },
  youtube: { fr: 'Neomoov en vidéo', en: 'Neomoov on video' },
  whatsapp_channel: { fr: 'Nouvelle de Neomoov', en: 'Neomoov news' },
  newsletter: { fr: 'Infolettre Neomoov', en: 'Neomoov newsletter' },
};

export const IMAGE_TEXT_MAX = 70;

/** Texte court borné à `max` caractères, coupé à la fin d'un mot (points de suspension). */
export function shorten(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[\s,;:.!?-]+$/, '');
  return `${cut || clean.slice(0, max - 1)}…`;
}

/** Texte de l'image d'un réseau : celui de la variante, sinon celui de la publication, sinon le titre ; borné. */
export function imageTextFor(input: { variantImageText?: string | null | undefined; imageText?: string | null | undefined; title: string }): string {
  return shorten(input.variantImageText?.trim() || input.imageText?.trim() || input.title, IMAGE_TEXT_MAX);
}

/**
 * Variantes d'une publication : une par contenu (réseau et langue), dans l'ordre donné. Chaque élément avance d'un cran
 * sur chaque axe à partir d'une graine propre à la publication : gabarit (6), accent (4) et position du titre (3) donnent
 * des triplets tous différents jusqu'à 12 contenus (plus petit commun multiple), au-delà le recadrage et la photo
 * départagent encore. La photo est différente pour chaque réseau quand la médiathèque en a assez.
 */
export function planVariants(seed: string, entries: ReadonlyArray<{ space: ContentSpace; language: ContentLanguage; imageText: string }>, photoCount: number): VisualVariant[] {
  const base = variantSeed(seed);
  return entries.map((entry, i) => ({
    template: VISUAL_TEMPLATES[(base + i) % VISUAL_TEMPLATES.length]!,
    accent: VISUAL_ACCENTS[((base >>> 3) + i) % VISUAL_ACCENTS.length]!,
    titlePosition: TITLE_POSITIONS[((base >>> 7) + i) % TITLE_POSITIONS.length]!,
    crop: PHOTO_CROPS[((base >>> 11) + i * 2) % PHOTO_CROPS.length]!,
    zoom: PHOTO_ZOOMS[((base >>> 13) + i) % PHOTO_ZOOMS.length]!,
    photoIndex: photoCount > 0 ? ((base >>> 5) + i) % photoCount : null,
    imageText: entry.imageText,
    tagline: SPACE_TAGLINES[entry.space][entry.language],
  }));
}

/** Clé d'une variante (gabarit, accent, position, recadrage, photo, texte) : deux variantes d'une publication ne la partagent jamais. */
export function variantKey(variant: VisualVariant): string {
  return [variant.template, variant.accent, variant.titlePosition, variant.crop, variant.zoom, variant.photoIndex ?? '-', variant.imageText, variant.tagline].join('|');
}

/** Vrai si toutes les empreintes (ou clés) sont différentes. */
export function allDistinct(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

/**
 * Photos d'une publication : celles dont la description ou l'adresse contient un des mots donnés d'abord, puis les
 * autres (la médiathèque ne contient que des photos réelles, règle D46). Ordre stable.
 */
export function rankPhotos<T extends { url: string; alt: string | null }>(photos: readonly T[], hints: readonly string[]): T[] {
  const words = hints.map((h) => normalizeWord(h)).filter(Boolean);
  if (!words.length) return [...photos];
  const score = (p: T) => {
    const text = normalizeWord(`${p.alt ?? ''} ${decodeURIComponent(p.url.split('/').pop() ?? '')}`);
    return words.filter((w) => text.includes(w)).length;
  };
  return photos.map((p, i) => ({ p, i, s: score(p) })).sort((a, b) => b.s - a.s || a.i - b.i).map((x) => x.p);
}

function normalizeWord(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Relais manuel -----------------------------------------------------------------------------------------------------------

/** Lien direct vers l'outil de publication de chaque réseau (site ou application), pour le relais manuel. */
export const RELAY_LINKS: Readonly<Record<ContentSpace, string>> = {
  site_blog: 'https://neomoov.net/wp-admin/post-new.php',
  academy: 'https://neomoov.net/wp-admin/post-new.php',
  google_business: 'https://business.google.com/',
  facebook: 'https://business.facebook.com/latest/composer',
  instagram: 'https://www.instagram.com/',
  linkedin: 'https://www.linkedin.com/feed/',
  x: 'https://x.com/compose/post',
  tiktok: 'https://www.tiktok.com/tiktokstudio/upload',
  snapchat: 'https://my.snapchat.com/',
  telegram: 'https://web.telegram.org/',
  youtube: 'https://studio.youtube.com/',
  whatsapp_channel: 'https://web.whatsapp.com/',
  newsletter: 'https://app.brevo.com/',
};

/**
 * Lien du relais manuel : sur X, la fenêtre de publication s'ouvre avec le texte déjà saisi (lien d'intention) ; sur
 * LinkedIn, la page entreprise quand son adresse est connue ; ailleurs, l'outil du réseau.
 */
export function relayLink(space: ContentSpace, text: string, profileUrl?: string | null): string {
  if (space === 'x') return `https://x.com/intent/post?text=${encodeURIComponent(text.slice(0, 280))}`;
  if (space === 'linkedin' && profileUrl) return profileUrl;
  return RELAY_LINKS[space];
}

/** Nom du fichier à télécharger pour un réseau : `neomoov-<réseau>-<largeur>x<hauteur>.<ext>`. */
export function mediaFileName(space: ContentSpace, dims: VisualSize, kind: 'image' | 'video' | 'thumbnail', ref?: string | null): string {
  const ext = kind === 'video' ? 'mp4' : 'png';
  const suffix = kind === 'thumbnail' ? '-miniature' : '';
  const prefix = ref ? `${ref.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)}-` : '';
  return `neomoov-${prefix}${space.replace(/_/g, '-')}${suffix}-${dims.width}x${dims.height}.${ext}`;
}
