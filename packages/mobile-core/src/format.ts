/**
 * Mise en forme des montants, dates et durées, sans dépendance à React Native (testée par vitest). Montants en cents
 * entiers reçus de l'API, affichés tels quels : l'application ne calcule jamais un prix.
 */
export type UiLanguage = 'fr-CA' | 'en';

/** Fuseau de Montréal : les heures de prise en charge sont affichées à l'heure locale du service, pas à celle du téléphone. */
export const SERVICE_TIME_ZONE = 'America/Toronto';

const locale = (language: UiLanguage) => (language === 'en' ? 'en-CA' : 'fr-CA');

export function formatMoney(cents: number, language: UiLanguage): string {
  return new Intl.NumberFormat(locale(language), { style: 'currency', currency: 'CAD' }).format(cents / 100);
}

export function formatDateTime(iso: string | Date, language: UiLanguage): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale(language), { timeZone: SERVICE_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatTime(iso: string | Date, language: UiLanguage): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(locale(language), { timeZone: SERVICE_TIME_ZONE, hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDay(date: Date, language: UiLanguage): string {
  return new Intl.DateTimeFormat(locale(language), { timeZone: SERVICE_TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

/** Date civile de l'API (AAAA-MM-JJ, déjà à l'heure de Montréal) : « 27 août », sans décalage de fuseau. */
export function formatLocalDate(date: string, language: UiLanguage): string {
  return new Intl.DateTimeFormat(locale(language), { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`));
}

/** « 25 min », « 1 h 05 ». */
export function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** « 8,2 km » ou « 8.2 km », « 650 m ». */
export function formatDistance(meters: number, language: UiLanguage): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${new Intl.NumberFormat(locale(language), { maximumFractionDigits: 1 }).format(meters / 1000)} km`;
}

/**
 * Langue ajoutée à l'adresse d'une page web ouverte depuis une application (page de carte, versements) : `lang=fr` ou
 * `lang=en`, avant un éventuel fragment (`#…`) ; un paramètre `lang` déjà présent est remplacé (revue du 2 octobre 2026,
 * constat mobile 25 : plus de concaténation fragile dans les écrans).
 */
export function withLanguage(url: string, language: UiLanguage): string {
  const hashAt = url.indexOf('#');
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const queryAt = base.indexOf('?');
  const path = queryAt >= 0 ? base.slice(0, queryAt) : base;
  const params = (queryAt >= 0 ? base.slice(queryAt + 1) : '').split('&').filter((part) => part !== '' && !part.startsWith('lang='));
  params.push(`lang=${language === 'en' ? 'en' : 'fr'}`);
  return `${path}?${params.join('&')}${hash}`;
}
