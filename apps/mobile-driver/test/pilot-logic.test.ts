import { describe, expect, it } from 'vitest';
import { centsToDollars, criteriaOf, dollarsToCents, formatTimeWindows, formOf, integerOrNull, parseTimeWindows } from '../src/features/pilot/criteria';
import { DEFAULT_PILOT_CRITERIA } from '@neomoov/domain';

describe('Neomoov Pilote : saisie des critères', () => {
  it('plages horaires : lignes « jours heures », jours en liste ou en plage, nuit comprise ; illisible : null', () => {
    expect(parseTimeWindows('1-5 07:00-19:00\n0,6 22:00-02:00\n')).toEqual([
      { days: [1, 2, 3, 4, 5], from: '07:00', to: '19:00' },
      { days: [0, 6], from: '22:00', to: '02:00' },
    ]);
    expect(parseTimeWindows('')).toEqual([]);
    expect(parseTimeWindows('1-7 07:00-19:00')).toBeNull();
    expect(parseTimeWindows('5-1 07:00-19:00')).toBeNull();
    expect(parseTimeWindows('1 7h-19h')).toBeNull();
    expect(parseTimeWindows('1 07:00-07:00')).toBeNull();
    expect(parseTimeWindows('1 07:00-19:00 x')).toBeNull();
    expect(parseTimeWindows('lundi 07:00-19:00')).toBeNull();
  });

  it('plages structurées vers le texte, jours consécutifs regroupés', () => {
    expect(formatTimeWindows([{ days: [3, 1, 2, 5], from: '07:00', to: '19:00' }, { days: [0], from: '22:00', to: '02:00' }])).toBe('1-3,5 07:00-19:00\n0 22:00-02:00');
    expect(formatTimeWindows([])).toBe('');
    expect(parseTimeWindows(formatTimeWindows([{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' }]))).toEqual([{ days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' }]);
  });

  it('montants en dollars et entiers', () => {
    expect(dollarsToCents('12,50')).toBe(1250);
    expect(dollarsToCents(' 12.5 ')).toBe(1250);
    expect(dollarsToCents('')).toBeNull();
    expect(dollarsToCents('abc')).toBeUndefined();
    expect(dollarsToCents('-3')).toBeUndefined();
    expect(centsToDollars(1250)).toBe('12.50');
    expect(centsToDollars(1200)).toBe('12');
    expect(centsToDollars(null)).toBe('');
    expect(integerOrNull('15')).toBe(15);
    expect(integerOrNull('')).toBeNull();
    expect(integerOrNull('1.5')).toBeUndefined();
  });

  it('formulaire vers critères et retour', () => {
    const form = formOf({ ...DEFAULT_PILOT_CRITERIA, minFareCents: 1500, maxPickupMeters: 2500, timeWindows: [{ days: [1], from: '07:00', to: '19:00' }], originZones: ['plateau'], categories: ['neo_premium'], minClientRating: 4.5 });
    expect(form).toMatchObject({ minFare: '15', maxPickupKm: '2.5', hours: '1 07:00-19:00', originZones: ['plateau'], minClientRating: '4.5', scheduleMargin: '30', multiAppMode: false });
    const result = criteriaOf(form);
    expect(result).toEqual({ criteria: { ...DEFAULT_PILOT_CRITERIA, minFareCents: 1500, maxPickupMeters: 2500, timeWindows: [{ days: [1], from: '07:00', to: '19:00' }], originZones: ['plateau'], categories: ['neo_premium'], minClientRating: 4.5 } });
    expect(criteriaOf({ ...form, minFare: 'x' })).toEqual({ error: 'amount' });
    expect(criteriaOf({ ...form, maxPickupMinutes: '2.5' })).toEqual({ error: 'number' });
    expect(criteriaOf({ ...form, maxPickupKm: '-1' })).toEqual({ error: 'number' });
    expect(criteriaOf({ ...form, hours: 'lundi' })).toEqual({ error: 'hours' });
    expect(criteriaOf({ ...form, minClientRating: '6' })).toEqual({ error: 'rating' });
    expect(criteriaOf({ ...form, scheduleMargin: '999' })).toEqual({ error: 'number' });
    expect(criteriaOf({ ...form, scheduleMargin: '', costPerKm: '' })).toMatchObject({ criteria: { scheduleMarginMinutes: 30, costPerKmCents: 0 } });
  });
});
