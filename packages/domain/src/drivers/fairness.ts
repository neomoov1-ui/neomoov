/**
 * Charte d'équité chauffeurs (D7, adoptée par le fondateur le 26 septembre 2026) : délais que Neomoov s'engage à tenir.
 * Une suspension de précaution pour la sécurité est réexaminée par une personne sous 24 heures ; une réponse ou un appel
 * du chauffeur reçoit une réponse d'une personne sous 4 heures ouvrables ; l'appel est tranché par une autre personne que
 * celle qui a décidé la sanction. Fonctions pures : l'API lit les réglages et l'heure, le domaine calcule.
 */

/** Réponse (sa version, avant ou après la décision) ou appel (demande de révision de la décision). */
export const APPEAL_KINDS = ['response', 'appeal'] as const;
export type AppealKind = (typeof APPEAL_KINDS)[number];

/** `open` : en attente d'une personne ; `upheld` : sanction maintenue ; `overturned` : sanction levée. */
export const APPEAL_STATUSES = ['open', 'upheld', 'overturned'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

/** Plage ouvrable en heure locale : jours (0 dimanche à 6 samedi), début et fin en minutes depuis minuit, fin exclue. */
export interface BusinessHours {
  days: number[];
  startMinute: number;
  endMinute: number;
}

/** Du lundi au vendredi, de 9 h à 17 h (réglage `fairness.business_hours`). */
export const DEFAULT_BUSINESS_HOURS: BusinessHours = { days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Réglage `{ days: [1..5], from: '09:00', to: '17:00' }` ; une valeur invalide garde le défaut. */
export function parseBusinessHours(raw: unknown): BusinessHours {
  if (!raw || typeof raw !== 'object') return DEFAULT_BUSINESS_HOURS;
  const r = raw as { days?: unknown; from?: unknown; to?: unknown };
  const days = Array.isArray(r.days) && r.days.length && r.days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) ? (r.days as number[]) : null;
  const from = typeof r.from === 'string' ? HHMM.exec(r.from) : null;
  const to = typeof r.to === 'string' ? HHMM.exec(r.to) : null;
  if (!days || !from || !to) return DEFAULT_BUSINESS_HOURS;
  const startMinute = Number(from[1]) * 60 + Number(from[2]);
  const endMinute = Number(to[1]) * 60 + Number(to[2]);
  return endMinute > startMinute ? { days, startMinute, endMinute } : DEFAULT_BUSINESS_HOURS;
}

/** Écart entre l'heure locale et l'heure UTC à cet instant, en millisecondes. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
  const get = (t: string): number => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(instant / 1000) * 1000;
}

/** Instant UTC d'une heure locale (jour civil `y-m-d`, minutes depuis minuit) ; deux passes pour les changements d'heure. */
function zonedToUtc(y: number, m: number, d: number, minutes: number, timeZone: string): number {
  const wall = Date.UTC(y, m, d, 0, minutes);
  const first = wall - offsetMs(wall, timeZone);
  return wall - offsetMs(first, timeZone);
}

/** Secondes ouvrables entre deux instants (jours fériés non retirés : l'équipe les couvre par une permanence). */
export function businessSecondsBetween(from: Date, to: Date, hours: BusinessHours, timeZone: string): number {
  const start = from.getTime();
  const end = to.getTime();
  if (!(end > start)) return 0;
  const local = new Date(start + offsetMs(start, timeZone));
  let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  let total = 0;
  // Au plus un an de jours parcourus : un délai d'équité se compte en heures, jamais en années.
  for (let i = 0; i < 366; i += 1) {
    const cursor = new Date(day);
    const [y, m, d] = [cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()];
    if (zonedToUtc(y, m, d, 0, timeZone) >= end) break;
    if (hours.days.includes(cursor.getUTCDay())) {
      const open = zonedToUtc(y, m, d, hours.startMinute, timeZone);
      const close = zonedToUtc(y, m, d, hours.endMinute, timeZone);
      total += Math.max(0, Math.min(close, end) - Math.max(open, start));
    }
    day += 86_400_000;
  }
  return Math.floor(total / 1000);
}

/** Réponse ou appel sans décision au-delà du délai de rappel (4 heures ouvrables). */
export function appealOverdue(createdAt: Date, now: Date, hours: BusinessHours, timeZone: string, limitSeconds = 4 * 3600): boolean {
  return businessSecondsBetween(createdAt, now, hours, timeZone) >= limitSeconds;
}

/** Suspension de précaution sans décision humaine au-delà de 24 heures (heures pleines, pas ouvrables : la sécurité n'attend pas). */
export function precautionaryReviewOverdue(startsAt: Date, now: Date, limitSeconds = 24 * 3600): boolean {
  return now.getTime() - startsAt.getTime() >= limitSeconds * 1000;
}

/**
 * L'appel est tranché par une autre personne que celle qui a décidé la sanction ; une sanction appliquée par le système
 * (blocage de précaution, avertissement automatique) peut être revue par tout membre du personnel habilité.
 */
export function canDecideAppeal(kind: AppealKind, sanctionDecidedBy: string | null, deciderUserId: string): boolean {
  return kind !== 'appeal' || sanctionDecidedBy === null || sanctionDecidedBy !== deciderUserId;
}
