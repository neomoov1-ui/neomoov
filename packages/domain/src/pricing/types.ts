/**
 * Types du moteur de tarification. Tous les montants sont des entiers en cents (CAD).
 * Aucune valeur métier n'est codée ici : les règles viennent de la base (`pricing_rules`, `settings`, `promotions`).
 * Référence : cahier des charges, sections 5.1 et 5.9.
 */

export interface CategoryPricingRule {
  category: string;
  baseFareCents: number;
  perKmCents: number;
  perMinuteCents: number;
  minimumFareCents: number;
}

export interface SurchargeRules {
  nightCents: number;
  /** Heure locale de début de la nuit, incluse (23 pour 23 h). */
  nightStartHour: number;
  /** Heure locale de fin de la nuit, exclue (5 pour 5 h). */
  nightEndHour: number;
  airportCents: number;
  childSeatCents: number;
  bulkyLuggageCents: number;
  perStopCents: number;
  favouriteDriverCents: number;
}

/** Plage de pointe, en heure locale. `days` : 0 pour dimanche à 6 pour samedi. Minutes depuis minuit, fin exclue. */
export interface PeakWindow {
  days: number[];
  startMinute: number;
  endMinute: number;
}

export interface FlatRate {
  originZone: string;
  destinationZone: string;
  bidirectional: boolean;
  /** Prix total affiché, taxes comprises, par catégorie. */
  totalCentsByCategory: Record<string, number>;
}

export interface PricingRules {
  timeZone: string;
  categories: CategoryPricingRule[];
  surcharges: SurchargeRules;
  /** Multiplicateurs en points de base : 9000 pour × 0,90, 12500 pour × 1,25. */
  flexMultiplierBps: number;
  priorityMultiplierBps: number;
  peakWindows: PeakWindow[];
  flatRates: FlatRate[];
  serviceFeeCents: number;
  regulatoryFeeCents: number;
  /** Taux en parties par million : 50000 pour 5 %, 99750 pour 9,975 %. */
  gstRatePpm: number;
  qstRatePpm: number;
  /** Marge d'attente et d'arrêts ajoutée au total pour former le prix maximal consenti. */
  maxExtraAllowanceCents: number;
  waitFreeSeconds: number;
  waitPerMinuteCents: number;
}

export interface QuoteOptions {
  flex?: boolean;
  priority?: boolean;
  favouriteDriver?: boolean;
  childSeat?: boolean;
  bulkyLuggage?: boolean;
  stops?: number;
}

export type PromotionKind = 'percent' | 'free_ride';

export interface Promotion {
  code: string;
  kind: PromotionKind;
  /** Pour `percent` : remise en points de base (3000 pour 30 %). */
  percentBps?: number;
  /** N-ième course du client (3 pour la troisième). */
  nthRide?: number;
  maxDistanceMeters?: number;
  categories?: string[];
  /** Pour `free_ride` : vrai si Neomoov renonce aussi aux frais de service, à la redevance et aux taxes. */
  waivesFees?: boolean;
}

export interface QuoteInput {
  category: string;
  distanceMeters: number;
  durationSeconds: number;
  pickupAt: Date;
  originZone?: string | null;
  destinationZone?: string | null;
  /** Vrai si l'origine ou la destination est dans une zone d'aéroport. */
  airport?: boolean;
  options?: QuoteOptions;
  promotion?: Promotion | null;
  /** Nombre de courses déjà terminées par le client, pour les promotions de n-ième course. */
  clientCompletedRides?: number;
  creditsAvailableCents?: number;
}

export type QuoteLineKind =
  | 'base_fare' | 'distance' | 'duration' | 'minimum_adjustment' | 'surcharge'
  | 'flex' | 'priority' | 'favourite_driver' | 'flat_rate' | 'wait_time';

export interface QuoteLine {
  kind: QuoteLineKind;
  code: string;
  amountCents: number;
}

export interface Quote {
  category: string;
  flatRate: boolean;
  lines: QuoteLine[];
  /** Tarif de la course : ce qui revient au chauffeur, avant toute promotion. */
  fareCents: number;
  promotionCode: string | null;
  promotionDiscountCents: number;
  /** Ce que Neomoov verse au chauffeur pour compenser la promotion : il ne finance jamais une promotion. */
  promotionCompensationCents: number;
  serviceFeeCents: number;
  regulatoryFeeCents: number;
  subtotalCents: number;
  gstCents: number;
  qstCents: number;
  totalCents: number;
  creditsAppliedCents: number;
  amountDueCents: number;
  driverAmountCents: number;
  maxConsentedCents: number;
  ignoredOptions: string[];
}

export type PricingErrorCode =
  | 'UNKNOWN_CATEGORY' | 'INVALID_INPUT' | 'FLEX_REFUSED_PEAK_HOURS'
  | 'FLEX_AND_PRIORITY_EXCLUSIVE' | 'FLAT_RATE_NOT_DECOMPOSABLE' | 'PROMOTION_NOT_APPLICABLE';
