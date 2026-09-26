import { describe, expect, it, vi } from 'vitest';
import { describeBlocker } from '../src/features/home/blockers';
import { clock, endOfRidePending, isActive, navigationTarget, nextAction, noShowStatus, secondsLeft, waitedSeconds } from '../src/features/ride/steps';
import { navigationLinks, openNavigation } from '../src/lib/navigation';

const NOW = Date.parse('2026-09-26T12:00:00Z');

describe('déroulé de la course', () => {
  it('un seul bouton par étape, rien après la fin', () => {
    expect(['assigned', 'en_route', 'arrived', 'in_progress', 'completed'].map((s) => nextAction(s as never))).toEqual(['depart', 'arrive', 'start', 'complete', null]);
    expect(isActive('arrived')).toBe(true);
    expect(isActive('completed')).toBe(false);
  });

  it('conduit au client, puis à la destination une fois le client à bord', () => {
    const ride = { origin: 'A', destination: 'B' };
    expect(navigationTarget({ ...ride, state: 'en_route' })).toBe('A');
    expect(navigationTarget({ ...ride, state: 'in_progress' })).toBe('B');
  });

  it('compte à rebours de l\'offre et compteur d\'attente', () => {
    expect(secondsLeft('2026-09-26T12:00:15Z', NOW)).toBe(15);
    expect(secondsLeft('2026-09-26T11:59:00Z', NOW)).toBe(0);
    expect(waitedSeconds('2026-09-26T11:55:30Z', NOW)).toBe(270);
    expect(waitedSeconds(undefined, NOW)).toBe(0);
    expect(clock(270)).toBe('4:30');
    expect(clock(-5)).toBe('0:00');
  });

  it('non-présentation : attente minimale et tentatives de contact', () => {
    const job = (availableAt: string | null, contactAttempts: number) => ({ noShow: { availableAt, minContacts: 2 }, contactAttempts });
    expect(noShowStatus(job('2026-09-26T12:01:00Z', 2), NOW)).toEqual({ ready: false, secondsLeft: 60, contactsLeft: 0 });
    expect(noShowStatus(job('2026-09-26T11:59:00Z', 1), NOW)).toEqual({ ready: false, secondsLeft: 0, contactsLeft: 1 });
    expect(noShowStatus(job('2026-09-26T11:59:00Z', 2), NOW)).toEqual({ ready: true, secondsLeft: 0, contactsLeft: 0 });
    expect(noShowStatus(job(null, 3), NOW).ready).toBe(false);
  });

  it('fin de course : montant reçu à confirmer en paiement direct, client à évaluer', () => {
    const job = (direct: boolean, confirmedCents: number | null, clientRated: boolean) => ({ payment: { direct, amountDueCents: 4200, confirmedCents }, clientRated });
    expect(endOfRidePending({ state: 'completed', job: job(true, null, false) })).toEqual({ payment: true, rating: true });
    expect(endOfRidePending({ state: 'completed', job: job(true, 4200, true) })).toEqual({ payment: false, rating: false });
    expect(endOfRidePending({ state: 'completed', job: job(false, null, false) })).toEqual({ payment: false, rating: true });
    expect(endOfRidePending({ state: 'in_progress', job: job(true, null, false) })).toEqual({ payment: false, rating: false });
  });
});

describe('navigation externe', () => {
  const target = { lat: 45.5, lng: -73.6 };
  it('liens profonds Google Maps et Waze par plateforme, lien universel en dernier', () => {
    expect(navigationLinks('google', target, 'android')).toEqual(['google.navigation:q=45.5,-73.6&mode=d', 'https://www.google.com/maps/dir/?api=1&destination=45.5,-73.6&travelmode=driving']);
    expect(navigationLinks('google', target, 'ios')[0]).toBe('comgooglemaps://?daddr=45.5,-73.6&directionsmode=driving');
    expect(navigationLinks('google', target, 'web')).toHaveLength(1);
    expect(navigationLinks('waze', target, 'ios')).toEqual(['waze://?ll=45.5,-73.6&navigate=yes', 'https://waze.com/ul?ll=45.5,-73.6&navigate=yes']);
    expect(navigationLinks('waze', target, 'web')).toEqual(['https://waze.com/ul?ll=45.5,-73.6&navigate=yes']);
  });

  it('ouvre l\'application installée, sinon le lien universel', async () => {
    const open = vi.fn(async () => undefined);
    expect(await openNavigation('waze', target, 'android', { canOpen: async () => true, open })).toBe('waze://?ll=45.5,-73.6&navigate=yes');
    expect(await openNavigation('waze', target, 'android', { canOpen: async () => false, open })).toBe('https://waze.com/ul?ll=45.5,-73.6&navigate=yes');
    expect(await openNavigation('google', target, 'ios', { canOpen: async () => Promise.reject(new Error('refus')), open })).toContain('https://www.google.com/maps');
    expect(open).toHaveBeenCalledTimes(3);
  });
});

describe('prérequis du passage en ligne', () => {
  it('chaque raison de l\'API a son libellé et l\'écran qui la règle', () => {
    expect(describeBlocker('document_missing:licence')).toEqual({ key: 'document_missing', params: { type: 'licence' }, fix: '/documents' });
    expect(describeBlocker('vehicle_status:pending')).toEqual({ key: 'vehicle_pending', params: {}, fix: null });
    expect(describeBlocker('vehicle_status:non_compliant').fix).toBe('/onboarding/vehicle');
    expect(describeBlocker('driver_status:pending')).toEqual({ key: 'driver_pending', params: {}, fix: null });
    expect(describeBlocker('training_required').fix).toBe('/training');
    expect(describeBlocker('payout_required').fix).toBe('/payout');
    expect(describeBlocker('pack_required').fix).toBe('/packs');
    expect(describeBlocker('pack_exhausted')).toEqual({ key: 'pack_exhausted', params: {}, fix: '/packs' });
    expect(describeBlocker('pack_expired').fix).toBe('/packs');
    expect(describeBlocker('geolocation_consent_withdrawn').fix).toBe('/profile');
    expect(describeBlocker('vehicle_missing').fix).toBe('/onboarding/vehicle');
    expect(describeBlocker('balance_suspended').fix).toBeNull();
    expect(describeBlocker('suspended').fix).toBeNull();
    expect(describeBlocker('nouvelle_raison')).toEqual({ key: 'unknown', params: { reason: 'nouvelle_raison' }, fix: null });
  });
});
