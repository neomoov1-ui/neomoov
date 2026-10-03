/**
 * Déroulé d'une course côté chauffeur (prompt 11, écran de navigation) : un seul bouton par étape, jamais de saisie en
 * conduite. Fonctions pures (testées par vitest) ; les montants et les règles viennent de l'API.
 */
import type { DriverJob, RideState } from '@neomoov/domain';

export type RideAction = 'depart' | 'arrive' | 'start' | 'complete';

const NEXT: Partial<Record<RideState, RideAction>> = { assigned: 'depart', en_route: 'arrive', arrived: 'start', in_progress: 'complete' };

export const ACTIVE_STATES: readonly RideState[] = ['assigned', 'en_route', 'arrived', 'in_progress'];

export function nextAction(state: RideState): RideAction | null {
  return NEXT[state] ?? null;
}

export function isActive(state: RideState): boolean {
  return ACTIVE_STATES.includes(state);
}

/**
 * Annulation par le chauffeur proposée : avant l'arrivée (attribuée, en route) ; une fois arrivé sur place seulement si
 * le réglage de l'API le permet (`features.driverCancelAfterArrival`, décision du fondateur attendue, faux par défaut) ;
 * jamais pendant la course (incident ou SOS).
 */
export function canDriverCancel(state: RideState, allowAfterArrival: boolean): boolean {
  if (state === 'assigned' || state === 'en_route') return true;
  return state === 'arrived' && allowAfterArrival;
}

/** Où conduire : au client avant le départ de la course, à la destination ensuite. */
export function navigationTarget<P>(ride: { state: RideState; origin: P; destination: P }): P {
  return ride.state === 'in_progress' ? ride.destination : ride.origin;
}

/**
 * Secondes restantes avant une échéance de l'API (délai de grâce, attente minimale), jamais négatif. `now` est l'heure de
 * l'API vue du téléphone (`serverNow`), jamais l'horloge brute du téléphone.
 */
export function secondsLeft(deadline: string, now: number): number {
  return secondsUntil(Date.parse(deadline), now);
}

/** Secondes restantes avant une échéance en millisecondes, jamais négatif. */
export function secondsUntil(deadlineMs: number, now: number): number {
  return Math.max(0, Math.ceil((deadlineMs - now) / 1000));
}

/**
 * Échéance d'une offre à l'heure du téléphone (revue du 2 octobre 2026, constat mobile 1) : fin de l'offre ramenée à
 * l'horloge du téléphone par l'écart mesuré avec l'API ; sans mesure, durée de l'offre (`expiresAt - sentAt`) comptée
 * depuis sa réception ; à défaut, la fin de l'offre telle quelle. Une horloge décalée ne fait plus perdre les offres.
 */
export function offerDeadline(offer: { sentAt: string; expiresAt: string }, clock: { offsetMs: number | null; receivedAt: number | null }): number {
  const expiresAt = Date.parse(offer.expiresAt);
  if (clock.offsetMs !== null) return expiresAt - clock.offsetMs;
  if (clock.receivedAt !== null) return clock.receivedAt + Math.max(0, expiresAt - Date.parse(offer.sentAt));
  return expiresAt;
}

/** Attente sur place depuis l'arrivée (compteur affiché), en secondes. */
export function waitedSeconds(arrivedAt: string | undefined, now: number): number {
  if (!arrivedAt) return 0;
  return Math.max(0, Math.floor((now - Date.parse(arrivedAt)) / 1000));
}

/** Non-présentation : possible quand l'attente minimale est écoulée et que les tentatives de contact sont faites. */
export function noShowStatus(job: Pick<DriverJob, 'noShow' | 'contactAttempts'>, now: number): { ready: boolean; secondsLeft: number; contactsLeft: number } {
  const wait = job.noShow.availableAt ? secondsLeft(job.noShow.availableAt, now) : Number.POSITIVE_INFINITY;
  const contactsLeft = Math.max(0, job.noShow.minContacts - job.contactAttempts);
  return { ready: wait === 0 && contactsLeft === 0, secondsLeft: Number.isFinite(wait) ? wait : 0, contactsLeft };
}

/** Fin de course encore à compléter : montant reçu à confirmer (paiement direct) ou client à évaluer. */
export function endOfRidePending(ride: { state: RideState; job: Pick<DriverJob, 'payment' | 'clientRated'> }): { payment: boolean; rating: boolean } {
  const done = ride.state === 'completed' || ride.state === 'rated';
  return { payment: done && ride.job.payment.direct && ride.job.payment.confirmedCents === null, rating: done && !ride.job.clientRated };
}

/** « 4:05 » pour un compteur d'attente. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
