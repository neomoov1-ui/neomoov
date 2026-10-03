import type { FavoriteView, QuoteView } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import {
  amountDueFor, normalizePromoCode, priceRowsFor, promoRefusal, promoStatus, quoteExpired, quoteFitsChoice, quoteRequestOf, samePrice, sumRows,
} from '../src/features/booking/logic';
import { canAddFavorite, canEnterReferral, isReferralCode, normalizeReferralCode, sortFavorites } from '../src/features/growth/logic';

/** Devis d'une course de 27,45 $ (taxes comprises) avec 5 $ de crédits déduits, tel que l'API le renvoie sans mode de paiement. */
function quoteWithCredits(overrides: Partial<QuoteView> = {}): QuoteView {
  return {
    id: 'q-1', category: 'neo_premium', distanceMeters: 8000, durationSeconds: 1080,
    lines: [
      { code: 'base_fare', label: 'Prise en charge', amountCents: 2455 },
      { code: 'service_fee', label: 'Frais de service', amountCents: 200 },
      { code: 'regulatory_fee', label: 'Redevance', amountCents: 90 },
      { code: 'gst', label: 'TPS', amountCents: 137 },
      { code: 'qst', label: 'TVQ', amountCents: 274 },
      { code: 'credits', label: 'Crédits', amountCents: -500 },
    ],
    fareCents: 2455, serviceFeeCents: 200, regulatoryFeeCents: 90, tollsCents: 0, promotionCode: null, promotionDiscountCents: 0, alignmentDiscountCents: 0,
    subtotalCents: 2745, gstCents: 137, qstCents: 274, totalCents: 3156, creditsAppliedCents: 500, creditsPrepaidOnly: true, amountDueCents: 2656, maxConsentedCents: 3156,
    flatRateCode: null, ignoredOptions: [], estimated: false, eta: { seconds: null, status: 'on_availability' }, requestedAt: '2026-10-03T20:00:00.000Z',
    validUntil: '2026-10-03T18:00:00.000Z', fingerprint: 'x', ...overrides,
  };
}

const route = {
  origin: { address: '4500 rue Saint-Denis, Montréal', coordinates: { lat: 45.523, lng: -73.582 } },
  destination: { address: '1000 rue De La Gauchetière Ouest, Montréal', coordinates: { lat: 45.5, lng: -73.567 } },
  stops: [],
  pickupAt: '2026-10-03T20:00:00.000Z',
};

describe('crédits et mode de paiement (revue du 2 octobre 2026, constat 2)', () => {
  const q = quoteWithCredits();

  it('payée au chauffeur : la course est due en entier, sans la ligne des crédits ; prépayée : le reste à payer de l\'API', () => {
    expect(amountDueFor(q, 'pay_driver_after')).toBe(3156);
    expect(amountDueFor(q, 'prepaid')).toBe(2656);
    expect(amountDueFor(q, null)).toBe(2656);
    const payAfter = priceRowsFor(q, 'pay_driver_after');
    expect(payAfter.some((r) => r.code === 'credits')).toBe(false);
    expect(sumRows(payAfter)).toBe(amountDueFor(q, 'pay_driver_after'));
    expect(sumRows(priceRowsFor(q, 'prepaid'))).toBe(amountDueFor(q, 'prepaid'));
  });

  it('crédits admis aussi en paiement direct (réglage futur) : le montant dû reste celui de l\'API', () => {
    const open = quoteWithCredits({ creditsPrepaidOnly: false });
    expect(amountDueFor(open, 'pay_driver_after')).toBe(2656);
    expect(priceRowsFor(open, 'pay_driver_after').some((r) => r.code === 'credits')).toBe(true);
  });

  it('un devis avec crédits ne sert pas une course payée au chauffeur ; un devis fait pour le chauffeur ne sert pas une course prépayée', () => {
    expect(quoteFitsChoice(q, null, 'pay_driver_after')).toBe(false);
    expect(quoteFitsChoice(q, null, 'prepaid')).toBe(true);
    const direct = quoteWithCredits({ creditsAppliedCents: 0, amountDueCents: 3156, lines: q.lines.filter((l) => l.code !== 'credits') });
    expect(quoteFitsChoice(direct, 'pay_driver_after', 'pay_driver_after')).toBe(true);
    expect(quoteFitsChoice(direct, 'pay_driver_after', 'prepaid')).toBe(false);
    // Sans crédits au compte, un devis sans mode convient aux deux.
    expect(quoteFitsChoice(direct, null, 'pay_driver_after')).toBe(true);
  });

  it('nouveau devis pour le paiement au chauffeur : même prix affiché, la réservation part sans nouvelle confirmation', () => {
    const direct = quoteWithCredits({ id: 'q-2', creditsAppliedCents: 0, amountDueCents: 3156 });
    expect(samePrice(q, direct, 'pay_driver_after')).toBe(true);
    // Retour au prépaiement avec un devis sans crédits : le montant dû change, le client confirme de nouveau.
    expect(samePrice(direct, q, 'prepaid')).toBe(false);
    expect(samePrice(q, quoteWithCredits({ totalCents: 3200 }), 'pay_driver_after')).toBe(false);
  });

  it('la demande de devis porte le mode de paiement seulement quand il est donné', () => {
    const options = { flex: false, priority: false, childSeat: false, luggage: false, pet: true };
    expect(quoteRequestOf({ ...route, options }, 'pay_driver_after')).toMatchObject({ paymentChoice: 'pay_driver_after', options: { pet: true } });
    expect(quoteRequestOf({ ...route, options })).not.toHaveProperty('paymentChoice');
    expect(quoteRequestOf({ ...route, options }, null)).not.toHaveProperty('paymentChoice');
  });

  it('devis expiré dans la marge de 30 secondes', () => {
    expect(quoteExpired(q, Date.parse('2026-10-03T17:59:31.000Z'))).toBe(true);
    expect(quoteExpired(q, Date.parse('2026-10-03T17:59:00.000Z'))).toBe(false);
  });
});

describe('code promo (5.9)', () => {
  it('saisie normalisée, envoyée avec le devis, retirée quand elle est vide', () => {
    expect(normalizePromoCode(' lancement 30 ')).toBe('LANCEMENT30');
    const options = { flex: false, priority: false, childSeat: false, luggage: false, pet: false };
    expect(quoteRequestOf({ ...route, options: { ...options, promoCode: 'merci10' } }).options).toMatchObject({ promoCode: 'MERCI10' });
    expect(quoteRequestOf({ ...route, options: { ...options, promoCode: '  ' } }).options).not.toHaveProperty('promoCode');
    expect(quoteRequestOf({ ...route, options: { ...options, favouriteDriverId: 'd-1' } }).options).toMatchObject({ favouriteDriverId: 'd-1' });
  });

  it('motif du refus : code inconnu, motif stable de l\'API, autre erreur ignorée', () => {
    expect(promoRefusal({ code: 'PROMO_CODE_UNKNOWN' })).toBe('unknown_code');
    expect(promoRefusal({ code: 'PROMOTION_NOT_APPLICABLE', details: { code: 'X', reason: 'first_ride_only' } })).toBe('first_ride_only');
    expect(promoRefusal({ code: 'PROMOTION_NOT_APPLICABLE', details: { reason: 'motif_futur' } })).toBe('inactive');
    expect(promoRefusal({ code: 'OUT_OF_SERVICE_AREA' })).toBeNull();
    expect(promoRefusal(null)).toBeNull();
  });

  it('effet sur la catégorie choisie : appliqué avec une remise, sinon non applicable à cette catégorie', () => {
    expect(promoStatus(quoteWithCredits({ promotionCode: 'LANCEMENT30', promotionDiscountCents: 700 }), 'lancement30')).toBe('applied');
    expect(promoStatus(quoteWithCredits(), 'LANCEMENT30')).toBe('not_for_category');
    expect(promoStatus(quoteWithCredits(), undefined)).toBeNull();
  });
});

describe('parrainage et « Mes chauffeurs » (5.9, 5.10)', () => {
  it('code de parrain : normalisé, 4 à 12 lettres et chiffres, saisi tant que le compte n\'a pas de parrain', () => {
    expect(normalizeReferralCode('neo-ab 12')).toBe('NEOAB12');
    expect(isReferralCode('NEOAB12')).toBe(true);
    expect(isReferralCode('AB')).toBe(false);
    expect(canEnterReferral({ referredBy: null })).toBe(true);
    expect(canEnterReferral({ referredBy: { code: 'NEOAB12', status: 'pending' } })).toBe(false);
    expect(canEnterReferral(undefined)).toBe(false);
  });

  it('favoris : disponibles d\'abord, puis les plus fidèles', () => {
    const favorite = (driverId: string, available: boolean, ridesTogether: number): FavoriteView => ({ driverId, firstName: driverId, rating: 4.9, ridesTogether, vehicle: null, available, since: '2026-09-01T00:00:00.000Z' });
    expect(sortFavorites([favorite('a', false, 9), favorite('b', true, 1), favorite('c', true, 4)]).map((f) => f.driverId)).toEqual(['c', 'b', 'a']);
  });

  it('ajout aux favoris : course terminée avec un chauffeur qui n\'y est pas encore', () => {
    expect(canAddFavorite({ state: 'rated', driver: { id: 'd-1' } }, [])).toBe(true);
    expect(canAddFavorite({ state: 'rated', driver: { id: 'd-1' } }, [{ driverId: 'd-1' }])).toBe(false);
    expect(canAddFavorite({ state: 'in_progress', driver: { id: 'd-1' } }, [])).toBe(false);
    expect(canAddFavorite({ state: 'completed', driver: null }, [])).toBe(false);
  });
});
