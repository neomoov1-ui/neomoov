/** Codes promo et de parrainage de la réservation web, et formulaire de la marque d'une organisation (fonctions pures). */
import { NEOMOOV_BRAND, type BrandView } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { codesFromSearch, normalizePromoCode, normalizeReferralCode, promoOutcome, referralErrorKey } from '../src/lib/booking-codes';
import { brandFormFrom, brandUpdateFrom, effectiveColors, hasBrandChanges, resolvedValue } from '../src/lib/brand-form';

describe('codes de la réservation web', () => {
  it('code promo : majuscules, sans espace, 30 caractères au plus', () => {
    expect(normalizePromoCode(' bien venue ')).toBe('BIENVENUE');
    expect(normalizePromoCode(null)).toBe('');
    expect(normalizePromoCode('x'.repeat(40))).toHaveLength(30);
  });

  it('code de parrainage : 4 à 12 caractères, sinon refusé avant l\'appel', () => {
    expect(normalizeReferralCode(' ab12cd ')).toBe('AB12CD');
    expect(normalizeReferralCode('abc')).toBeNull();
    expect(normalizeReferralCode('abc def ghi jklm')).toBeNull();
    expect(normalizeReferralCode('')).toBeNull();
  });

  it('effet du code promo sur le devis choisi', () => {
    expect(promoOutcome({ promotionCode: 'BIENVENUE', promotionDiscountCents: 500 }, 'BIENVENUE')).toEqual({ status: 'applied', discountCents: 500 });
    expect(promoOutcome({ promotionCode: null, promotionDiscountCents: 0 }, 'BIENVENUE')).toEqual({ status: 'not_applied' });
    expect(promoOutcome({ promotionCode: 'AUTRE', promotionDiscountCents: 300 }, 'BIENVENUE')).toEqual({ status: 'not_applied' });
    expect(promoOutcome({ promotionCode: null, promotionDiscountCents: 0 }, '')).toBeNull();
    expect(promoOutcome(null, 'BIENVENUE')).toBeNull();
  });

  it('refus du parrainage traduits par code stable', () => {
    expect(referralErrorKey('REFERRAL_CODE_UNKNOWN')).toBe('book.errors.referralUnknown');
    expect(referralErrorKey('REFERRAL_OWN_CODE')).toBe('book.errors.referralOwn');
    expect(referralErrorKey('REFERRAL_AFTER_FIRST_RIDE')).toBe('book.errors.referralNotAllowed');
    expect(referralErrorKey('REFERRAL_WINDOW_CLOSED')).toBe('book.errors.referralNotAllowed');
    expect(referralErrorKey('LEAD_TIME_TOO_SHORT')).toBeNull();
  });

  it('codes prérenseignés par l\'adresse (lien de parrainage)', () => {
    expect(codesFromSearch('?promo=ete26&parrain=ab12cd')).toEqual({ promo: 'ETE26', referral: 'AB12CD' });
    expect(codesFromSearch('?ref=zz99')).toEqual({ promo: '', referral: 'ZZ99' });
    expect(codesFromSearch('?parrain=<script>')).toEqual({ promo: '', referral: '' });
  });
});

describe('formulaire de la marque d\'une organisation', () => {
  const view: BrandView = {
    organizationId: '44444444-4444-4444-8444-444444444444', joinCode: 'ALPHA7',
    brand: { ...NEOMOOV_BRAND, displayName: 'Taxi Alpha', support: { phone: '+15145550142', email: null } },
    stored: { displayName: 'Taxi Alpha', supportPhone: '+15145550142' }, updatedAt: null,
  };

  it('seuls les champs changés partent ; un champ vidé efface (null) ; une couleur seulement si elle change', () => {
    const form = brandFormFrom(view);
    expect(form.fields.displayName).toBe('Taxi Alpha');
    expect(form.fields.tagline).toBe('');
    expect(hasBrandChanges(brandUpdateFrom(view, form))).toBe(false);
    form.fields.supportPhone = '';
    form.fields.tagline = '  Toujours à l\'heure ';
    form.colors.primary = '#0b5fb5';
    form.colors.text = '#111111';
    expect(brandUpdateFrom(view, form)).toEqual({ supportPhone: null, tagline: 'Toujours à l\'heure', colors: { text: '#111111' } });
    expect(effectiveColors(view, form).text).toBe('#111111');
  });

  it('valeur reprise affichée pour un champ vide', () => {
    expect(resolvedValue(view.brand, 'supportPhone')).toBe('+15145550142');
    expect(resolvedValue(view.brand, 'emailSenderName')).toBe(NEOMOOV_BRAND.emailSender.name);
    expect(resolvedValue(view.brand, 'termsUrl')).toBe(NEOMOOV_BRAND.termsUrl);
  });
});
