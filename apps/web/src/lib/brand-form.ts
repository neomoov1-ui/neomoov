/**
 * Formulaire de la marque d'une organisation (étape 22, My Hub) : état du formulaire tiré de ce qui est enregistré, et
 * modification à envoyer (`PUT /admin/organizations/:id/brand`) : seulement les champs changés ; un champ vidé qui avait
 * une valeur envoie `null` (repris du parent, puis de Neomoov) ; une couleur n'est envoyée que si elle a été changée.
 * Fonctions pures, testées.
 */
import { BRAND_COLOR_KEYS, isHexColor, type Brand, type BrandColorKey, type BrandColors, type BrandUpdate, type BrandView } from '@neomoov/domain';

export const BRAND_TEXT_FIELDS = ['displayName', 'logoUrl', 'tagline', 'supportPhone', 'supportEmail', 'emailSenderName', 'emailSenderAddress', 'smsSender', 'termsUrl', 'privacyUrl'] as const;
export type BrandTextField = (typeof BRAND_TEXT_FIELDS)[number];

export interface BrandFormState {
  fields: Record<BrandTextField, string>;
  /** Couleurs saisies (celles que la personne a touchées), en `#RRGGBB`. */
  colors: Partial<Record<BrandColorKey, string>>;
}

export function brandFormFrom(view: BrandView): BrandFormState {
  const fields = Object.fromEntries(BRAND_TEXT_FIELDS.map((k) => [k, view.stored[k] ?? ''])) as Record<BrandTextField, string>;
  return { fields, colors: {} };
}

/** Valeur résolue (héritée ou enregistrée) d'un champ, pour l'indication « valeur reprise ». */
export function resolvedValue(brand: Brand, field: BrandTextField): string | null {
  switch (field) {
    case 'supportPhone': return brand.support.phone;
    case 'supportEmail': return brand.support.email;
    case 'emailSenderName': return brand.emailSender.name;
    case 'emailSenderAddress': return brand.emailSender.address;
    default: return brand[field];
  }
}

/** Couleurs telles qu'elles s'afficheront : la marque résolue, remplacée par les couleurs valides saisies. */
export function effectiveColors(view: BrandView, form: BrandFormState): BrandColors {
  const colors = { ...view.brand.colors };
  for (const key of BRAND_COLOR_KEYS) {
    const value = form.colors[key];
    if (isHexColor(value)) colors[key] = value.toUpperCase();
  }
  return colors;
}

export function brandUpdateFrom(view: BrandView, form: BrandFormState): BrandUpdate {
  const update: Record<string, unknown> = {};
  for (const key of BRAND_TEXT_FIELDS) {
    const value = form.fields[key].trim();
    const stored = view.stored[key] ?? null;
    if (value === '') {
      if (stored !== null) update[key] = null;
    } else if (value !== stored) {
      update[key] = value;
    }
  }
  const colors: Partial<BrandColors> = {};
  for (const key of BRAND_COLOR_KEYS) {
    const value = form.colors[key];
    if (isHexColor(value) && value.toUpperCase() !== view.brand.colors[key].toUpperCase()) colors[key] = value.toUpperCase();
  }
  if (Object.keys(colors).length) update['colors'] = colors;
  return update as BrandUpdate;
}

export const hasBrandChanges = (update: BrandUpdate) => Object.keys(update).length > 0;
