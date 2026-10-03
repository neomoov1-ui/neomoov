/**
 * Règles d'affichage de la réservation, sans React Native (testées par vitest) : créneaux de prise en charge selon le
 * préavis (D32), lignes du détail de prix telles que l'API les renvoie, cartes des catégories, modes de paiement.
 */
import type { AppConfig, PaymentChoice, PaymentMethod, Place, QuoteRequest, QuoteView, QuotesResponse, VehicleCategory } from '@neomoov/domain';

export const SLOT_MINUTES = 15;

/** Première heure réservable : maintenant + préavis, arrondie au quart d'heure suivant. */
export function earliestPickup(now: Date, minLeadSeconds: number): Date {
  const t = now.getTime() + minLeadSeconds * 1000;
  const step = SLOT_MINUTES * 60_000;
  return new Date(Math.ceil(t / step) * step);
}

export type PickupProblem = 'too_soon' | 'too_far' | null;

/** Contrôle local avant le devis (l'API refait le même contrôle et fait foi). */
export function pickupProblem(pickup: Date, now: Date, booking: AppConfig['booking']): PickupProblem {
  if (pickup.getTime() - now.getTime() < booking.minLeadSeconds * 1000) return 'too_soon';
  if (pickup.getTime() - now.getTime() > booking.maxLeadDays * 86_400_000) return 'too_far';
  return null;
}

/** Fuseau du service : les jours et les heures proposés sont ceux de Montréal, quel que soit le réglage du téléphone. */
export const SERVICE_TIME_ZONE = 'America/Toronto';

const parts = new Intl.DateTimeFormat('en-CA', { timeZone: SERVICE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Date (AAAA-MM-JJ), heure et minute d'un instant, à l'heure de Montréal. */
export function serviceClock(instant: Date): { day: string; hour: number; minute: number } {
  const p = Object.fromEntries(parts.formatToParts(instant).map((x) => [x.type, x.value]));
  return { day: `${p['year']}-${p['month']}-${p['day']}`, hour: Number(p['hour']), minute: Number(p['minute']) };
}

export interface PickupDay {
  /** Jour à l'heure de Montréal (AAAA-MM-JJ). */
  day: string;
  /** Créneaux du jour, tous les quarts d'heure, en instants exacts. */
  slots: Date[];
}

/**
 * Créneaux proposés, groupés par jour de Montréal : de la première heure réservable jusqu'à `days` jours ou la limite
 * de réservation. Les instants avancent d'un quart d'heure exact : un jour de changement d'heure compte 23 ou 25 heures,
 * sans jour répété ni perdu.
 */
export function pickupSchedule(now: Date, booking: AppConfig['booking'], days = 14): PickupDay[] {
  const first = earliestPickup(now, booking.minLeadSeconds);
  const schedule: PickupDay[] = [];
  const step = SLOT_MINUTES * 60_000;
  for (let t = first.getTime(); ; t += step) {
    const slot = new Date(t);
    if (pickupProblem(slot, now, booking) !== null) break;
    const { day } = serviceClock(slot);
    let entry = schedule[schedule.length - 1];
    if (!entry || entry.day !== day) {
      if (schedule.length === days) break;
      entry = { day, slots: [] };
      schedule.push(entry);
    }
    entry.slots.push(slot);
  }
  return schedule;
}

export interface PriceRow {
  code: string;
  /** Libellé de repli de l'API (français) si l'application n'a pas de traduction pour ce code. */
  fallbackLabel: string;
  amountCents: number;
  emphasis: 'line' | 'tax' | 'discount';
}

const TAX_CODES = new Set(['gst', 'qst']);

/**
 * Lignes du détail dépliable, dans l'ordre de l'API et sans aucun calcul : la somme des lignes vaut le montant dû
 * (`amountDueCents`), vérifié côté API ; l'application ne fait que les afficher (critère : identique au centime).
 */
export function priceRows(quote: Pick<QuoteView, 'lines'>): PriceRow[] {
  return quote.lines.map((line) => ({
    code: line.code,
    fallbackLabel: line.label,
    amountCents: line.amountCents,
    emphasis: TAX_CODES.has(line.code) ? 'tax' : line.amountCents < 0 ? 'discount' : 'line',
  }));
}

/** Somme des lignes : sert seulement à vérifier en test que l'affichage correspond au total de l'API. */
export function sumRows(rows: PriceRow[]): number {
  return rows.reduce((total, row) => total + row.amountCents, 0);
}

export interface CategoryCard {
  code: VehicleCategory;
  name: string;
  seats: number;
  models: string[];
  quote: QuoteView;
  /** Temps d'arrivée estimé en secondes, ou null (« selon disponibilité »). */
  etaSeconds: number | null;
}

/** Catégories tarifées, dans l'ordre de la configuration (rang) ; une catégorie sans devis n'est pas proposée. */
export function categoryCards(response: Pick<QuotesResponse, 'quotes'>, categories: AppConfig['categories']): CategoryCard[] {
  const cards: CategoryCard[] = [];
  for (const category of categories) {
    const quote = response.quotes.find((q) => q.category === category.code);
    if (!quote) continue;
    cards.push({ code: category.code, name: category.name, seats: category.seats, models: category.allowedModels, quote, etaSeconds: quote.eta.status === 'estimated' ? quote.eta.seconds : null });
  }
  return cards;
}

/** Paiement au chauffeur après la course (D35, amendement v1.1) : modes que le chauffeur peut accepter. */
const PAY_AFTER_METHODS: readonly PaymentMethod[] = ['cash', 'interac', 'terminal'];

/** Prépaiement dans l'application : la carte partout, Apple Pay sur iPhone, Google Pay sur Android. */
function prepaidMethodsFor(platform: string): readonly PaymentMethod[] {
  return ['card_app', ...(platform === 'ios' ? (['apple_pay'] as const) : platform === 'android' ? (['google_pay'] as const) : [])];
}

export interface PaymentOptions {
  prepaid: PaymentMethod[];
  payAfter: PaymentMethod[];
}

/**
 * Modes de paiement proposés (5.6, D35), jamais codés en dur : seulement ceux que renvoie le devis (`paymentMethods`).
 * L'API retire la carte quand le paiement réel n'est pas branché, et le paiement au chauffeur quand aucun chauffeur ne
 * l'accepte ; un véhicule choisi (D37) limite en plus le paiement au chauffeur aux modes que son chauffeur accepte.
 */
export function paymentOptions(offered: readonly PaymentMethod[], platform: string, vehicleMethods: readonly PaymentMethod[] | null = null): PaymentOptions {
  return {
    prepaid: prepaidMethodsFor(platform).filter((m) => offered.includes(m)),
    payAfter: PAY_AFTER_METHODS.filter((m) => offered.includes(m) && (!vehicleMethods || vehicleMethods.includes(m))),
  };
}

/** Choix retenu : celui du client s'il est encore proposé, sinon l'autre ; null quand aucun mode n'est disponible. */
export function effectivePaymentChoice(options: PaymentOptions, wanted: PaymentChoice): PaymentChoice | null {
  const available = (choice: PaymentChoice) => (choice === 'prepaid' ? options.prepaid : options.payAfter).length > 0;
  if (available(wanted)) return wanted;
  const other: PaymentChoice = wanted === 'prepaid' ? 'pay_driver_after' : 'prepaid';
  return available(other) ? other : null;
}

/** Brouillon nécessaire à un devis : itinéraire, heure de prise en charge, options cochées. */
export interface QuoteDraft {
  origin: Place;
  destination: Place;
  stops: Place[];
  pickupAt: string;
  options: { flex: boolean; priority: boolean; childSeat: boolean; luggage: boolean; pet: boolean; favouriteDriverId?: string | undefined; promoCode?: string | undefined };
}

/**
 * Demande de devis du brouillon, la même partout (premier devis, choix des options, nouveau devis avant confirmation) :
 * arrêts, heure, options, chauffeur favori et code promo ; le mode de paiement choisi quand il est connu (les crédits ne
 * valent qu'en prépaiement).
 */
export function quoteRequestOf(draft: QuoteDraft, paymentChoice?: PaymentChoice | null): QuoteRequest {
  const { flex, priority, childSeat, luggage, pet, favouriteDriverId } = draft.options;
  const promoCode = normalizePromoCode(draft.options.promoCode ?? '');
  return {
    origin: draft.origin,
    destination: draft.destination,
    stops: draft.stops,
    requestedAt: draft.pickupAt,
    options: { flex, priority, childSeat, luggage, pet, ...(favouriteDriverId ? { favouriteDriverId } : {}), ...(promoCode ? { promoCode } : {}) },
    ...(paymentChoice ? { paymentChoice } : {}),
  };
}

/**
 * Montant à payer selon le mode choisi (revue du 2 octobre 2026, constat 2) : les crédits déduits par le devis ne valent
 * qu'en prépaiement ; payée au chauffeur, la course est due en entier (`totalCents`) et les crédits restent au compte.
 */
export function amountDueFor(quote: Pick<QuoteView, 'totalCents' | 'amountDueCents' | 'creditsPrepaidOnly'>, choice: PaymentChoice | null): number {
  return choice === 'pay_driver_after' && quote.creditsPrepaidOnly ? quote.totalCents : quote.amountDueCents;
}

/** Lignes du détail selon le mode : sans la ligne des crédits quand ils ne s'appliquent pas (leur somme reste le montant dû). */
export function priceRowsFor(quote: Pick<QuoteView, 'lines' | 'creditsPrepaidOnly'>, choice: PaymentChoice | null): PriceRow[] {
  const rows = priceRows(quote);
  return choice === 'pay_driver_after' && quote.creditsPrepaidOnly ? rows.filter((row) => row.code !== 'credits') : rows;
}

/**
 * Le devis convient-il au mode de paiement choisi ? Payée au chauffeur, une course ne part pas d'un devis qui déduit des
 * crédits ; prépayée, elle ne part pas d'un devis fait pour le paiement au chauffeur (les crédits du compte n'y sont pas
 * déduits). Sinon un nouveau devis est demandé avec le mode choisi (`paymentChoice`). `quotedFor` : mode envoyé avec le
 * devis affiché (null : aucun, calculé comme une course prépayée).
 */
export function quoteFitsChoice(quote: Pick<QuoteView, 'creditsAppliedCents'>, quotedFor: PaymentChoice | null, choice: PaymentChoice): boolean {
  if (choice === 'pay_driver_after') return quote.creditsAppliedCents === 0;
  return quotedFor !== 'pay_driver_after';
}

/** Code promo saisi : majuscules, sans espaces (l'API compare le code en majuscules), 30 caractères au plus. */
export function normalizePromoCode(input: string): string {
  return input.toUpperCase().replace(/\s+/g, '').slice(0, 30);
}

/** Motifs de refus d'un code promo traduits par l'application (`category.promoRefusals.*`). */
export const PROMO_REFUSAL_KEYS = [
  'unknown_code', 'inactive', 'not_started', 'expired', 'budget_exhausted', 'global_limit', 'client_limit', 'max_clients', 'first_ride_only', 'wrong_rank', 'distance', 'zone', 'time_window',
] as const;
export type PromoRefusalKey = (typeof PROMO_REFUSAL_KEYS)[number];

/**
 * Motif d'un code promo refusé par le devis : code inconnu (`PROMO_CODE_UNKNOWN`) ou promotion non applicable
 * (`PROMOTION_NOT_APPLICABLE`, motif stable dans `details.reason`) ; null pour toute autre erreur.
 */
export function promoRefusal(error: { code: string; details?: unknown } | null): PromoRefusalKey | null {
  if (!error) return null;
  if (error.code === 'PROMO_CODE_UNKNOWN') return 'unknown_code';
  if (error.code !== 'PROMOTION_NOT_APPLICABLE') return null;
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  return (PROMO_REFUSAL_KEYS as readonly unknown[]).includes(reason) ? (reason as PromoRefusalKey) : 'inactive';
}

/**
 * Effet du code promo sur le devis de la catégorie choisie : appliqué (remise du devis), ou non applicable à cette
 * catégorie (l'API garde le devis des autres catégories) ; null sans code.
 */
export function promoStatus(quote: Pick<QuoteView, 'promotionCode' | 'promotionDiscountCents'>, code: string | undefined): 'applied' | 'not_for_category' | null {
  const wanted = normalizePromoCode(code ?? '');
  if (!wanted) return null;
  return quote.promotionCode === wanted && quote.promotionDiscountCents > 0 ? 'applied' : 'not_for_category';
}

/** Marge avant la fin de validité d'un devis : la création de la course doit arriver à l'API avant l'expiration. */
export const QUOTE_EXPIRY_MARGIN_MS = 30_000;

/**
 * Devis expiré ou sur le point de l'être (revue du 2 octobre 2026, constat mobile 4) : `now` est l'heure de l'API vue
 * du téléphone. Un nouveau devis est demandé avant la confirmation plutôt que d'envoyer un prix périmé.
 */
export function quoteExpired(quote: Pick<QuoteView, 'validUntil'>, now: number, marginMs = QUOTE_EXPIRY_MARGIN_MS): boolean {
  const validUntil = Date.parse(quote.validUntil);
  return !Number.isFinite(validUntil) || validUntil - now <= marginMs;
}

type PricedQuote = Pick<QuoteView, 'totalCents' | 'amountDueCents' | 'maxConsentedCents' | 'creditsPrepaidOnly'>;

/**
 * Même prix pour le client : total, montant dû dans le mode choisi et plafond consenti identiques (le nouveau devis peut
 * partir sans nouvelle confirmation). Payée au chauffeur, le montant dû est le total dans les deux devis.
 */
export function samePrice(a: PricedQuote, b: PricedQuote, choice: PaymentChoice | null = null): boolean {
  return a.totalCents === b.totalCents && amountDueFor(a, choice) === amountDueFor(b, choice) && a.maxConsentedCents === b.maxConsentedCents;
}

/** Proposition de négociation (V1.1) : bornes du curseur, au dollar, entre le plancher et le prix affiché. */
export function proposalBounds(displayedCents: number, floorPpm: number): { minCents: number; maxCents: number; stepCents: number } {
  const ppm = Math.min(1_000_000, Math.max(0, floorPpm));
  const minCents = Math.min(displayedCents, Math.ceil((displayedCents * ppm) / 1_000_000 / 100) * 100);
  return { minCents, maxCents: displayedCents, stepCents: 100 };
}
