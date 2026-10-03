/**
 * Ajout d'une carte (étape 26), logique pure : selon le fournisseur actif renvoyé par `setup-intent`, la page de saisie
 * du web (Square, Web Payments SDK), la carte simulée (fournisseur simulé) ou rien (Stripe : la feuille de paiement
 * native n'est pas encore intégrée à l'application). Sans dépendance React Native : testée seule.
 */
import type { PaymentMethodView, SetupIntentResponse } from '@neomoov/domain';
import { withLanguage } from '@neomoov/mobile-core/format';

/** Langue dans l'adresse de la page de saisie : fonction partagée avec l'application chauffeur (constat mobile 25). */
export { withLanguage };

/** Lien profond de retour de la page de saisie (fin du navigateur intégré). */
export const CARD_RETURN_URL = 'neomoov://carte-enregistree';

export type CardFlow = { kind: 'web'; url: string } | { kind: 'simulated'; setupIntentId: string } | { kind: 'unavailable' };

export function cardFlowOf(setup: SetupIntentResponse, language: 'fr-CA' | 'en'): CardFlow {
  if (setup.provider === 'square' && setup.cardFormUrl) return { kind: 'web', url: withLanguage(setup.cardFormUrl, language) };
  if (setup.provider === 'mock' && setup.setupIntentId) return { kind: 'simulated', setupIntentId: setup.setupIntentId };
  return { kind: 'unavailable' };
}

/** Libellé d'une carte : marque en capitales et 4 derniers chiffres, jamais plus. */
export function cardLabel(card: Pick<PaymentMethodView, 'brand' | 'last4'>): string {
  return `${card.brand.toUpperCase()} •••• ${card.last4}`;
}

/** Échéance MM/AA, ou null si la carte n'en déclare pas. */
export function cardExpiry(card: Pick<PaymentMethodView, 'expMonth' | 'expYear'>): string | null {
  if (!card.expMonth || !card.expYear) return null;
  return `${String(card.expMonth).padStart(2, '0')}/${String(card.expYear).slice(-2)}`;
}
