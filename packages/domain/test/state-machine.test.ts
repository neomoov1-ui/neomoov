import { describe, expect, it } from 'vitest';
import { RIDE_STATES } from '../src/enums.js';
import {
  ACTIVE_RIDE_STATES, RIDE_EVENTS, RIDE_TRANSITIONS, RideTransitionError, TERMINAL_RIDE_STATES,
  canTransition, eventsFrom, findTransition, isTerminalState, transition,
} from '../src/rides/state-machine.js';

describe('table de transitions (section 5.2)', () => {
  it('chaque état de la table est un état connu', () => {
    for (const t of RIDE_TRANSITIONS) {
      expect(RIDE_STATES).toContain(t.from);
      expect(RIDE_STATES).toContain(t.to);
      expect(RIDE_EVENTS).toContain(t.event);
    }
  });

  it('un couple (état, événement) n\'apparaît qu\'une fois', () => {
    const keys = RIDE_TRANSITIONS.map((t) => `${t.from}+${t.event}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('les états terminaux n\'ont aucune transition sortante', () => {
    for (const s of TERMINAL_RIDE_STATES) expect(eventsFrom(s)).toEqual([]);
  });

  it('tout état non terminal a au moins une transition sortante', () => {
    for (const s of RIDE_STATES) if (!isTerminalState(s)) expect(eventsFrom(s).length).toBeGreaterThan(0);
  });

  it('les états actifs engagent un chauffeur', () => {
    expect(ACTIVE_RIDE_STATES).toEqual(['assigned', 'en_route', 'arrived', 'in_progress']);
  });
});

describe('transitions valides', () => {
  it.each([
    ['quoted', 'client_confirms', 'requested'],
    ['quoted', 'quote_expires', 'expired'],
    ['requested', 'offers_sent', 'offering'],
    ['requested', 'client_cancels', 'cancelled_by_client'],
    ['requested', 'no_driver_found', 'no_driver'],
    ['offering', 'new_wave', 'requested'],
    ['offering', 'no_driver_found', 'no_driver'],
    ['offering', 'client_cancels', 'cancelled_by_client'],
    ['assigned', 'driver_departs', 'en_route'],
    ['assigned', 'client_cancels', 'cancelled_by_client'],
    ['assigned', 'driver_cancels', 'cancelled_by_driver'],
    ['en_route', 'driver_arrives', 'arrived'],
    ['en_route', 'client_cancels', 'cancelled_by_client'],
    ['en_route', 'driver_cancels', 'cancelled_by_driver'],
    ['arrived', 'ride_starts', 'in_progress'],
    ['arrived', 'client_cancels', 'cancelled_by_client'],
    ['in_progress', 'ride_ends', 'completed'],
    ['in_progress', 'incident', 'interrupted'],
    ['completed', 'client_rates', 'rated'],
    ['completed', 'client_disputes', 'disputed'],
    ['cancelled_by_driver', 'reassign', 'requested'],
  ] as const)('%s + %s donne %s', (from, event, to) => {
    expect(canTransition(from, event)).toBe(true);
    expect(transition(from, event).to).toBe(to);
  });

  it('l\'attribution exige un véhicule de la catégorie réservée ou d\'un rang supérieur', () => {
    expect(canTransition('offering', 'driver_accepts')).toBe(false);
    expect(canTransition('offering', 'driver_accepts', { vehicle_category_at_least_reserved: false })).toBe(false);
    expect(canTransition('offering', 'driver_accepts', { vehicle_category_at_least_reserved: true })).toBe(true);
    expect(transition('offering', 'driver_accepts', { vehicle_category_at_least_reserved: true })).toEqual({ to: 'assigned', effects: [] });
  });

  it('la non-présentation exige cinq minutes d\'attente et deux tentatives de contact', () => {
    expect(canTransition('arrived', 'client_no_show')).toBe(false);
    const r = transition('arrived', 'client_no_show', { waited_five_minutes_and_two_contacts: true });
    expect(r).toEqual({ to: 'no_show', effects: ['no_show_fee'] });
  });

  it('déclare les effets des annulations', () => {
    expect(transition('assigned', 'client_cancels').effects).toEqual(['cancellation_fee_if_outside_free_window']);
    expect(transition('en_route', 'client_cancels').effects).toEqual(['cancellation_fee']);
    expect(transition('arrived', 'client_cancels').effects).toEqual(['cancellation_fee']);
    expect(transition('assigned', 'driver_cancels').effects).toEqual(['reassign_with_priority']);
    expect(transition('en_route', 'driver_cancels').effects).toEqual(['driver_sanction', 'reassign_with_priority']);
  });
});

describe('transitions invalides', () => {
  it.each([
    ['quoted', 'driver_accepts'],
    ['requested', 'driver_departs'],
    ['requested', 'ride_ends'],
    ['offering', 'ride_starts'],
    ['assigned', 'ride_ends'],
    ['assigned', 'client_no_show'],
    ['en_route', 'ride_starts'],
    ['arrived', 'driver_cancels'],
    ['in_progress', 'client_cancels'],
    ['in_progress', 'driver_cancels'],
    ['completed', 'ride_ends'],
    ['rated', 'client_disputes'],
    ['no_driver', 'offers_sent'],
    ['cancelled_by_client', 'reassign'],
    ['no_show', 'ride_starts'],
    ['interrupted', 'ride_ends'],
    ['expired', 'client_confirms'],
  ] as const)('%s + %s est refusé', (from, event) => {
    expect(canTransition(from, event)).toBe(false);
    expect(findTransition(from, event)).toBeUndefined();
    expect(() => transition(from, event)).toThrow(RideTransitionError);
  });

  it('l\'erreur porte l\'état, l\'événement et le motif', () => {
    try { transition('completed', 'ride_ends'); } catch (e) {
      const err = e as RideTransitionError;
      expect(err.name).toBe('RideTransitionError');
      expect(err.from).toBe('completed');
      expect(err.event).toBe('ride_ends');
      expect(err.reason).toBe('no_transition');
      expect(err.message).toContain('completed + ride_ends');
    }
    try { transition('offering', 'driver_accepts'); } catch (e) {
      const err = e as RideTransitionError;
      expect(err.reason).toBe('guard_failed');
      expect(err.guard).toBe('vehicle_category_at_least_reserved');
      expect(err.message).toContain('Garde non satisfaite');
    }
  });

  it('eventsFrom liste les événements d\'un état', () => {
    expect(eventsFrom('arrived')).toEqual(['ride_starts', 'client_no_show', 'client_cancels']);
  });
});
