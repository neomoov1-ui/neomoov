/**
 * Module Flotte (étape 23, amendement v1.2 section 6) : partage des revenus entre une organisation et ses chauffeurs,
 * ce qu'une course non pourvue transmet au réseau Neomoov, échéances d'entretien des véhicules. Fonctions pures,
 * montants en cents, dates locales AAAA-MM-JJ. Uniquement les courses Neomoov (décision D1 du fondateur) : aucune
 * donnée ni action d'une autre plateforme.
 */
import { mulDivRound } from '../pricing/quote.js';

/** `rent` : loyer fixe par semaine ; `percentage` : part de l'organisation sur le tarif chauffeur des courses. */
export const REVENUE_SHARE_MODES = ['rent', 'percentage'] as const;
export type RevenueShareMode = (typeof REVENUE_SHARE_MODES)[number];

/** `isolated` : les courses de l'organisation restent à ses chauffeurs ; `neomoov_network` : non pourvues, elles repartent au réseau. */
export const NETWORK_MODES = ['isolated', 'neomoov_network'] as const;
export type NetworkMode = (typeof NETWORK_MODES)[number];

export const MAINTENANCE_KINDS = ['inspection', 'oil_change', 'tires', 'brakes', 'battery', 'repair', 'cleaning', 'other'] as const;
export type MaintenanceKind = (typeof MAINTENANCE_KINDS)[number];

export interface RevenueShareRule {
  id: string;
  /** Chauffeur visé ; `null` : règle par défaut de l'organisation. */
  driverId: string | null;
  mode: RevenueShareMode;
  /** Loyer par semaine (mode `rent`). */
  weeklyRentCents: number | null;
  /** Part de l'organisation, en parties par million du tarif chauffeur (mode `percentage`). */
  percentagePpm: number | null;
  effectiveFrom: string;
  /** Dernier jour inclus, ou `null` : sans fin. */
  effectiveTo: string | null;
}

export function ruleApplies(rule: Pick<RevenueShareRule, 'effectiveFrom' | 'effectiveTo'>, date: string): boolean {
  return rule.effectiveFrom <= date && (rule.effectiveTo === null || date <= rule.effectiveTo);
}

/**
 * Règle en vigueur pour un chauffeur à une date : celle du chauffeur d'abord, sinon celle de l'organisation ; entre
 * deux règles du même niveau, la plus récente (date d'effet la plus tardive).
 */
export function ruleOn(rules: readonly RevenueShareRule[], driverId: string, date: string): RevenueShareRule | null {
  const applicable = rules.filter((r) => ruleApplies(r, date) && (r.driverId === null || r.driverId === driverId));
  applicable.sort((a, b) => Number(b.driverId !== null) - Number(a.driverId !== null) || b.effectiveFrom.localeCompare(a.effectiveFrom));
  return applicable[0] ?? null;
}

/** Jours d'une période, bornes comprises. */
export function datesBetween(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const day = new Date(`${startDate}T00:00:00Z`);
  for (let date = startDate; date <= endDate; date = day.toISOString().slice(0, 10)) {
    out.push(date);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  return out;
}

/** Pourcentage lisible (`200000` ppm : « 20 % », `125000` : « 12,5 % »). */
export function formatShare(ppm: number): string {
  return `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(ppm / 10_000)} %`;
}

/** Course terminée d'un chauffeur, vue par le partage des revenus : son jour local et son tarif chauffeur (hors taxes, pourboire et péages). */
export interface ShareRide {
  rideId: string;
  date: string;
  fareCents: number;
}

export interface RevenueShareLine {
  ruleId: string;
  mode: RevenueShareMode;
  amountCents: number;
  /** Mode `percentage` : tarif chauffeur des courses couvertes ; mode `rent` : 0. */
  baseCents: number;
  /** Mode `rent` : jours de la période couverts par la règle ; mode `percentage` : 0. */
  days: number;
  label: string;
}

/**
 * Part de l'organisation sur une période de relevé : loyer au prorata des jours de la période où une règle « loyer »
 * s'applique, pourcentage du tarif chauffeur des courses du relevé (celles que l'appelant fournit, y compris une course
 * en retard d'une semaine précédente) selon la règle en vigueur le jour de chaque course. Une ligne par règle, les lignes
 * nulles écartées. Le tarif retenu est le tarif complet de la course (une promotion est compensée au chauffeur à 100 %).
 */
export function revenueShare(rules: readonly RevenueShareRule[], driverId: string, period: { startDate: string; endDate: string }, rides: readonly ShareRide[]): { totalCents: number; lines: RevenueShareLine[] } {
  const byRule = new Map<string, { rule: RevenueShareRule; days: number; baseCents: number }>();
  const entry = (rule: RevenueShareRule) => {
    let e = byRule.get(rule.id);
    if (!e) byRule.set(rule.id, (e = { rule, days: 0, baseCents: 0 }));
    return e;
  };
  const daysInPeriod = datesBetween(period.startDate, period.endDate);
  for (const date of daysInPeriod) {
    const rule = ruleOn(rules, driverId, date);
    if (rule?.mode === 'rent') entry(rule).days += 1;
  }
  for (const ride of rides) {
    const rule = ruleOn(rules, driverId, ride.date);
    if (rule?.mode === 'percentage') entry(rule).baseCents += ride.fareCents;
  }
  const lines: RevenueShareLine[] = [];
  for (const { rule, days, baseCents } of byRule.values()) {
    const rent = rule.mode === 'rent';
    const ppm = rule.percentagePpm ?? 0;
    const amountCents = rent ? mulDivRound(rule.weeklyRentCents ?? 0, days, 7) : mulDivRound(baseCents, ppm, 1_000_000);
    if (amountCents <= 0) continue;
    const label = rent
      ? days === 7 ? 'Part de l\'organisation : loyer de la semaine' : `Part de l'organisation : loyer (${days} jours sur 7)`
      : `Part de l'organisation : ${formatShare(ppm)} du tarif`;
    lines.push({ ruleId: rule.id, mode: rule.mode, amountCents, baseCents: rent ? 0 : baseCents, days: rent ? days : 0, label });
  }
  return { totalCents: lines.reduce((sum, l) => sum + l.amountCents, 0), lines };
}

/** Une règle est cohérente : un loyer pour `rent`, un pourcentage pour `percentage`, une fin après le début. */
export function revenueShareRuleProblem(rule: Pick<RevenueShareRule, 'mode' | 'weeklyRentCents' | 'percentagePpm' | 'effectiveFrom' | 'effectiveTo'>): string | null {
  if (rule.mode === 'rent' && !(rule.weeklyRentCents && rule.weeklyRentCents > 0)) return 'RENT_REQUIRED';
  if (rule.mode === 'percentage' && !(rule.percentagePpm && rule.percentagePpm > 0 && rule.percentagePpm <= 1_000_000)) return 'PERCENTAGE_REQUIRED';
  if (rule.effectiveTo !== null && rule.effectiveTo < rule.effectiveFrom) return 'END_BEFORE_START';
  return null;
}

// --- Réseau Neomoov ---

/**
 * Seuls champs qu'une course d'une organisation transmet au réseau Neomoov quand elle y repart (amendement v1.2,
 * section 4) : adresses, heure, prix et prénom du passager. Ni nom complet, ni téléphone, ni courriel, ni client, ni
 * demandes particulières, ni notes de l'organisation.
 */
export const NETWORK_SHARED_FIELDS = ['rideId', 'category', 'type', 'origin', 'destination', 'requestedAt', 'driverFareCents', 'passengerFirstName'] as const;

export interface NetworkPlace {
  address: string;
  coordinates: { lat: number; lng: number };
}

export interface NetworkSharedRide {
  rideId: string;
  category: string;
  type: string;
  origin: NetworkPlace;
  destination: NetworkPlace;
  requestedAt: string | null;
  driverFareCents: number;
  passengerFirstName: string | null;
}

/** Prénom seul d'un nom complet (`null` si vide). */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first ? first : null;
}

/** Ne garde que les champs permis, quel que soit ce que l'appelant fournit. */
export function networkSharedRide(source: NetworkSharedRide & Record<string, unknown>): NetworkSharedRide {
  return {
    rideId: source.rideId, category: source.category, type: source.type,
    origin: { address: source.origin.address, coordinates: { lat: source.origin.coordinates.lat, lng: source.origin.coordinates.lng } },
    destination: { address: source.destination.address, coordinates: { lat: source.destination.coordinates.lat, lng: source.destination.coordinates.lng } },
    requestedAt: source.requestedAt, driverFareCents: source.driverFareCents, passengerFirstName: firstNameOf(source.passengerFirstName),
  };
}

/**
 * Une course d'une organisation en mode réseau repart au réseau Neomoov quand elle n'a toujours pas de chauffeur
 * `afterMinutes` après sa demande (ou, planifiée, moins de `afterMinutes` avant son heure si c'est plus tôt). Jamais
 * en mode isolé, jamais deux fois, jamais une course pourvue ou close (`no_driver` est un état final : une course
 * immédiate épuisée avant le délai n'est pas reprise).
 */
export function shouldShareToNetwork(input: { networkMode: NetworkMode; afterMinutes: number; createdAt: Date; requestedAt: Date | null; now: Date; state: string; hasDriver: boolean; sharedAt: Date | null }): boolean {
  if (input.networkMode !== 'neomoov_network' || input.sharedAt || input.hasDriver) return false;
  if (!['requested', 'offering'].includes(input.state)) return false;
  const waited = input.now.getTime() - input.createdAt.getTime() >= input.afterMinutes * 60_000;
  const close = input.requestedAt !== null && input.requestedAt.getTime() - input.now.getTime() <= input.afterMinutes * 60_000;
  return waited || close;
}

// --- Entretien ---

export interface MaintenanceRecord {
  kind: MaintenanceKind;
  performedOn: string;
  odometerKm: number | null;
  nextDueOn: string | null;
  nextDueKm: number | null;
}

export type MaintenanceStatus = 'ok' | 'due_soon' | 'overdue';

export interface MaintenanceDue {
  kind: MaintenanceKind;
  dueOn: string | null;
  dueKm: number | null;
  status: MaintenanceStatus;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Échéances d'entretien d'un véhicule : pour chaque type, celle du dernier entretien enregistré (date ou kilométrage),
 * en retard, proche (`soonDays` jours ou `soonKm` kilomètres) ou à jour ; les plus urgentes d'abord.
 */
export function maintenanceDue(records: readonly MaintenanceRecord[], today: string, odometerKm: number | null, options: { soonDays?: number; soonKm?: number } = {}): MaintenanceDue[] {
  const soonDays = options.soonDays ?? 14;
  const soonKm = options.soonKm ?? 1000;
  const latest = new Map<MaintenanceKind, MaintenanceRecord>();
  for (const r of records) {
    const known = latest.get(r.kind);
    if (!known || r.performedOn > known.performedOn) latest.set(r.kind, r);
  }
  const rank: Record<MaintenanceStatus, number> = { overdue: 0, due_soon: 1, ok: 2 };
  const out: MaintenanceDue[] = [];
  for (const r of latest.values()) {
    if (r.nextDueOn === null && r.nextDueKm === null) continue;
    const byDate: MaintenanceStatus = r.nextDueOn === null ? 'ok' : r.nextDueOn < today ? 'overdue' : daysBetween(today, r.nextDueOn) <= soonDays ? 'due_soon' : 'ok';
    const byKm: MaintenanceStatus = r.nextDueKm === null || odometerKm === null ? 'ok' : odometerKm >= r.nextDueKm ? 'overdue' : r.nextDueKm - odometerKm <= soonKm ? 'due_soon' : 'ok';
    out.push({ kind: r.kind, dueOn: r.nextDueOn, dueKm: r.nextDueKm, status: rank[byDate] <= rank[byKm] ? byDate : byKm });
  }
  const dateKey = (d: MaintenanceDue): string => d.dueOn ?? '9999-12-31';
  return out.sort((a, b) => rank[a.status] - rank[b.status] || dateKey(a).localeCompare(dateKey(b)));
}
