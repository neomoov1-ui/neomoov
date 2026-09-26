import { describe, expect, it } from 'vitest';
import { addMonths, complianceStep, mechanicalInspectionDueOn } from '../src/index.js';

describe('vérification mécanique (4 ans ou 80 000 km, puis chaque année ou 60 000 km)', () => {
  it('première vérification : 4 ans après l\'année modèle', () => {
    expect(mechanicalInspectionDueOn({ year: 2024, odometerKm: 20_000, lastInspectionOn: null, lastInspectionKm: null }, '2026-09-26')).toBe('2028-01-01');
  });
  it('première vérification : 80 000 km atteints avant 4 ans, exigible le jour même', () => {
    expect(mechanicalInspectionDueOn({ year: 2025, odometerKm: 81_000, lastInspectionOn: null, lastInspectionKm: null }, '2026-09-26')).toBe('2026-09-26');
  });
  it('véhicule déjà ancien sans vérification : l\'échéance est passée', () => {
    expect(mechanicalInspectionDueOn({ year: 2019, odometerKm: null, lastInspectionOn: null, lastInspectionKm: null }, '2026-09-26')).toBe('2023-01-01');
  });
  it('ensuite : un an après la dernière, ou 60 000 km de plus', () => {
    expect(mechanicalInspectionDueOn({ year: 2020, odometerKm: 150_000, lastInspectionOn: '2026-03-15', lastInspectionKm: 120_000 }, '2026-09-26')).toBe('2027-03-15');
    expect(mechanicalInspectionDueOn({ year: 2020, odometerKm: 181_000, lastInspectionOn: '2026-03-15', lastInspectionKm: 120_000 }, '2026-09-26')).toBe('2026-09-26');
    expect(mechanicalInspectionDueOn({ year: 2020, odometerKm: 181_000, lastInspectionOn: '2025-03-15', lastInspectionKm: 120_000 }, '2026-09-26')).toBe('2026-03-15');
    expect(mechanicalInspectionDueOn({ year: 2020, odometerKm: 181_000, lastInspectionOn: '2026-03-15', lastInspectionKm: null }, '2026-09-26')).toBe('2027-03-15');
  });
  it('ajout de mois : fin de mois ramenée au dernier jour', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-06-15', 12)).toBe('2027-06-15');
  });
});

describe('échéances : rappels J-30, J-7, J-1 puis dépassement à minuit', () => {
  const pending = (dueOn: string, remindersSent = 0) => ({ dueOn, status: 'pending' as const, remindersSent });
  it('un rappel par seuil, jamais deux fois', () => {
    expect(complianceStep(pending('2026-10-26'), '2026-09-26')).toEqual({ reminderDays: 30, remindersSent: 1, becomesOverdue: false });
    expect(complianceStep(pending('2026-10-26', 1), '2026-09-27')).toEqual({ reminderDays: null, remindersSent: 1, becomesOverdue: false });
    expect(complianceStep(pending('2026-10-26', 1), '2026-10-19')).toEqual({ reminderDays: 7, remindersSent: 2, becomesOverdue: false });
    expect(complianceStep(pending('2026-10-26', 2), '2026-10-25')).toEqual({ reminderDays: 1, remindersSent: 3, becomesOverdue: false });
  });
  it('échéance apprise tard : seulement le rappel du jour', () => {
    expect(complianceStep(pending('2026-10-01'), '2026-09-26')).toEqual({ reminderDays: 5, remindersSent: 2, becomesOverdue: false });
    expect(complianceStep(pending('2026-09-27'), '2026-09-26')).toEqual({ reminderDays: 1, remindersSent: 3, becomesOverdue: false });
  });
  it('valide toute la journée de l\'échéance, dépassée le lendemain', () => {
    expect(complianceStep(pending('2026-09-26', 3), '2026-09-26')).toEqual({ reminderDays: null, remindersSent: 3, becomesOverdue: false });
    expect(complianceStep(pending('2026-09-26', 3), '2026-09-27')).toEqual({ reminderDays: null, remindersSent: 3, becomesOverdue: true });
  });
  it('échéance résolue ou déjà dépassée : rien', () => {
    expect(complianceStep({ dueOn: '2026-09-20', status: 'overdue', remindersSent: 3 }, '2026-09-26')).toEqual({ reminderDays: null, remindersSent: 3, becomesOverdue: false });
    expect(complianceStep({ dueOn: '2026-09-20', status: 'resolved', remindersSent: 1 }, '2026-09-26')).toEqual({ reminderDays: null, remindersSent: 1, becomesOverdue: false });
  });
});
