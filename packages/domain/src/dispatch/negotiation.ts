/**
 * Négociation encadrée (section 5.5, décision D34, amendements v1.1) : bornes de la proposition du client, validation
 * d'une contre-proposition du chauffeur, prix convenu et invariant du prix maximal consenti (loi T-11.2).
 * Fonctions pures ; les bornes viennent de `settings` (`pricing.negotiation_floor_ppm`, `pricing.negotiation_ceiling_ppm`)
 * et les drapeaux de l'environnement (`FEATURE_NEGOTIATION`, `FEATURE_NEGOTIATION_ABOVE_MAX`).
 */

export const EXCEPTIONAL_REASONS = ['road_conditions', 'event', 'imposed_detour', 'other'] as const;
export type ExceptionalReason = (typeof EXCEPTIONAL_REASONS)[number];

export const NEGOTIATION_MODES = ['fixed', 'negotiation'] as const;
export type NegotiationMode = (typeof NEGOTIATION_MODES)[number];

export interface NegotiationRules {
  /** Plancher de la proposition du client, en parties par million du prix affiché (700 000 = 70 %). */
  floorPpm: number;
  /** Plafond d'une contre-offre au-dessus du prix affiché (1 300 000 = 130 %). */
  ceilingPpm: number;
  /** Drapeau `FEATURE_NEGOTIATION_ABOVE_MAX`. */
  aboveMaxEnabled: boolean;
}

export function roundToDollar(cents: number): number {
  return Math.round(cents / 100) * 100;
}

/** Plancher de la proposition : part du prix affiché, arrondie au dollar supérieur, jamais au-dessus du prix affiché. */
export function proposalFloorCents(displayedCents: number, floorPpm: number): number {
  const ppm = Math.min(1_000_000, Math.max(0, floorPpm));
  return Math.min(displayedCents, Math.ceil((displayedCents * ppm) / 1_000_000 / 100) * 100);
}

/** Proposition P' bornée entre le plancher et P, arrondie au dollar ; `adjusted` dit si la valeur demandée a été modifiée. */
export function clampProposal(displayedCents: number, proposedCents: number, floorPpm: number): { totalCents: number; floorCents: number; adjusted: boolean } {
  const floorCents = proposalFloorCents(displayedCents, floorPpm);
  const totalCents = Math.min(displayedCents, Math.max(floorCents, roundToDollar(Math.max(0, proposedCents))));
  return { totalCents, floorCents, adjusted: totalCents !== proposedCents };
}

/** Plafond d'une contre-offre au-dessus de P : jamais sous P lui-même. */
export function ceilingCentsOf(displayedCents: number, ceilingPpm: number): number {
  return Math.floor((displayedCents * Math.max(1_000_000, ceilingPpm)) / 1_000_000);
}

export type CounterRefusal = 'COUNTER_BELOW_PROPOSAL' | 'ABOVE_MAX_DISABLED' | 'REASON_REQUIRED' | 'REASON_TEXT_REQUIRED' | 'COUNTER_ABOVE_CEILING';
export type CounterCheck = { ok: true; aboveDisplayed: boolean; ceilingCents: number } | { ok: false; code: CounterRefusal; ceilingCents: number };

export interface CounterInput {
  displayedCents: number;
  proposedCents: number;
  counterCents: number;
  reason?: ExceptionalReason | undefined;
  reasonText?: string | undefined;
}

/** Contre-proposition du chauffeur : entre P' et P ; au-dessus de P seulement avec le second drapeau, un motif et sous le plafond. */
export function validateCounter(input: CounterInput, rules: NegotiationRules): CounterCheck {
  const ceilingCents = ceilingCentsOf(input.displayedCents, rules.ceilingPpm);
  if (input.counterCents < input.proposedCents) return { ok: false, code: 'COUNTER_BELOW_PROPOSAL', ceilingCents };
  if (input.counterCents <= input.displayedCents) return { ok: true, aboveDisplayed: false, ceilingCents };
  if (!rules.aboveMaxEnabled) return { ok: false, code: 'ABOVE_MAX_DISABLED', ceilingCents };
  if (!input.reason) return { ok: false, code: 'REASON_REQUIRED', ceilingCents };
  if (input.reason === 'other' && !input.reasonText?.trim()) return { ok: false, code: 'REASON_TEXT_REQUIRED', ceilingCents };
  if (input.counterCents > ceilingCents) return { ok: false, code: 'COUNTER_ABOVE_CEILING', ceilingCents };
  return { ok: true, aboveDisplayed: true, ceilingCents };
}

export interface NegotiationEligibilityInput {
  flatRateCode: string | null;
  category: string;
  organizationId: string | null;
  businessAccountId: string | null;
  seriesId?: string | null | undefined;
}
export type NegotiationIneligibility = 'flat_rate' | 'business_account' | 'ride_series' | 'neo_limo';

/** Exclusions de la section 5.5 : forfaits aéroport, comptes entreprises (et organisations), lots de courses, Neo Limo. */
export function negotiationIneligibility(ride: NegotiationEligibilityInput): NegotiationIneligibility | null {
  if (ride.flatRateCode) return 'flat_rate';
  if (ride.businessAccountId || ride.organizationId) return 'business_account';
  if (ride.seriesId) return 'ride_series';
  if (ride.category === 'neo_limo') return 'neo_limo';
  return null;
}

/** Test comparatif de la bêta : moitié des clients éligibles en négociation, moitié au prix fixe. */
export function experimentGroupFor(random: number): NegotiationMode {
  return random < 0.5 ? 'negotiation' : 'fixed';
}

export interface AgreedPriceInput {
  displayedCents: number;
  proposedCents: number | null;
  offer: { type: 'fixed' | 'client_proposal' | 'driver_counter'; proposedTotalCents: number | null };
}

/**
 * Prix convenu à l'acceptation d'une offre : P (mode fixe), P' (le chauffeur accepte la proposition) ou la contre-offre.
 * `explicitConsentRequired` : la contre-offre dépasse P, elle n'est appliquée qu'avec l'acceptation écrite du client.
 */
export function agreedPrice(input: AgreedPriceInput): { totalCents: number; explicitConsentRequired: boolean } {
  const { displayedCents, proposedCents, offer } = input;
  if (offer.type === 'fixed') return { totalCents: displayedCents, explicitConsentRequired: false };
  if (offer.type === 'client_proposal') return { totalCents: proposedCents ?? displayedCents, explicitConsentRequired: false };
  const totalCents = offer.proposedTotalCents ?? displayedCents;
  return { totalCents, explicitConsentRequired: totalCents > displayedCents };
}

/** Invariant (5.5, T-11.2) : le prix final ne dépasse jamais le prix maximal consenti. */
export function withinConsent(totalCents: number, maxConsentedCents: number): boolean {
  return totalCents <= maxConsentedCents;
}
