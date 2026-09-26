/**
 * Règles de paiement (section 5.6, prompt 07), sans effet de bord : montant autorisé à la réservation, montant capturé
 * à la fin de course, reste remboursable. Montants en cents.
 */
import { CARD_METHODS, type PaymentMethod } from '../enums.js';

export interface AuthorizationRules {
  /** Marge au-dessus du prix maximal consenti, en millionièmes (150 000 = 15 %), pour l'attente et les arrêts. */
  marginPpm: number;
  /** Plafond de la marge, en cents (2 000 = 20 $). */
  marginCapCents: number;
}

export const DEFAULT_AUTHORIZATION_RULES: AuthorizationRules = { marginPpm: 150_000, marginCapCents: 2_000 };

/** Moyen prépayé par carte dans l'application (autorisation à capture différée). */
export function isCardMethod(method: PaymentMethod): boolean {
  return (CARD_METHODS as readonly string[]).includes(method);
}

/** Montant autorisé : prix maximal consenti plus la marge, arrondie au cent et plafonnée. */
export function authorizationCents(maxConsentedCents: number, rules: AuthorizationRules = DEFAULT_AUTHORIZATION_RULES): number {
  if (!Number.isInteger(maxConsentedCents) || maxConsentedCents < 0) throw new RangeError('Prix maximal consenti invalide');
  const margin = Math.min(Math.round((maxConsentedCents * rules.marginPpm) / 1_000_000), rules.marginCapCents);
  return maxConsentedCents + Math.max(0, margin);
}

/**
 * Montant à capturer : le montant dû, jamais plus que l'autorisation. `shortfallCents` est ce qui reste dû au-delà
 * (ne devrait pas arriver : la marge couvre l'attente et les arrêts) et devient un solde à régler par le client.
 */
export function captureCents(dueCents: number, authorizedCents: number): { captureCents: number; shortfallCents: number } {
  const due = Math.max(0, Math.round(dueCents));
  const capture = Math.min(due, Math.max(0, authorizedCents));
  return { captureCents: capture, shortfallCents: due - capture };
}

/** Reste remboursable d'un paiement : capturé moins les remboursements déjà faits (jamais négatif). */
export function refundableCents(capturedCents: number, refundedCents: number): number {
  return Math.max(0, capturedCents - refundedCents);
}
