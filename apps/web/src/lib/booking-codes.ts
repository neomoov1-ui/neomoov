/**
 * Codes saisis dans la réservation web (croissance, étapes 8 et 9) : code promo envoyé avec la demande de devis (l'API
 * le vérifie et calcule la remise), code de parrainage enregistré sur le compte avant la première course. Fonctions
 * pures, testées ; les règles (validité, plafonds, délais) restent dans l'API.
 */
import type { QuoteView } from '@neomoov/domain';

/** Code promo tel que l'API l'attend : majuscules, sans espace, 30 caractères au plus ; vide : aucun code. */
export function normalizePromoCode(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, '').toUpperCase().slice(0, 30);
}

/** Code de parrainage (4 à 12 caractères) ; null s'il est vide ou mal formé. */
export function normalizeReferralCode(input: string | null | undefined): string | null {
  const code = (input ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z0-9-]{4,12}$/.test(code) ? code : null;
}

/** Effet du code promo sur le devis choisi : appliqué (remise), non appliqué, ou aucun code saisi. */
export function promoOutcome(quote: Pick<QuoteView, 'promotionCode' | 'promotionDiscountCents'> | null, code: string): { status: 'applied'; discountCents: number } | { status: 'not_applied' } | null {
  if (!code || !quote) return null;
  if (quote.promotionCode === code && quote.promotionDiscountCents > 0) return { status: 'applied', discountCents: quote.promotionDiscountCents };
  return { status: 'not_applied' };
}

/** Message d'un refus du code de parrainage, par code d'erreur stable de l'API. */
export function referralErrorKey(code: string): 'book.errors.referralUnknown' | 'book.errors.referralOwn' | 'book.errors.referralNotAllowed' | null {
  if (code === 'REFERRAL_CODE_UNKNOWN') return 'book.errors.referralUnknown';
  if (code === 'REFERRAL_OWN_CODE') return 'book.errors.referralOwn';
  if (code.startsWith('REFERRAL_')) return 'book.errors.referralNotAllowed';
  return null;
}

/** Codes prérenseignés par l'adresse de la page (`?promo=…`, `?parrain=…` ou `?ref=…`), par exemple depuis un lien de parrainage. */
export function codesFromSearch(search: string): { promo: string; referral: string } {
  const params = new URLSearchParams(search);
  return { promo: normalizePromoCode(params.get('promo')), referral: normalizeReferralCode(params.get('parrain') ?? params.get('ref')) ?? '' };
}
