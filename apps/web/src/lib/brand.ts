/**
 * Marque par organisation sur le web (étape 22), sans dépendance à React ni à Next.js : variables CSS dérivées de la
 * marque (elles remplacent celles de la charte définies dans `globals.css`), hôte de la requête, titre des pages. La
 * marque Neomoov ne produit aucune variable : la feuille de style s'applique telle quelle.
 */
import { NEOMOOV_BRAND, normalizeDomain, type Brand } from '@neomoov/domain';

function channels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Mélange deux couleurs hexadécimales ; `ratio` 0 donne `from`, 1 donne `to`. */
export function mixColors(from: string, to: string, ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const [r1, g1, b1] = channels(from);
  const [r2, g2, b2] = channels(to);
  const part = (a: number, b: number) => Math.round(a + (b - a) * r).toString(16).padStart(2, '0').toUpperCase();
  return `#${part(r1, r2)}${part(g1, g2)}${part(b1, b2)}`;
}

export function isDefaultBrand(brand: Brand): boolean {
  const c = brand.colors;
  const n = NEOMOOV_BRAND.colors;
  return brand.displayName === NEOMOOV_BRAND.displayName && !brand.logoUrl && c.primary === n.primary && c.secondary === n.secondary && c.background === n.background && c.text === n.text && c.accent === n.accent;
}

/**
 * Variables CSS de la marque : la couleur principale prend la place du bleu foncé (boutons, liens, logo texte, contraste
 * vérifié par l'API), la secondaire celle du bleu, l'accent celle du vert, le fond et le texte les leurs ; la teinte
 * claire dérive de la couleur principale. `null` pour la marque Neomoov.
 */
export function brandCssVariables(brand: Brand): Record<string, string> | null {
  if (isDefaultBrand(brand)) return null;
  const c = brand.colors;
  return {
    '--color-brand-blue-dark': c.primary,
    '--color-brand-blue': c.secondary,
    '--color-brand-green': c.accent,
    '--color-brand-ink': c.text,
    '--color-brand-mist': c.background,
    '--color-brand-tint': mixColors(c.primary, '#FFFFFF', 0.88),
  };
}

/**
 * Hôte de la requête (en-tête `X-Forwarded-Host` du mandataire, sinon `Host`), normalisé ; `null` pour `localhost`, une
 * adresse IP ou une valeur invalide (la marque Neomoov s'applique sans appel à l'API).
 */
export function requestHost(forwardedHost: string | null | undefined, host: string | null | undefined): string | null {
  const raw = (forwardedHost ?? host ?? '').split(',')[0]?.trim() ?? '';
  return raw ? normalizeDomain(raw) : null;
}

/** Titre d'une page : « Réserver une course · Taxi Alpha ». */
export function brandTitle(title: string, brand: Brand): string {
  return `${title} · ${brand.displayName}`;
}
