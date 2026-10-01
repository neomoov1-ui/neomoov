import { pilotCriteriaSchema, type PilotCriteria, type PilotTimeWindow } from '@neomoov/domain';

/**
 * Saisie des critères de Neomoov Pilote (6.2) : conversions entre les champs du formulaire (dollars, lignes de plages
 * horaires) et les critères du domaine (cents, plages structurées). Fonctions pures, testées ; l'API valide à son tour.
 */

const DAY_RANGE = /^(\d)(?:-(\d))?$/;
const TIME_RANGE = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

/** « 1-5 07:00-19:00 » ou « 0,6 22:00-02:00 » (1 = lundi, 0 = dimanche), une plage par ligne ; null si une ligne est illisible. */
export function parseTimeWindows(text: string): PilotTimeWindow[] | null {
  const windows: PilotTimeWindow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    const [daysPart, timePart, extra] = line.split(' ');
    if (!daysPart || !timePart || extra) return null;
    const days = new Set<number>();
    for (const part of daysPart.split(',')) {
      const m = DAY_RANGE.exec(part);
      if (!m) return null;
      const from = Number(m[1]);
      const to = m[2] === undefined ? from : Number(m[2]);
      if (from > 6 || to > 6 || from > to) return null;
      for (let d = from; d <= to; d += 1) days.add(d);
    }
    const t = TIME_RANGE.exec(timePart);
    if (!t) return null;
    const from = `${t[1]}:${t[2]}`;
    const to = `${t[3]}:${t[4]}`;
    if (from === to) return null;
    windows.push({ days: [...days].sort((a, b) => a - b), from, to });
  }
  return windows;
}

/** Plages structurées vers le texte du formulaire (jours consécutifs regroupés). */
export function formatTimeWindows(windows: readonly PilotTimeWindow[]): string {
  return windows
    .map((w) => {
      const days = [...w.days].sort((a, b) => a - b);
      const groups: string[] = [];
      let start = days[0]!;
      let previous = days[0]!;
      for (const day of days.slice(1)) {
        if (day === previous + 1) {
          previous = day;
          continue;
        }
        groups.push(start === previous ? String(start) : `${start}-${previous}`);
        start = day;
        previous = day;
      }
      groups.push(start === previous ? String(start) : `${start}-${previous}`);
      return `${groups.join(',')} ${w.from}-${w.to}`;
    })
    .join('\n');
}

/** « 12,50 » ou « 12.5 » en cents ; vide : null ; illisible ou négatif : undefined. */
export function dollarsToCents(text: string): number | null | undefined {
  const trimmed = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(value * 100);
}

export function centsToDollars(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '');
}

/** Entier positif ou vide (null) ; illisible : undefined. */
export function integerOrNull(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export interface CriteriaForm {
  minFare: string;
  minNetPerKm: string;
  minNetPerHour: string;
  costPerKm: string;
  maxPickupKm: string;
  maxPickupMinutes: string;
  maxDurationMinutes: string;
  hours: string;
  originZones: string[];
  destinationZones: string[];
  categories: string[];
  minClientRating: string;
  scheduleMargin: string;
  multiAppMode: boolean;
}

export function formOf(criteria: PilotCriteria): CriteriaForm {
  return {
    minFare: centsToDollars(criteria.minFareCents),
    minNetPerKm: centsToDollars(criteria.minNetPerKmCents),
    minNetPerHour: centsToDollars(criteria.minNetPerHourCents),
    costPerKm: criteria.costPerKmCents ? String(criteria.costPerKmCents) : '',
    maxPickupKm: criteria.maxPickupMeters === null ? '' : String(criteria.maxPickupMeters / 1000),
    maxPickupMinutes: criteria.maxPickupMinutes === null ? '' : String(criteria.maxPickupMinutes),
    maxDurationMinutes: criteria.maxDurationMinutes === null ? '' : String(criteria.maxDurationMinutes),
    hours: formatTimeWindows(criteria.timeWindows),
    originZones: [...criteria.originZones],
    destinationZones: [...criteria.destinationZones],
    categories: [...criteria.categories],
    minClientRating: criteria.minClientRating === null ? '' : String(criteria.minClientRating),
    scheduleMargin: String(criteria.scheduleMarginMinutes),
    multiAppMode: criteria.multiAppMode,
  };
}

export type CriteriaError = 'amount' | 'number' | 'hours' | 'rating';

/** Critères du domaine depuis le formulaire, ou le premier champ illisible. */
export function criteriaOf(form: CriteriaForm): { criteria: PilotCriteria } | { error: CriteriaError } {
  const minFareCents = dollarsToCents(form.minFare);
  const minNetPerKmCents = dollarsToCents(form.minNetPerKm);
  const minNetPerHourCents = dollarsToCents(form.minNetPerHour);
  if (minFareCents === undefined || minNetPerKmCents === undefined || minNetPerHourCents === undefined) return { error: 'amount' };
  const costPerKmCents = integerOrNull(form.costPerKm);
  const maxPickupMinutes = integerOrNull(form.maxPickupMinutes);
  const maxDurationMinutes = integerOrNull(form.maxDurationMinutes);
  const scheduleMarginMinutes = integerOrNull(form.scheduleMargin);
  const pickupKm = form.maxPickupKm.trim() ? Number(form.maxPickupKm.trim().replace(',', '.')) : null;
  if (costPerKmCents === undefined || maxPickupMinutes === undefined || maxDurationMinutes === undefined || scheduleMarginMinutes === undefined || (pickupKm !== null && !(pickupKm >= 0))) return { error: 'number' };
  const timeWindows = parseTimeWindows(form.hours);
  if (!timeWindows) return { error: 'hours' };
  const rating = form.minClientRating.trim() ? Number(form.minClientRating.trim().replace(',', '.')) : null;
  if (rating !== null && !(rating >= 1 && rating <= 5)) return { error: 'rating' };
  const parsed = pilotCriteriaSchema.safeParse({
    minFareCents, minNetPerKmCents, minNetPerHourCents, costPerKmCents: costPerKmCents ?? 0,
    maxPickupMeters: pickupKm === null ? null : Math.round(pickupKm * 1000), maxPickupMinutes, maxDurationMinutes, timeWindows,
    originZones: form.originZones, destinationZones: form.destinationZones, categories: form.categories, minClientRating: rating,
    scheduleMarginMinutes: scheduleMarginMinutes ?? 30, multiAppMode: form.multiAppMode,
  });
  return parsed.success ? { criteria: parsed.data } : { error: 'number' };
}
