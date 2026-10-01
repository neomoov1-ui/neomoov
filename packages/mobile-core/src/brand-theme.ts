/**
 * Thème dérivé de la marque d'une organisation (étape 22) : les jetons de couleur existants (`theme.ts`) sont recalculés
 * à partir des cinq couleurs de la marque reçue par `GET /v1/config`. Avec la marque Neomoov, rien ne change : la
 * charte du 22 septembre 2026 reste exactement celle des jetons. Fonctions pures, sans React ni React Native.
 */
import { NEOMOOV_BRAND, type Brand } from '@neomoov/domain';
import { colors as base, type ThemeColors } from './theme';

export interface BrandTheme {
  brand: Brand;
  colors: ThemeColors;
  /** Marque Neomoov (aucune organisation rattachée) : jetons d'origine. */
  isDefault: boolean;
}

function channels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function hex(r: number, g: number, b: number): string {
  const part = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Mélange deux couleurs hexadécimales ; `ratio` 0 donne `from`, 1 donne `to`. */
export function mixColors(from: string, to: string, ratio: number): string {
  const r = Math.max(0, Math.min(1, ratio));
  const [r1, g1, b1] = channels(from);
  const [r2, g2, b2] = channels(to);
  return hex(r1 + (r2 - r1) * r, g1 + (g2 - g1) * r, b1 + (b2 - b1) * r);
}

export const darken = (color: string, amount: number) => mixColors(color, '#000000', amount);
export const lighten = (color: string, amount: number) => mixColors(color, '#FFFFFF', amount);

/** Marque Neomoov telle qu'elle est reconnue (couleurs identiques à l'identité) : les jetons d'origine s'appliquent. */
export function isDefaultBrand(brand: Brand | null | undefined): boolean {
  if (!brand) return true;
  const c = brand.colors;
  const n = NEOMOOV_BRAND.colors;
  return c.primary === n.primary && c.secondary === n.secondary && c.background === n.background && c.text === n.text && c.accent === n.accent;
}

/**
 * Jetons de couleur d'une marque : la couleur principale prend la place du bleu (boutons, onglets, liens), sa version
 * foncée celle du bleu foncé, l'accent celle du vert, le fond et le texte les leurs ; la teinte claire dérive de la
 * couleur principale. Le sombre (`night`), le blanc et les couleurs d'état ne changent pas.
 */
export function brandColors(brand: Brand): ThemeColors {
  if (isDefaultBrand(brand)) return base;
  const c = brand.colors;
  return {
    ...base,
    blue: c.primary,
    blueDark: darken(c.primary, 0.25),
    green: c.accent,
    ink: c.text,
    mist: c.background,
    tint: lighten(c.primary, 0.88),
  };
}

export function brandTheme(brand: Brand | null | undefined): BrandTheme {
  const resolved = brand ?? NEOMOOV_BRAND;
  return { brand: resolved, colors: brandColors(resolved), isDefault: isDefaultBrand(resolved) };
}
