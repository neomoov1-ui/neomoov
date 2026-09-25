/**
 * Règles d'affichage de la réservation, sans React Native (testées par vitest) : créneaux de prise en charge selon le
 * préavis (D32), lignes du détail de prix telles que l'API les renvoie, cartes des catégories.
 */
import type { AppConfig, QuoteView, QuotesResponse, VehicleCategory } from '@neomoov/domain';

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

/** Jours proposés dans le sélecteur : aujourd'hui (si un créneau reste) puis les jours suivants jusqu'à la limite. */
export function pickupDays(now: Date, booking: AppConfig['booking'], count = 14): Date[] {
  const first = earliestPickup(now, booking.minLeadSeconds);
  const days: Date[] = [];
  const start = new Date(first);
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < Math.min(count, booking.maxLeadDays + 1); i += 1) days.push(new Date(start.getTime() + i * 86_400_000));
  return days;
}

/** Créneaux d'un jour (tous les quarts d'heure), à partir de la première heure réservable. */
export function pickupSlots(day: Date, now: Date, booking: AppConfig['booking']): Date[] {
  const first = earliestPickup(now, booking.minLeadSeconds);
  const slots: Date[] = [];
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  for (let m = 0; m < 24 * 60; m += SLOT_MINUTES) {
    const slot = new Date(start.getTime() + m * 60_000);
    if (slot.getTime() >= first.getTime() && pickupProblem(slot, now, booking) === null) slots.push(slot);
  }
  return slots;
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

/** Proposition de négociation (V1.1) : bornes du curseur, au dollar, entre le plancher et le prix affiché. */
export function proposalBounds(displayedCents: number, floorPpm: number): { minCents: number; maxCents: number; stepCents: number } {
  const ppm = Math.min(1_000_000, Math.max(0, floorPpm));
  const minCents = Math.min(displayedCents, Math.ceil((displayedCents * ppm) / 1_000_000 / 100) * 100);
  return { minCents, maxCents: displayedCents, stepCents: 100 };
}
