/**
 * Tâche durable de démarrage de la répartition (revue du 2 octobre 2026, constat 4) : mise en file `dispatch` à la création
 * de la course par `RidesService.afterCreation`, traitée par le processus qui porte la répartition (`DispatchService`),
 * rejouée jusqu'à 3 fois avec recul exponentiel, identifiant stable par course (sans deux-points, exigence de BullMQ).
 * Module sans dépendance : les deux services l'importent sans cycle.
 */
export const DISPATCH_QUEUE = 'dispatch' as const;
export const DISPATCH_START_JOB = 'start' as const;
export const DISPATCH_START_ATTEMPTS = 3;

export interface DispatchStartJob {
  rideId: string;
}

export const dispatchStartJobId = (rideId: string): string => `dispatch-${rideId}`;
