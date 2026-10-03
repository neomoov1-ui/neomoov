/**
 * Garde-fous codés des contenus publics (plan « entreprise autonome », section 5) : aucune promesse de revenu, aucun
 * prix non décidé, aucune donnée personnelle, vouvoiement, sujets sensibles à faire approuver, limites par réseau.
 * Les règles décident ; l'agent rédige. Un contenu est reclassé « sensible » dès qu'une règle bloquante est touchée.
 */
import { composeText, normalizeHashtag, SPACE_RULES, type ContentFormat, type ContentLanguage, type ContentSpace, type CtaTarget } from './spaces.js';

export const CONTENT_ISSUE_KINDS = [
  'format_not_allowed', 'language_not_allowed', 'title_required', 'body_empty', 'too_long', 'too_many_hashtags', 'hashtag_invalid',
  'revenue_promise', 'undecided_price', 'personal_data', 'informal_address', 'sensitive_topic', 'missing_cta_link',
] as const;
export type ContentIssueKind = (typeof CONTENT_ISSUE_KINDS)[number];

export interface ContentIssue {
  kind: ContentIssueKind;
  detail: string;
  /** Bloquant : jamais publié automatiquement, correction ou approbation humaine requise. */
  blocking: boolean;
}

export interface ContentDraft {
  space: ContentSpace;
  format: ContentFormat;
  language: ContentLanguage;
  title: string | null;
  body: string;
  caption: string | null;
  hashtags: readonly string[];
  cta: CtaTarget;
}

export interface ContentCheckOptions {
  /** Prix décidés par le fondateur, tels qu'ils s'écrivent (« 48,20 $ ») : tout autre montant est un prix non décidé. */
  allowedPrices: readonly string[];
  /** Adresses des appels à l'action, par cible. */
  ctaUrls: Readonly<Partial<Record<CtaTarget, string | null>>>;
  /** Numéros publics de l'entreprise (WhatsApp Business) et domaines de courriel admis. */
  allowedPhones?: readonly string[];
  allowedEmailDomains?: readonly string[];
}

const REVENUE_PROMISES: readonly RegExp[] = [
  /\b(gagnez|gagner|gagne|empochez|touchez)\b[^.\n!?]{0,60}\d/i,
  /\b(revenus?|gains?|salaire|profits?)\s+(garantis?|assur[ée]s?|minimum|minimal|de\s+\d)/i,
  /\b\d[\d\s]*\$\s*(par|\/)\s*(jour|semaine|mois|heure|h)\b/i,
  /\b(earn|make|income|revenue|profit)s?\b[^.\n!?]{0,40}\$\s?\d/i,
  /\b(guaranteed|minimum)\s+(income|earnings|revenue)/i,
  /\$\s?\d[\d,.]*\s*(a|per|\/)\s*(day|week|month|hour)\b/i,
];

/**
 * Mot entier, lettres accentuées comprises : `\b` de JavaScript tient « ê » ou « é » pour une limite de mot, d'où des faux
 * positifs (« tes » dans « êtes », « te » dans « côte », « élection » dans « sélection »).
 */
function words(alternatives: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${alternatives})(?![\\p{L}\\p{N}_])`, 'iu');
}

const SENSITIVE_TOPICS: readonly RegExp[] = [
  words('accident|collision|bless[ée]s?|d[ée]c[èe]s|mort|morts|tu[ée]s?'),
  words('agression|harc[èe]lement|violence|menace|plainte|poursuite|litige|tribunal|proc[èe]s|police|arrestation'),
  words('gr[èe]ve|manifestation|politique|[ée]lection|parti|religion|religieux|racisme|discrimination'),
  words('faillite|licenciement|scandale|controverse|fraude|arnaque|enqu[êe]te'),
  words('uber|lyft|eva|bolt'),
  words('lawsuit|strike|accident|assault|harassment|death|scandal|fraud|police|election|politics'),
];

/** Montants en dollars canadiens : « 48,20 $ », « 48.20$ », « $48.20 », « 49 $ ». */
const PRICE = /(?:\$\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?\$)/g;
const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
const EMAIL = /[\w.+-]+@([\w-]+\.[\w.-]+)/g;
const INFORMAL_FR = words("tu|t'as|t'es|te|toi|ton|tes");

/** Montant normalisé (chiffres, virgule décimale, « $ » final) : « $48.20 » et « 48,20 $ » sont le même prix. */
export function normalizePrice(raw: string): string {
  const parts = raw.replace(/[^\d.,]/g, '').replace('.', ',').split(',');
  const decimals = parts[1];
  return `${Number(parts[0])}${decimals ? `,${decimals.padEnd(2, '0').slice(0, 2)}` : ''} $`;
}

function stripAllowedPhones(text: string, allowed: readonly string[]): string {
  return allowed.reduce((t, phone) => t.split(phone).join(' '), text);
}

/** Contrôles d'un contenu : règles du réseau puis interdits. Jamais d'exception : une liste d'écarts, chacun qualifié. */
export function checkContent(draft: ContentDraft, options: ContentCheckOptions): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const rule = SPACE_RULES[draft.space];
  const fullText = [draft.title ?? '', draft.body, draft.caption ?? ''].join('\n');

  if (!rule.formats.includes(draft.format)) issues.push({ kind: 'format_not_allowed', detail: `Format ${draft.format} non admis sur ${rule.name}`, blocking: true });
  if (!rule.languages.includes(draft.language)) issues.push({ kind: 'language_not_allowed', detail: `Langue ${draft.language} non prévue sur ${rule.name}`, blocking: true });
  if (rule.requiresTitle && !draft.title?.trim()) issues.push({ kind: 'title_required', detail: `Un titre est requis sur ${rule.name}`, blocking: true });
  if (!draft.body.trim()) issues.push({ kind: 'body_empty', detail: 'Texte vide', blocking: true });
  if (draft.hashtags.length > rule.maxHashtags) issues.push({ kind: 'too_many_hashtags', detail: `${draft.hashtags.length} mots-clics, ${rule.maxHashtags} au plus sur ${rule.name}`, blocking: true });
  for (const tag of draft.hashtags) if (!normalizeHashtag(tag)) issues.push({ kind: 'hashtag_invalid', detail: `Mot-clic invalide : ${tag.slice(0, 40)}`, blocking: true });

  const ctaUrl = draft.cta === 'none' ? null : (options.ctaUrls[draft.cta] ?? null);
  const composed = composeText({ space: draft.space, title: draft.title, body: draft.body, caption: draft.caption, hashtags: draft.hashtags, ctaUrl });
  if (composed.length > rule.maxChars) issues.push({ kind: 'too_long', detail: `${composed.length} caractères, ${rule.maxChars} au plus sur ${rule.name}`, blocking: true });
  if (draft.cta !== 'none' && rule.clickableLinks && !ctaUrl) issues.push({ kind: 'missing_cta_link', detail: `Aucune adresse connue pour l'appel à l'action ${draft.cta}`, blocking: false });

  for (const pattern of REVENUE_PROMISES) {
    const match = pattern.exec(fullText);
    if (match) {
      issues.push({ kind: 'revenue_promise', detail: `Promesse de revenu : « ${match[0].trim().slice(0, 80)} »`, blocking: true });
      break;
    }
  }
  const allowed = new Set(options.allowedPrices.map(normalizePrice));
  for (const match of fullText.match(PRICE) ?? []) {
    const price = normalizePrice(match);
    if (!allowed.has(price)) {
      issues.push({ kind: 'undecided_price', detail: `Prix non décidé : ${price}`, blocking: true });
      break;
    }
  }
  const phoneMatch = PHONE.exec(stripAllowedPhones(fullText, options.allowedPhones ?? []));
  PHONE.lastIndex = 0;
  if (phoneMatch) issues.push({ kind: 'personal_data', detail: 'Numéro de téléphone dans le texte', blocking: true });
  const domains = new Set((options.allowedEmailDomains ?? []).map((d) => d.toLowerCase()));
  for (const match of fullText.matchAll(EMAIL)) {
    if (!domains.has(String(match[1]).replace(/\.+$/, '').toLowerCase())) {
      issues.push({ kind: 'personal_data', detail: 'Adresse courriel personnelle dans le texte', blocking: true });
      break;
    }
  }
  if (draft.language === 'fr' && INFORMAL_FR.test(fullText)) issues.push({ kind: 'informal_address', detail: 'Tutoiement possible : vouvoiement attendu', blocking: false });
  for (const pattern of SENSITIVE_TOPICS) {
    const match = pattern.exec(fullText);
    if (match) {
      issues.push({ kind: 'sensitive_topic', detail: `Sujet sensible : « ${match[0]} »`, blocking: false });
      break;
    }
  }
  return issues;
}

/** Sensible : classé ainsi par l'agent, ou sujet sensible repéré, ou règle bloquante touchée (approbation humaine obligatoire). */
export function isSensitive(flaggedByAgent: boolean, issues: readonly ContentIssue[]): boolean {
  return flaggedByAgent || issues.some((i) => i.blocking || i.kind === 'sensitive_topic');
}

/** Peut partir sans humain : agent en mode automatique et contenu ni sensible ni bloqué. */
export function autoPublishable(mode: 'auto' | 'approval' | 'manual', sensitive: boolean, issues: readonly ContentIssue[]): boolean {
  return mode === 'auto' && !sensitive && !issues.some((i) => i.blocking);
}
