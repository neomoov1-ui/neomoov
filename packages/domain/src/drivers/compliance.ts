/**
 * Conformité des chauffeurs et des véhicules (prompt 14, tâche 1) : échéance de la vérification mécanique, rappels avant
 * échéance, échéance dépassée. Fonctions pures sur des dates civiles AAAA-MM-JJ (heure de Montréal, calculées par
 * l'appelant). Un document valide « jusqu'au » jour J l'est toute la journée : il est échu à minuit, le jour J+1.
 */
import { daysBetween } from './documents.js';

export interface InspectionRules {
  /** Première vérification mécanique : véhicule de 4 ans… */
  firstAfterYears: number;
  /** … ou 80 000 km, au premier atteint. */
  firstAfterKm: number;
  /** Ensuite chaque année… */
  everyMonths: number;
  /** … ou tous les 60 000 km (kilométrage relevé à la dernière vérification). */
  everyKm: number;
}

export const DEFAULT_INSPECTION_RULES: InspectionRules = { firstAfterYears: 4, firstAfterKm: 80_000, everyMonths: 12, everyKm: 60_000 };

export interface VehicleInspectionState {
  /** Année modèle. */
  year: number;
  /** Kilométrage déclaré le plus récent. */
  odometerKm: number | null;
  /** Dernière vérification mécanique réussie, et le kilométrage relevé ce jour-là. */
  lastInspectionOn: string | null;
  lastInspectionKm: number | null;
}

export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * Date à laquelle la prochaine vérification mécanique est exigée : un kilométrage déjà atteint la rend exigible le jour
 * même. Avant la première : 4 ans après le 1er janvier de l'année modèle ou 80 000 km ; ensuite : un an après la
 * dernière ou 60 000 km de plus.
 */
export function mechanicalInspectionDueOn(vehicle: VehicleInspectionState, today: string, rules: InspectionRules = DEFAULT_INSPECTION_RULES): string {
  const km = vehicle.odometerKm ?? 0;
  if (!vehicle.lastInspectionOn) {
    const byAge = `${vehicle.year + rules.firstAfterYears}-01-01`;
    return km >= rules.firstAfterKm && byAge > today ? today : byAge;
  }
  const byDate = addMonths(vehicle.lastInspectionOn, rules.everyMonths);
  const kmReached = vehicle.lastInspectionKm !== null && km - vehicle.lastInspectionKm >= rules.everyKm;
  return kmReached && byDate > today ? today : byDate;
}

export interface ComplianceCheckState {
  dueOn: string;
  status: 'pending' | 'resolved' | 'overdue';
  /** Nombre de seuils de rappel déjà franchis (J-30, J-7, J-1 : 0 à 3). */
  remindersSent: number;
}

export interface ComplianceStep {
  /** Rappel à envoyer aujourd'hui : jours restants avant l'échéance, sinon null. */
  reminderDays: number | null;
  remindersSent: number;
  /** Échéance dépassée : suspension à appliquer (une fois). */
  becomesOverdue: boolean;
}

/**
 * Passe quotidienne d'une échéance : un seul rappel par seuil franchi (une échéance apprise à 5 jours ne reçoit que le
 * rappel du jour, les seuils de 30 et 7 jours sont comptés comme passés), puis dépassement le lendemain de l'échéance.
 */
export function complianceStep(check: ComplianceCheckState, today: string, reminderDays: readonly number[] = [30, 7, 1]): ComplianceStep {
  const thresholds = [...reminderDays].sort((a, b) => b - a);
  const left = daysBetween(today, check.dueOn);
  if (check.status !== 'pending') return { reminderDays: null, remindersSent: check.remindersSent, becomesOverdue: false };
  if (left < 0) return { reminderDays: null, remindersSent: thresholds.length, becomesOverdue: true };
  const passed = thresholds.filter((t) => left <= t).length;
  if (passed > check.remindersSent) return { reminderDays: left, remindersSent: passed, becomesOverdue: false };
  return { reminderDays: null, remindersSent: check.remindersSent, becomesOverdue: false };
}
