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

/** Où conduire : au client avant le départ de la course, à la destination ensuite. */
export function navigationTarget<P>(ride: { state: RideState; origin: P; destination: P }): P {
  return ride.state === 'in_progress' ? ride.destination : ride.origin;
}

/** Secondes restantes avant une échéance (compte à rebours de l'offre), jamais négatif. */
export function secondsLeft(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000));
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
