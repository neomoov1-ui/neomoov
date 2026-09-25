/**
 * Catégorie d'un véhicule déduite de son modèle (prompt 11, inscription) : la liste des modèles admis, l'année minimale
 * et le nombre de places viennent de la table `vehicle_categories`. Fonctions pures.
 */
import type { VehicleCategory } from '../enums.js';

export interface CategoryRule {
  code: VehicleCategory;
  rank: number;
  seats: number;
  minYear: number;
  allowedModels: readonly string[];
  active: boolean;
}

export interface VehicleDescription {
  make: string;
  model: string;
  year: number;
  seats: number;
}

export type CategoryRefusal = 'model_not_listed' | 'too_old' | 'not_enough_seats';

export interface CategoryDeduction {
  /** Catégorie du rang le plus élevé dont le véhicule remplit toutes les conditions ; null s'il n'en remplit aucune. */
  category: VehicleCategory | null;
  /** Motif du refus quand aucune catégorie ne convient : le premier critère manqué (modèle, puis année, puis places). */
  refusal: CategoryRefusal | null;
}

/** Nom comparable : sans accents, sans parenthèses (« Tesla Model X (7 places) »), minuscules, espaces simples. */
export function normalizeModelName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Le véhicule correspond au modèle admis : même nom, ou une finition du modèle (« Tesla Model 3 Long Range »). */
export function modelMatches(vehicle: Pick<VehicleDescription, 'make' | 'model'>, allowed: string): boolean {
  const target = normalizeModelName(allowed);
  if (!target) return false;
  const full = normalizeModelName(`${vehicle.make} ${vehicle.model}`);
  const modelOnly = normalizeModelName(vehicle.model);
  return full === target || modelOnly === target || full.startsWith(`${target} `) || modelOnly.startsWith(`${target} `);
}

export function deduceVehicleCategory(vehicle: VehicleDescription, rules: readonly CategoryRule[]): CategoryDeduction {
  const active = rules.filter((r) => r.active).sort((a, b) => b.rank - a.rank);
  const byModel = active.filter((r) => r.allowedModels.some((m) => modelMatches(vehicle, m)));
  if (!byModel.length) return { category: null, refusal: 'model_not_listed' };
  const byYear = byModel.filter((r) => vehicle.year >= r.minYear);
  if (!byYear.length) return { category: null, refusal: 'too_old' };
  const bySeats = byYear.filter((r) => vehicle.seats >= r.seats);
  if (!bySeats.length) return { category: null, refusal: 'not_enough_seats' };
  return { category: bySeats[0]!.code, refusal: null };
}

/** Liste des modèles admis pour le sélecteur de l'application (marque, modèle, catégorie la plus haute). */
export function admittedModels(rules: readonly CategoryRule[]): Array<{ name: string; categories: VehicleCategory[]; minYear: number }> {
  const byName = new Map<string, { name: string; categories: VehicleCategory[]; minYear: number }>();
  for (const rule of [...rules].filter((r) => r.active).sort((a, b) => a.rank - b.rank)) {
    for (const model of rule.allowedModels) {
      const key = normalizeModelName(model);
      const entry = byName.get(key) ?? { name: model.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), categories: [], minYear: rule.minYear };
      if (!entry.categories.includes(rule.code)) entry.categories.push(rule.code);
      entry.minYear = Math.min(entry.minYear, rule.minYear);
      byName.set(key, entry);
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}
