/**
 * Agenda du chauffeur (étape 24, amendement v1.2 section 7.3) : réservations attribuées, chaînées dans l'ordre, avec
 * l'heure de départ conseillée, calculée depuis la position du chauffeur (première course, avec son consentement à la
 * localisation) ou depuis l'arrivée de la course précédente ; un enchaînement impossible est signalé. Fonction pure :
 * l'API fournit les temps de trajet (cartes) et les réglages.
 */

export const AGENDA_STATUSES = ['later', 'leave_soon', 'late', 'unknown'] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

export interface AgendaRide {
  id: string;
  startsAt: Date;
  /** Durée estimée au devis ; à défaut, `defaultDurationSeconds`. */
  durationSeconds: number | null;
  /** Trajet jusqu'au départ : depuis la position (première) ou l'arrivée précédente ; null si inconnu. */
  travelSeconds: number | null;
}

export interface AgendaOptions {
  now: Date;
  /** Marge ajoutée au trajet avant l'heure de prise en charge (`pilot.departure_buffer_minutes`). */
  bufferSeconds: number;
  /** Alerte de départ avant l'heure conseillée (`pilot.departure_alert_minutes`). */
  alertSeconds: number;
  defaultDurationSeconds: number;
}

export interface AgendaEntry {
  id: string;
  startsAt: Date;
  endsAt: Date;
  /** Heure de départ conseillée ; null sans temps de trajet. */
  leaveAt: Date | null;
  /** Temps libre depuis la fin de la course précédente jusqu'au départ conseillé (négatif : enchaînement impossible). */
  gapSeconds: number | null;
  conflict: boolean;
  /** `late` : l'heure de départ conseillée est passée ; `leave_soon` : dans le délai d'alerte. */
  status: AgendaStatus;
}

/** Réservations triées et chaînées : fin estimée, départ conseillé, écart avec la précédente, alerte de départ. */
export function chainAgenda(rides: readonly AgendaRide[], options: AgendaOptions): AgendaEntry[] {
  const now = options.now.getTime();
  const out: AgendaEntry[] = [];
  for (const ride of [...rides].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())) {
    const start = ride.startsAt.getTime();
    const endsAt = new Date(start + Math.max(0, ride.durationSeconds ?? options.defaultDurationSeconds) * 1000);
    const leaveAt = ride.travelSeconds === null ? null : new Date(start - (Math.max(0, ride.travelSeconds) + Math.max(0, options.bufferSeconds)) * 1000);
    const previous = out.at(-1);
    const gapSeconds = previous ? Math.round(((leaveAt ?? ride.startsAt).getTime() - previous.endsAt.getTime()) / 1000) : null;
    let status: AgendaStatus = 'unknown';
    if (leaveAt) status = now >= leaveAt.getTime() ? 'late' : now >= leaveAt.getTime() - Math.max(0, options.alertSeconds) * 1000 ? 'leave_soon' : 'later';
    out.push({ id: ride.id, startsAt: ride.startsAt, endsAt, leaveAt, gapSeconds, conflict: gapSeconds !== null && gapSeconds < 0, status });
  }
  return out;
}
