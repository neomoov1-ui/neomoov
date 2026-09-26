/**
 * Règles d'affichage de la réservation, sans React Native (testées par vitest) : créneaux de prise en charge selon le
 * préavis (D32), lignes du détail de prix telles que l'API les renvoie, cartes des catégories, modes de paiement.
 */
import type { AppConfig, PaymentChoice, PaymentMethod, QuoteView, QuotesResponse, VehicleCategory } from '@neomoov/domain';

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

/** Proposition de négociation (V1.1) : bornes du curseur, au dollar, entre le plancher et le prix affiché. */
export function proposalBounds(displayedCents: number, floorPpm: number): { minCents: number; maxCents: number; stepCents: number } {
  const ppm = Math.min(1_000_000, Math.max(0, floorPpm));
  const minCents = Math.min(displayedCents, Math.ceil((displayedCents * ppm) / 1_000_000 / 100) * 100);
  return { minCents, maxCents: displayedCents, stepCents: 100 };
}
