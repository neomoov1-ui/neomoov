import type { SetupIntentResponse } from '@neomoov/domain';
import { describe, expect, it } from 'vitest';
import { CARD_RETURN_URL, cardExpiry, cardFlowOf, cardLabel, withLanguage } from '../src/features/payments/logic';

const base: SetupIntentResponse = {
  provider: 'square', setupIntentId: null, clientSecret: null, customerId: 'CUST', publishableKey: null, applePayMerchantId: null, merchantCountry: 'CA', simulated: false,
  cardFormUrl: 'https://neomoov.net/carte?session=abc', squareApplicationId: 'sq0idp-x', squareLocationId: 'L1', squareEnvironment: 'production',
};

describe('ajout d\'une carte (étape 26)', () => {
  it('Square : page de saisie du web, avec la langue de l\'application', () => {
    expect(cardFlowOf(base, 'fr-CA')).toEqual({ kind: 'web', url: 'https://neomoov.net/carte?session=abc&lang=fr' });
    expect(cardFlowOf(base, 'en')).toEqual({ kind: 'web', url: 'https://neomoov.net/carte?session=abc&lang=en' });
    expect(withLanguage('https://neomoov.net/carte', 'en')).toBe('https://neomoov.net/carte?lang=en');
    expect(CARD_RETURN_URL).toBe('neomoov://carte-enregistree');
  });

  it('simulateur : carte de test par SetupIntent ; Stripe ou réponse incomplète : non offert dans l\'application', () => {
    expect(cardFlowOf({ ...base, provider: 'mock', setupIntentId: 'seti_mock_1', clientSecret: 'seti_mock_1_secret' }, 'fr-CA')).toEqual({ kind: 'simulated', setupIntentId: 'seti_mock_1' });
    expect(cardFlowOf({ ...base, provider: 'stripe', setupIntentId: 'seti_1', clientSecret: 's', cardFormUrl: null }, 'fr-CA')).toEqual({ kind: 'unavailable' });
    expect(cardFlowOf({ ...base, cardFormUrl: null }, 'fr-CA')).toEqual({ kind: 'unavailable' });
    expect(cardFlowOf({ ...base, provider: 'mock', setupIntentId: null }, 'fr-CA')).toEqual({ kind: 'unavailable' });
  });

  it('libellé et échéance d\'une carte : marque et 4 derniers chiffres seulement', () => {
    expect(cardLabel({ brand: 'visa', last4: '4242' })).toBe('VISA •••• 4242');
    expect(cardExpiry({ expMonth: 3, expYear: 2031 })).toBe('03/31');
    expect(cardExpiry({ expMonth: null, expYear: 2031 })).toBeNull();
  });
});
