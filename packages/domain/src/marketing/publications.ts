/**
 * Publications multiréseau (chantier « Réseaux sociaux » du 3 octobre 2026) : une publication est un sujet décliné en
 * un contenu par réseau (et par langue sur LinkedIn et X), regroupés par un identifiant de groupe. Ce module adapte le
 * texte de base à chaque réseau (format, titre, version courte pour X et Snapchat, mots-clics ramenés à la limite) et
 * répartit un lot sur des jours de diffusion selon les créneaux `marketing.slots`. Format du lot importé :
 * docs/marketing/lancement-50-publications.schema.json. Fonctions pures.
 */
import { shiftLocalDate } from '../agents/agents.js';
import { DEFAULT_SLOTS, zonedInstant, type Slot, type SlotsBySpace } from './calendar.js';
import { checkContent, type ContentCheckOptions, type ContentDraft, type ContentIssue } from './rules.js';
import { composeText, normalizeHashtag, SPACE_RULES, type ContentFormat, type ContentLanguage, type ContentSpace, type CtaTarget } from './spaces.js';
import { DEFAULT_FORMATS, imageTextFor } from './visuals.js';

/** Les dix espaces de publication du fondateur (« tous »), dans l'ordre de la page Contact. */
export const PUBLICATION_SPACES = ['site_blog', 'facebook', 'instagram', 'linkedin', 'x', 'tiktok', 'snapchat', 'telegram', 'youtube', 'whatsapp_channel'] as const satisfies readonly ContentSpace[];
export type PublicationSpace = (typeof PUBLICATION_SPACES)[number];

/** Diffusion d'un contenu : par le connecteur du réseau (`auto`) ou par un humain depuis la vue « À relayer » (`manual`). */
export const DELIVERY_MODES = ['auto', 'manual'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/** Espaces toujours en relais manuel : aucune API de publication ouverte (décision du fondateur du 3 octobre 2026). */
export const RELAY_ONLY_SPACES: readonly ContentSpace[] = ['whatsapp_channel', 'snapchat'];

/**
 * Codes d'erreur des connecteurs qui demandent un relais manuel (compte en mode manuel, approbation du réseau en attente) :
 * le contenu passe en `failed` avec `lastError` commençant par l'un d'eux, sans nouvelle tentative ; My Hub le présente
 * comme une tâche « À relayer », pas comme un échec.
 */
export const MANUAL_RELAY_CODES = ['SOCIAL_MANUAL_RELAY', 'SOCIAL_APPROVAL_PENDING'] as const;

/** Contenu à publier à la main : programmé en relais manuel, ou refusé par le connecteur avec un code de relais manuel. */
export function awaitsManualRelay(item: { status: string; delivery: string; lastError: string | null }): boolean {
  if (item.status === 'scheduled' && item.delivery === 'manual') return true;
  return item.status === 'failed' && MANUAL_RELAY_CODES.some((code) => item.lastError?.startsWith(code) ?? false);
}

/** Réseaux qui reçoivent par défaut la version courte (texte limité à quelques centaines de caractères). */
const SHORT_SPACES: readonly ContentSpace[] = ['x', 'snapchat'];
/** Titre gardé sur ces réseaux (affiché ou exigé) ; ailleurs il ne sert qu'au visuel. */
const TITLED_SPACES: readonly ContentSpace[] = ['site_blog', 'academy', 'youtube', 'newsletter'];
const MAX_TITLE: Partial<Record<ContentSpace, number>> = { youtube: 100 };

export interface PublicationVariantInput {
  format?: ContentFormat | undefined;
  language?: ContentLanguage | undefined;
  title?: string | undefined;
  body?: string | undefined;
  caption?: string | undefined;
  hashtags?: readonly string[] | undefined;
  imageText?: string | undefined;
  en?: { title?: string | undefined; body: string; hashtags?: readonly string[] | undefined } | undefined;
}

export interface PublicationBase {
  title: string;
  body: string;
  short: string;
  imageText?: string | null | undefined;
  cta: CtaTarget;
  hashtags: readonly string[];
  language: ContentLanguage;
}

/** Contenu prêt pour un réseau : brouillon contrôlé par les règles, texte de l'image et rang dans la publication. */
export interface AdaptedContent {
  draft: ContentDraft;
  imageText: string;
  issues: ContentIssue[];
  /** Texte composé tel que le réseau le recevra (corps ou légende, lien d'appel à l'action, mots-clics). */
  text: string;
}

const tags = (values: readonly string[], max: number): string[] => [...new Set(values.map(normalizeHashtag).filter((h): h is string => Boolean(h)))].slice(0, max);

/**
 * Texte d'un réseau : variante si elle est donnée, sinon la base (version courte sur X et Snapchat), mots-clics ramenés
 * à la limite du réseau ; un texte de base trop long pour le réseau est remplacé par la version courte. Les règles
 * (`checkContent`) sont appliquées au résultat : un écart bloquant exige une correction ou un humain.
 */
export function adaptForSpace(space: ContentSpace, base: PublicationBase, variant: PublicationVariantInput | undefined, options: ContentCheckOptions): AdaptedContent[] {
  const rule = SPACE_RULES[space];
  const format = variant?.format && rule.formats.includes(variant.format) ? variant.format : DEFAULT_FORMATS[space];
  const language: ContentLanguage = variant?.language && rule.languages.includes(variant.language) ? variant.language : rule.languages.includes(base.language) ? base.language : 'fr';
  const ctaUrl = base.cta === 'none' ? null : (options.ctaUrls[base.cta] ?? null);
  const rawTitle = variant?.title?.trim() || (TITLED_SPACES.includes(space) ? base.title.trim() : '');
  const title = rawTitle ? rawTitle.slice(0, MAX_TITLE[space] ?? 200) : null;
  const hashtags = tags(variant?.hashtags ?? base.hashtags, rule.maxHashtags);
  const caption = variant?.caption?.trim() || null;
  let body = variant?.body?.trim() || (SHORT_SPACES.includes(space) ? base.short.trim() : base.body.trim());
  const composedLength = (b: string) => composeText({ space, title, body: b, caption, hashtags, ctaUrl }).length;
  if (!variant?.body && composedLength(body) > rule.maxChars && base.short.trim()) body = base.short.trim();
  const draft: ContentDraft = { space, format, language, title, body, caption, hashtags, cta: base.cta };
  const out: AdaptedContent[] = [{ draft, imageText: imageTextFor({ variantImageText: variant?.imageText, imageText: base.imageText, title: base.title }), issues: checkContent(draft, options), text: composeText({ space, title, body, caption, hashtags, ctaUrl }) }];
  // Version anglaise après la version française (LinkedIn et X seulement, lignes éditoriales).
  if (variant?.en?.body?.trim() && rule.languages.includes('en') && language === 'fr') {
    const enTags = tags(variant.en.hashtags ?? hashtags, rule.maxHashtags);
    const enTitle = variant.en.title?.trim() ? variant.en.title.trim().slice(0, 200) : null;
    const enDraft: ContentDraft = { space, format, language: 'en', title: enTitle, body: variant.en.body.trim(), caption: null, hashtags: enTags, cta: base.cta };
    out.push({ draft: enDraft, imageText: imageTextFor({ variantImageText: enTitle, imageText: null, title: enTitle ?? base.title }), issues: checkContent(enDraft, options), text: composeText({ space, title: enTitle, body: enDraft.body, caption: null, hashtags: enTags, ctaUrl }) });
  }
  return out;
}

/** Réseaux visés : « all » donne les dix espaces de publication ; une liste est dédoublonnée et remise dans l'ordre de référence. */
export function resolveSpaces(selection: 'all' | readonly ContentSpace[] | undefined): ContentSpace[] {
  if (!selection || selection === 'all') return [...PUBLICATION_SPACES];
  const order: readonly ContentSpace[] = [...PUBLICATION_SPACES, 'academy', 'google_business', 'newsletter'];
  return order.filter((s) => selection.includes(s));
}

// Répartition d'un lot ------------------------------------------------------------------------------------------------------

export interface CampaignEntry {
  /** Jour relatif imposé (1 = premier jour), ou null pour une répartition automatique dans l'ordre. */
  day: number | null;
  /** Instant imposé (prioritaire). */
  at: Date | null;
  spaces: readonly ContentSpace[];
}

const SLOT_STEP_MS = 30 * 60_000;

/**
 * Jours et instants de diffusion d'un lot : chaque publication reçoit un jour (le sien, sinon le prochain jour qui a de
 * la place, `perDay` publications au plus par jour), puis chaque réseau l'heure de son créneau `marketing.slots` de ce
 * jour de semaine (sinon l'heure de son premier créneau) ; deux publications d'un même réseau le même jour sont
 * décalées d'au moins 30 minutes, et rien n'est placé avant `notBefore` (un créneau passé glisse après maintenant).
 * Rend, pour chaque publication, l'instant de chaque réseau dans l'ordre de `spaces`.
 */
export function scheduleCampaign(entries: readonly CampaignEntry[], startDate: string, slots: SlotsBySpace, timeZone: string, notBefore: Date, perDay: number): Date[][] {
  const limit = Math.max(1, Math.floor(perDay));
  const load = new Map<number, number>();
  for (const e of entries) if (e.day && !e.at) load.set(e.day, (load.get(e.day) ?? 0) + 1);
  let cursor = 1;
  const days = entries.map((e) => {
    if (e.at) return null;
    if (e.day) return e.day;
    while ((load.get(cursor) ?? 0) >= limit) cursor += 1;
    load.set(cursor, (load.get(cursor) ?? 0) + 1);
    return cursor;
  });
  const taken = new Map<string, number[]>();
  const minimum = notBefore.getTime() + 5 * 60_000;
  return entries.map((entry, index) => {
    const day = days[index];
    return entry.spaces.map((space) => {
      if (entry.at) return entry.at;
      const date = shiftLocalDate(startDate, day! - 1);
      const weekday = localWeekday(date);
      const list = [...(slots[space]?.length ? slots[space]! : DEFAULT_SLOTS[space])].sort((a, b) => a.time.localeCompare(b.time));
      const sameDay = list.filter((s: Slot) => s.day === weekday).map((s) => s.time);
      const times = [...new Set([...sameDay, ...list.map((s) => s.time)])];
      const key = `${space}:${date}`;
      const used = taken.get(key) ?? [];
      let instant: number | null = null;
      for (const time of times) {
        const t = Math.max(zonedInstant(date, time, timeZone).getTime(), minimum);
        if (used.every((u) => Math.abs(u - t) >= SLOT_STEP_MS)) {
          instant = t;
          break;
        }
      }
      if (instant === null) instant = Math.max(minimum, ...used) + SLOT_STEP_MS;
      used.push(instant);
      taken.set(key, used);
      return new Date(instant);
    });
  });
}

/** Jour de la semaine d'une date locale (1 = lundi … 7 = dimanche). */
function localWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
