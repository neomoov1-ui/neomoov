/**
 * Machine à états d'une course, déclarée comme table de transitions typée.
 * Référence : cahier des charges, section 5.2. Aucune logique d'infrastructure : l'appelant fournit
 * l'état des gardes (véhicule conforme, attente écoulée) et enregistre lui-même l'événement dans `ride_events`.
 */

import type { RideState } from '../enums.js';

export const RIDE_EVENTS = [
  'client_confirms', 'quote_expires', 'offers_sent', 'new_wave', 'no_driver_found', 'driver_accepts', 'driver_departs',
  'driver_arrives', 'ride_starts', 'client_no_show', 'ride_ends', 'incident', 'client_rates', 'client_disputes',
  'client_cancels', 'driver_cancels', 'reassign',
] as const;
export type RideEvent = (typeof RIDE_EVENTS)[number];

/** Gardes nommées : l'appelant dit lesquelles sont vraies au moment de la transition. */
export const RIDE_GUARDS = ['vehicle_category_at_least_reserved', 'waited_five_minutes_and_two_contacts'] as const;
export type RideGuard = (typeof RIDE_GUARDS)[number];

/** Effets déclarés, pour que l'appelant sache quoi faire après la transition. Ils ne sont pas exécutés ici. */
export type RideEffect = 'cancellation_fee_if_outside_free_window' | 'cancellation_fee' | 'no_show_fee' | 'driver_sanction' | 'reassign_with_priority';

export interface RideTransition {
  from: RideState;
  event: RideEvent;
  to: RideState;
  guard?: RideGuard;
  effects?: readonly RideEffect[];
}

export const RIDE_TRANSITIONS: readonly RideTransition[] = [
  { from: 'quoted', event: 'client_confirms', to: 'requested' },
  { from: 'quoted', event: 'quote_expires', to: 'expired' },
  { from: 'requested', event: 'offers_sent', to: 'offering' },
  { from: 'requested', event: 'client_cancels', to: 'cancelled_by_client' },
  { from: 'requested', event: 'no_driver_found', to: 'no_driver' },
  { from: 'offering', event: 'driver_accepts', to: 'assigned', guard: 'vehicle_category_at_least_reserved' },
  { from: 'offering', event: 'new_wave', to: 'requested' },
  { from: 'offering', event: 'no_driver_found', to: 'no_driver' },
  { from: 'offering', event: 'client_cancels', to: 'cancelled_by_client' },
  { from: 'assigned', event: 'driver_departs', to: 'en_route' },
  { from: 'assigned', event: 'client_cancels', to: 'cancelled_by_client', effects: ['cancellation_fee_if_outside_free_window'] },
  { from: 'assigned', event: 'driver_cancels', to: 'cancelled_by_driver', effects: ['reassign_with_priority'] },
  { from: 'en_route', event: 'driver_arrives', to: 'arrived' },
  { from: 'en_route', event: 'client_cancels', to: 'cancelled_by_client', effects: ['cancellation_fee'] },
  { from: 'en_route', event: 'driver_cancels', to: 'cancelled_by_driver', effects: ['driver_sanction', 'reassign_with_priority'] },
  { from: 'arrived', event: 'ride_starts', to: 'in_progress' },
  { from: 'arrived', event: 'client_no_show', to: 'no_show', guard: 'waited_five_minutes_and_two_contacts', effects: ['no_show_fee'] },
  { from: 'arrived', event: 'client_cancels', to: 'cancelled_by_client', effects: ['cancellation_fee'] },
  { from: 'in_progress', event: 'ride_ends', to: 'completed' },
  { from: 'in_progress', event: 'incident', to: 'interrupted' },
  { from: 'completed', event: 'client_rates', to: 'rated' },
  { from: 'completed', event: 'client_disputes', to: 'disputed' },
  { from: 'cancelled_by_driver', event: 'reassign', to: 'requested' },
];

export const TERMINAL_RIDE_STATES: readonly RideState[] = ['rated', 'disputed', 'no_driver', 'cancelled_by_client', 'no_show', 'interrupted', 'expired'];

/** États dans lesquels un chauffeur est engagé sur la course. */
export const ACTIVE_RIDE_STATES: readonly RideState[] = ['assigned', 'en_route', 'arrived', 'in_progress'];

export type GuardContext = Partial<Record<RideGuard, boolean>>;

export function isTerminalState(state: RideState): boolean {
  return TERMINAL_RIDE_STATES.includes(state);
}

/** Transition déclarée pour un état et un événement, sans évaluer la garde. */
export function findTransition(from: RideState, event: RideEvent): RideTransition | undefined {
  return RIDE_TRANSITIONS.find((t) => t.from === from && t.event === event);
}

/** Vrai si la transition existe et que sa garde, s'il y en a une, est satisfaite par le contexte. */
export function canTransition(from: RideState, event: RideEvent, guards: GuardContext = {}): boolean {
  const t = findTransition(from, event);
  if (!t) return false;
  return t.guard === undefined || guards[t.guard] === true;
}

export class RideTransitionError extends Error {
  constructor(public readonly from: RideState, public readonly event: RideEvent, public readonly reason: 'no_transition' | 'guard_failed', public readonly guard?: RideGuard) {
    super(reason === 'no_transition' ? `Transition impossible : ${from} + ${event}` : `Garde non satisfaite : ${guard} (${from} + ${event})`);
    this.name = 'RideTransitionError';
  }
}

/** État suivant et effets à appliquer, ou une erreur typée. */
export function transition(from: RideState, event: RideEvent, guards: GuardContext = {}): { to: RideState; effects: readonly RideEffect[] } {
  const t = findTransition(from, event);
  if (!t) throw new RideTransitionError(from, event, 'no_transition');
  if (t.guard !== undefined && guards[t.guard] !== true) throw new RideTransitionError(from, event, 'guard_failed', t.guard);
  return { to: t.to, effects: t.effects ?? [] };
}

/** Événements possibles depuis un état, gardes non évaluées. */
export function eventsFrom(state: RideState): RideEvent[] {
  return RIDE_TRANSITIONS.filter((t) => t.from === state).map((t) => t.event);
}
