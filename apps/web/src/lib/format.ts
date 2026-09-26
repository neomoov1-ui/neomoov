/** Formats d'affichage du web : montants en dollars canadiens, dates à l'heure de Montréal. */
import type { Language } from './i18n-resources';

export const TIME_ZONE = 'America/Toronto';

const locale = (language: Language) => (language === 'en' ? 'en-CA' : 'fr-CA');

export function formatMoney(cents: number | null | undefined, language: Language): string {
  if (cents === null || cents === undefined) return '';
  return new Intl.NumberFormat(locale(language), { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

export function formatDateTime(iso: string | null | undefined, language: Language): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale(language), { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined, language: Language): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat(locale(language), { timeStyle: 'short', timeZone: TIME_ZONE }).format(new Date(iso));
}

/** Date locale `AAAA-MM-JJ` (champ de base) ou instant ISO, affichée sans heure. */
export function formatDate(value: string | null | undefined, language: Language): string {
  if (!value) return '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat(locale(language), { dateStyle: 'medium', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : TIME_ZONE }).format(date);
}

export function formatPercent(value: number | null | undefined, language: Language): string {
  if (value === null || value === undefined) return '';
  return new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(value) + ' %';
}

/** Date du jour à Montréal, `AAAA-MM-JJ`, décalée de `days` jours. */
export function montrealDate(days = 0, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const date = new Date(`${parts}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Instant ISO d'une date et d'une heure saisies à Montréal (`AAAA-MM-JJ`, `HH:MM`), heure d'été comprise : on part de
 * l'heure UTC équivalente, puis on corrige du décalage de Montréal à cet instant.
 */
export function montrealToIso(date: string, time: string): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const shown = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const get = (type: string) => Number(shown.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess.getTime() - (asUtc - guess.getTime())).toISOString();
}

/** Nom affiché : prénom et nom, sinon la valeur de repli. */
export function fullName(first: string | null | undefined, last: string | null | undefined, fallback = ''): string {
  return [first, last].filter(Boolean).join(' ') || fallback;
}
