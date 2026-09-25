/**
 * Frais d'annulation et de non-présentation (section 5.2), fonctions pures : les montants et délais viennent de
 * `settings` (`rides.free_cancellation_seconds`, `rides.cancellation_fee_cents`, `rides.no_show_fee_cents`,
 * `rides.no_show_min_wait_seconds`, `rides.no_show_min_contacts`). 100 % des frais vont au chauffeur.
 */
import type { RideState } from '../enums.js';

export interface CancellationRules {
  /** Fenêtre gratuite après l'attribution, en secondes (120). */
  freeCancellationSeconds: number;
  cancellationFeeCents: number;
  noShowFeeCents: number;
  /** Attente minimale sur place avant une non-présentation, en secondes (300). */
  noShowMinWaitSeconds: number;
  /** Tentatives de contact minimales avant une non-présentation (2). */
  noShowMinContacts: number;
}

export interface CancellationContext {
  state: RideState;
  /** Instant de l'attribution (état `assigned`), s'il a eu lieu. */
  assignedAt: Date | null;
  now: Date;
}

/** Frais dus par le client qui annule : 0 avant l'attribution ou dans la fenêtre gratuite, sinon le tarif d'annulation. */
export function clientCancellationFeeCents(context: CancellationContext, rules: CancellationRules): number {
  switch (context.state) {
    case 'quoted':
    case 'requested':
    case 'offering':
      return 0;
    case 'assigned': {
      if (!context.assignedAt) return rules.cancellationFeeCents;
      const elapsed = (context.now.getTime() - context.assignedAt.getTime()) / 1000;
      return elapsed <= rules.freeCancellationSeconds ? 0 : rules.cancellationFeeCents;
    }
    case 'en_route':
    case 'arrived':
      return rules.cancellationFeeCents;
    default:
      return 0;
  }
}

export interface NoShowContext {
  /** Instant de l'arrivée du chauffeur sur place. */
  arrivedAt: Date;
  now: Date;
  contactAttempts: number;
}

export type NoShowRefusal = 'not_waited_enough' | 'not_enough_contacts';

/** Vrai si la non-présentation peut être déclarée, sinon la raison du refus. */
export function noShowCheck(context: NoShowContext, rules: CancellationRules): { allowed: true; feeCents: number; waitedSeconds: number } | { allowed: false; reason: NoShowRefusal; waitedSeconds: number; contactAttempts: number } {
  const waitedSeconds = Math.floor((context.now.getTime() - context.arrivedAt.getTime()) / 1000);
  if (waitedSeconds < rules.noShowMinWaitSeconds) return { allowed: false, reason: 'not_waited_enough', waitedSeconds, contactAttempts: context.contactAttempts };
  if (context.contactAttempts < rules.noShowMinContacts) return { allowed: false, reason: 'not_enough_contacts', waitedSeconds, contactAttempts: context.contactAttempts };
  return { allowed: true, feeCents: rules.noShowFeeCents, waitedSeconds };
}

/** Attente facturable sur place (secondes), à partir de l'arrivée jusqu'au départ, jamais négative. */
export function waitedSecondsBetween(arrivedAt: Date | null, startedAt: Date | null): number {
  if (!arrivedAt || !startedAt) return 0;
  return Math.max(0, Math.floor((startedAt.getTime() - arrivedAt.getTime()) / 1000));
}
