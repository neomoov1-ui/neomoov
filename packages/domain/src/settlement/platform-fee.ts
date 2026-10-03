/**
 * Redevance Neomoov (décision du fondateur du 3 octobre 2026) : frais de plateforme prélevés sur le chauffeur pour chaque
 * course terminée, y compris les chauffeurs Pilote et ceux d'une flotte. À ne pas confondre avec la redevance
 * gouvernementale par course (`regulatoryFeeCents`, registre `redevance_ledger`), qui reste due à l'État et n'est pas
 * touchée ici. Fonctions pures, montants en cents, taux en points de base (1000 = 10 %).
 *
 * - Taux réglé chauffeur par chauffeur dans My Hub, borné de 5 % à 10 % (500 à 1000 points de base), 10 % par défaut.
 * - Assiette : le tarif du chauffeur (`fareCents`, ce qui lui revient, avant la remise de promotion que Neomoov lui
 *   compense) ; jamais les taxes, la redevance gouvernementale, les frais de service de Neomoov, les péages ni le pourboire.
 * - Arrondi au cent le plus proche (demi-cent vers le haut), comme le reste des calculs d'argent.
 */

import { mulDivRound } from '../pricing/quote.js';

export const PLATFORM_FEE_MIN_BPS = 500;
export const PLATFORM_FEE_MAX_BPS = 1000;
export const PLATFORM_FEE_DEFAULT_BPS = 1000;

/** Vrai pour un taux entier compris entre 5 % et 10 % inclus. */
export function isValidPlatformFeeBps(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= PLATFORM_FEE_MIN_BPS && value <= PLATFORM_FEE_MAX_BPS;
}

/**
 * Taux à appliquer à partir d'un réglage (`drivers.platform_fee_default_bps`) ou d'une valeur lue : la valeur si elle est
 * valide, sinon le repli (10 % par défaut). Un réglage hors bornes ne passe jamais.
 */
export function platformFeeBpsOrDefault(value: unknown, fallback: number = PLATFORM_FEE_DEFAULT_BPS): number {
  if (isValidPlatformFeeBps(value)) return value;
  return isValidPlatformFeeBps(fallback) ? fallback : PLATFORM_FEE_DEFAULT_BPS;
}

export interface PlatformFeeInput {
  /** Tarif complet du chauffeur, en cents (avant la remise de promotion compensée par Neomoov). */
  fareCents: number;
  /** Taux du chauffeur en points de base, de 500 à 1000. */
  rateBps: number;
}

export interface PlatformFee {
  baseCents: number;
  rateBps: number;
  amountCents: number;
}

/** Redevance Neomoov d'une course terminée. Taux hors bornes ou tarif invalide : erreur (jamais de montant faux). */
export function computePlatformFee(input: PlatformFeeInput): PlatformFee {
  if (!isValidPlatformFeeBps(input.rateBps)) throw new RangeError(`Taux de redevance Neomoov hors bornes : ${input.rateBps}`);
  if (!Number.isInteger(input.fareCents) || input.fareCents < 0) throw new RangeError(`Tarif invalide : ${input.fareCents}`);
  return { baseCents: input.fareCents, rateBps: input.rateBps, amountCents: mulDivRound(input.fareCents, input.rateBps, 10_000) };
}

/** Taux lisible en français : 1000 → « 10 % », 750 → « 7,5 % », 825 → « 8,25 % ». */
export function formatPlatformFeeRate(rateBps: number): string {
  const whole = Math.trunc(rateBps / 100);
  const rest = Math.abs(rateBps % 100);
  const decimals = rest === 0 ? '' : `,${String(rest).padStart(2, '0').replace(/0$/, '')}`;
  return `${whole}${decimals} %`;
}

/** Libellé d'une ligne de relevé : « Redevance Neomoov (10 %) ». */
export function platformFeeLabel(rateBps: number): string {
  return `Redevance Neomoov (${formatPlatformFeeRate(rateBps)})`;
}
