/**
 * Marque par organisation dans l'application unique et le web (étape 22, amendement v1.2 section 5, décision D11 : une
 * seule application publiée). Chaque organisation peut définir un nom commercial, un logo, des couleurs, des textes, les
 * coordonnées de son assistance, l'expéditeur de ses courriels et ses conditions ; ce qui manque vient de la marque
 * Neomoov (identité du prompt 0 de `docs/design/02-prompts-claude-design.md`). Icône, nom sous l'icône, écran de
 * démarrage et nom des notifications restent « Neomoov » (règles 4.2.6 et 4.3 d'Apple) : ils ne sont pas ici.
 * Fonctions pures ; la base et l'API appliquent.
 */
import { z } from 'zod';
import { phoneE164, uuid } from '../schemas/common.js';

export const BRAND_COLOR_KEYS = ['primary', 'secondary', 'background', 'text', 'accent'] as const;
export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number];

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value);
}

/** Couleur hexadécimale à six chiffres (`#0B5FB5`), rendue en majuscules. */
export const hexColorSchema = z.string().trim().regex(HEX_COLOR, 'Couleur hexadécimale attendue, par exemple #0B5FB5').transform((v) => v.toUpperCase());

export const brandColorsSchema = z.object({
  /** Action principale (boutons, onglet actif, liens). */
  primary: hexColorSchema,
  /** Accents secondaires (graphiques, trajet). */
  secondary: hexColorSchema,
  /** Fond des écrans. */
  background: hexColorSchema,
  /** Texte courant sur le fond. */
  text: hexColorSchema,
  /** Succès, en ligne, prise en charge. */
  accent: hexColorSchema,
});
export type BrandColors = z.infer<typeof brandColorsSchema>;

const TEXT_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;
/** Textes personnalisables (clé en camelCase, 500 caractères au plus), 50 au plus. */
export const brandTextsSchema = z.record(z.string().regex(TEXT_KEY, 'Clé de texte en camelCase attendue'), z.string().trim().max(500)).refine((t) => Object.keys(t).length <= 50, 'Au plus 50 textes');
export type BrandTexts = z.infer<typeof brandTextsSchema>;

const httpUrl = z.string().trim().url().max(500).refine((u) => /^https?:\/\//i.test(u), 'Adresse http(s) attendue');
const email = z.string().trim().toLowerCase().email().max(254);
/** Expéditeur alphanumérique (3 à 11 caractères) ou numéro E.164 : ce que les opérateurs de textos acceptent. */
const smsSender = z.string().trim().regex(/^(?:[A-Za-z0-9 ]{3,11}|\+[1-9]\d{6,14})$/, 'Expéditeur de textos : 3 à 11 caractères alphanumériques, ou un numéro E.164');

/** Marque résolue, telle que les applications et le web l'affichent : rien de personnel, tout est renseigné. */
export const brandSchema = z.object({
  displayName: z.string(),
  logoUrl: z.string().nullable(),
  colors: brandColorsSchema,
  tagline: z.string().nullable(),
  texts: brandTextsSchema,
  support: z.object({ phone: z.string().nullable(), email: z.string().nullable() }),
  emailSender: z.object({ name: z.string(), address: z.string() }),
  smsSender: z.string().nullable(),
  termsUrl: z.string(),
  privacyUrl: z.string(),
});
export type Brand = z.infer<typeof brandSchema>;

/** Ce qu'une organisation enregistre (`PUT /v1/admin/organizations/{id}/brand`) : tout est facultatif, `null` efface. */
export const brandUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(120).nullable().optional(),
  logoUrl: httpUrl.nullable().optional(),
  colors: brandColorsSchema.partial().optional(),
  tagline: z.string().trim().max(200).nullable().optional(),
  texts: brandTextsSchema.optional(),
  supportPhone: phoneE164.nullable().optional(),
  supportEmail: email.nullable().optional(),
  emailSenderName: z.string().trim().min(2).max(120).nullable().optional(),
  emailSenderAddress: email.nullable().optional(),
  smsSender: smsSender.nullable().optional(),
  termsUrl: httpUrl.nullable().optional(),
  privacyUrl: httpUrl.nullable().optional(),
});
export type BrandUpdate = z.infer<typeof brandUpdateSchema>;

/** Marque enregistrée d'une organisation (ligne `brands`) : chaque champ absent ou nul est pris chez Neomoov. */
export interface StoredBrand {
  displayName?: string | null | undefined;
  logoUrl?: string | null | undefined;
  colors?: Partial<Record<BrandColorKey, string | null | undefined>> | null | undefined;
  tagline?: string | null | undefined;
  texts?: Record<string, string> | null | undefined;
  supportPhone?: string | null | undefined;
  supportEmail?: string | null | undefined;
  emailSenderName?: string | null | undefined;
  emailSenderAddress?: string | null | undefined;
  smsSender?: string | null | undefined;
  termsUrl?: string | null | undefined;
  privacyUrl?: string | null | undefined;
}

/** Identité Neomoov (prompt 0) : bleu électrique foncé pour l'action, bleu électrique, fond, gris anthracite, vert lime. */
export const NEOMOOV_BRAND: Brand = {
  displayName: 'Neomoov',
  logoUrl: null,
  colors: { primary: '#0B5FB5', secondary: '#1485E0', background: '#F4F7FB', text: '#2C3A4A', accent: '#6CC04A' },
  tagline: 'Avancez vers demain.',
  texts: {},
  support: { phone: null, email: null },
  emailSender: { name: 'Neomoov', address: 'notifications@neomoov.net' },
  smsSender: null,
  termsUrl: 'https://neomoov.net/conditions-d-utilisation/',
  privacyUrl: 'https://neomoov.net/politique-de-confidentialite/',
};

const pick = <T>(value: T | null | undefined, fallback: T): T => (value === null || value === undefined ? fallback : value);

/**
 * Fusion d'une marque enregistrée (ou rien) avec les valeurs par défaut : couleur par couleur, texte par texte. Une
 * couleur enregistrée invalide est ignorée plutôt que d'empêcher l'affichage. Le nom d'expéditeur des courriels suit le
 * nom commercial quand il n'est pas fixé ; l'adresse d'envoi reste celle de la plateforme tant que le domaine du client
 * n'est pas authentifié chez le fournisseur de courriels.
 */
export function resolveBrand(stored: StoredBrand | null | undefined, defaults: Brand = NEOMOOV_BRAND): Brand {
  const s = stored ?? {};
  const colors = { ...defaults.colors };
  for (const key of BRAND_COLOR_KEYS) {
    const value = s.colors?.[key];
    if (isHexColor(value)) colors[key] = value.toUpperCase();
  }
  const displayName = pick(s.displayName, defaults.displayName);
  return {
    displayName,
    logoUrl: pick(s.logoUrl, defaults.logoUrl),
    colors,
    tagline: pick(s.tagline, defaults.tagline),
    texts: { ...defaults.texts, ...(s.texts ?? {}) },
    support: { phone: pick(s.supportPhone, defaults.support.phone), email: pick(s.supportEmail, defaults.support.email) },
    emailSender: {
      name: pick(s.emailSenderName, s.displayName ? displayName : defaults.emailSender.name),
      address: pick(s.emailSenderAddress, defaults.emailSender.address),
    },
    smsSender: pick(s.smsSender, defaults.smsSender),
    termsUrl: pick(s.termsUrl, defaults.termsUrl),
    privacyUrl: pick(s.privacyUrl, defaults.privacyUrl),
  };
}

/** Applique une mise à jour partielle à une marque enregistrée (`null` efface, absent conserve). */
export function applyBrandUpdate(stored: StoredBrand | null | undefined, update: BrandUpdate): StoredBrand {
  const s: StoredBrand = { ...(stored ?? {}) };
  if (update.displayName !== undefined) s.displayName = update.displayName;
  if (update.logoUrl !== undefined) s.logoUrl = update.logoUrl;
  if (update.tagline !== undefined) s.tagline = update.tagline;
  if (update.texts !== undefined) s.texts = update.texts;
  if (update.supportPhone !== undefined) s.supportPhone = update.supportPhone;
  if (update.supportEmail !== undefined) s.supportEmail = update.supportEmail;
  if (update.emailSenderName !== undefined) s.emailSenderName = update.emailSenderName;
  if (update.emailSenderAddress !== undefined) s.emailSenderAddress = update.emailSenderAddress;
  if (update.smsSender !== undefined) s.smsSender = update.smsSender;
  if (update.termsUrl !== undefined) s.termsUrl = update.termsUrl;
  if (update.privacyUrl !== undefined) s.privacyUrl = update.privacyUrl;
  if (update.colors) {
    const colors = { ...(s.colors ?? {}) };
    for (const key of BRAND_COLOR_KEYS) if (update.colors[key] !== undefined) colors[key] = update.colors[key];
    s.colors = colors;
  }
  return s;
}

// --- Contraste (WCAG 2.1, critère 1.4.3 : 4,5 pour 1 sur le texte courant) ---

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative d'une couleur hexadécimale (0 pour le noir, 1 pour le blanc). */
export function relativeLuminance(hex: string): number {
  if (!isHexColor(hex)) throw new Error(`Couleur hexadécimale attendue : ${hex}`);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapport de contraste entre deux couleurs (de 1 à 21), arrondi au centième. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

export const WCAG_AA_TEXT_RATIO = 4.5;
export const BUTTON_TEXT_COLOR = '#FFFFFF';

export interface ContrastIssue {
  pair: 'text_on_background' | 'button_text_on_primary';
  ratio: number;
  minimum: number;
  message: string;
}

/**
 * Contrôle WCAG AA de la marque : le texte sur le fond, et le texte blanc des boutons sur la couleur principale (règle
 * du prompt 0 : jamais de texte blanc sur une couleur trop claire). Vide quand tout passe.
 */
export function brandContrastIssues(colors: BrandColors): ContrastIssue[] {
  const issues: ContrastIssue[] = [];
  const text = contrastRatio(colors.text, colors.background);
  if (text < WCAG_AA_TEXT_RATIO) {
    issues.push({ pair: 'text_on_background', ratio: text, minimum: WCAG_AA_TEXT_RATIO, message: `Le texte (${colors.text}) sur le fond (${colors.background}) a un contraste de ${text.toFixed(2)} pour 1 ; 4,5 pour 1 au minimum` });
  }
  const button = contrastRatio(BUTTON_TEXT_COLOR, colors.primary);
  if (button < WCAG_AA_TEXT_RATIO) {
    issues.push({ pair: 'button_text_on_primary', ratio: button, minimum: WCAG_AA_TEXT_RATIO, message: `Le texte blanc des boutons sur la couleur principale (${colors.primary}) a un contraste de ${button.toFixed(2)} pour 1 ; 4,5 pour 1 au minimum : choisissez une couleur principale plus foncée` });
  }
  return issues;
}

// --- Résumés pour le sélecteur d'organisation et la configuration des applications ---

export const brandSummarySchema = z.object({ displayName: z.string(), logoUrl: z.string().nullable(), primary: hexColorSchema });
export type BrandSummary = z.infer<typeof brandSummarySchema>;

export function brandSummary(brand: Brand): BrandSummary {
  return { displayName: brand.displayName, logoUrl: brand.logoUrl, primary: brand.colors.primary };
}

/** Organisation d'un utilisateur dans `GET /v1/config` (adhésion ou profil client) : de quoi choisir, rien de plus. */
export const organizationSummarySchema = z.object({
  id: uuid,
  name: z.string(),
  /** Code de rattachement : celui du sélecteur (`POST /v1/me/organizations/attach`) et du code QR de l'organisation. */
  joinCode: z.string(),
  /** Organisation dont la marque est affichée (profil client rattaché). */
  current: z.boolean(),
  brand: brandSummarySchema,
});
export type OrganizationSummary = z.infer<typeof organizationSummarySchema>;

/** `POST /v1/me/organizations/attach` : l'organisation rattachée (courante) et sa marque résolue. */
export const attachOrganizationResultSchema = z.object({ organization: organizationSummarySchema, brand: brandSchema });
export type AttachOrganizationResult = z.infer<typeof attachOrganizationResultSchema>;

/** `GET /v1/public/brand` : marque d'une organisation par code ou par domaine, sans donnée personnelle. */
export const publicBrandSchema = z.object({ organizationId: uuid, organizationName: z.string(), joinCode: z.string(), brand: brandSchema });
export type PublicBrand = z.infer<typeof publicBrandSchema>;

/** Marque d'une organisation vue par son administrateur : ce qui est enregistré et le résultat résolu. */
export const brandViewSchema = z.object({
  organizationId: uuid,
  joinCode: z.string(),
  brand: brandSchema,
  stored: brandUpdateSchema,
  updatedAt: z.string().nullable(),
});
export type BrandView = z.infer<typeof brandViewSchema>;
