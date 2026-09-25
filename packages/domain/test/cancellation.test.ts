import { describe, expect, it } from 'vitest';
import { clientCancellationFeeCents, noShowCheck, waitedSecondsBetween, type CancellationRules } from '../src/index.js';

const rules: CancellationRules = { freeCancellationSeconds: 120, cancellationFeeCents: 500, noShowFeeCents: 700, noShowMinWaitSeconds: 300, noShowMinContacts: 2 };
const T0 = new Date('2026-09-25T14:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe('frais d\'annulation du client (5.2)', () => {
  it('gratuit avant l\'attribution', () => {
    expect(clientCancellationFeeCents({ state: 'quoted', assignedAt: null, now: T0 }, rules)).toBe(0);
    expect(clientCancellationFeeCents({ state: 'requested', assignedAt: null, now: T0 }, rules)).toBe(0);
    expect(clientCancellationFeeCents({ state: 'offering', assignedAt: null, now: T0 }, rules)).toBe(0);
  });
  it('gratuit dans les deux minutes après l\'attribution, 5,00 $ ensuite', () => {
    expect(clientCancellationFeeCents({ state: 'assigned', assignedAt: T0, now: at(120) }, rules)).toBe(0);
    expect(clientCancellationFeeCents({ state: 'assigned', assignedAt: T0, now: at(121) }, rules)).toBe(500);
    expect(clientCancellationFeeCents({ state: 'assigned', assignedAt: null, now: at(1) }, rules)).toBe(500);
  });
  it('5,00 $ en route et sur place ; rien dans un état terminal', () => {
    expect(clientCancellationFeeCents({ state: 'en_route', assignedAt: T0, now: at(10) }, rules)).toBe(500);
    expect(clientCancellationFeeCents({ state: 'arrived', assignedAt: T0, now: at(10) }, rules)).toBe(500);
    expect(clientCancellationFeeCents({ state: 'completed', assignedAt: T0, now: at(10) }, rules)).toBe(0);
  });
});

describe('non-présentation', () => {
  it('exige cinq minutes d\'attente et deux tentatives de contact', () => {
    expect(noShowCheck({ arrivedAt: T0, now: at(299), contactAttempts: 2 }, rules)).toEqual({ allowed: false, reason: 'not_waited_enough', waitedSeconds: 299, contactAttempts: 2 });
    expect(noShowCheck({ arrivedAt: T0, now: at(300), contactAttempts: 1 }, rules)).toEqual({ allowed: false, reason: 'not_enough_contacts', waitedSeconds: 300, contactAttempts: 1 });
    expect(noShowCheck({ arrivedAt: T0, now: at(300), contactAttempts: 2 }, rules)).toEqual({ allowed: true, feeCents: 700, waitedSeconds: 300 });
  });
  it('attente facturable entre l\'arrivée et le départ', () => {
    expect(waitedSecondsBetween(T0, at(425))).toBe(425);
    expect(waitedSecondsBetween(at(10), T0)).toBe(0);
    expect(waitedSecondsBetween(null, T0)).toBe(0);
    expect(waitedSecondsBetween(T0, null)).toBe(0);
  });
});
