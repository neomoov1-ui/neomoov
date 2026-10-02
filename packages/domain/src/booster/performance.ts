/**
 * Neomoov Booster (phase 1, agent G) : rapport de performance d'une session de travail. Le chauffeur note ses valeurs au
 * départ et à l'arrivée (ou les fait lire sur des captures d'écran des applications qu'il utilise) ; le domaine calcule
 * les différences, le solde de la session et les ratios par heure et par kilomètre, puis les récapitulatifs par
 * semaine et par mois. Montants en cents ; aucune règle métier chiffrée ici.
 */
import { z } from 'zod';

export const PERFORMANCE_SOURCES = ['manual', 'screenshot'] as const;
export type PerformanceSource = (typeof PERFORMANCE_SOURCES)[number];

/** `draft` : en saisie ; `analysed` : captures lues, à confirmer ; `confirmed` : validé par le chauffeur. */
export const PERFORMANCE_STATUSES = ['draft', 'analysed', 'confirmed'] as const;
export type PerformanceStatus = (typeof PERFORMANCE_STATUSES)[number];

export const PERFORMANCE_PERIODS = ['week', 'month'] as const;
export type PerformancePeriod = (typeof PERFORMANCE_PERIODS)[number];

export interface PerformanceFigures {
  startedAt: Date | null;
  endedAt: Date | null;
  /** Autonomie ou niveau de carburant, en pourcentage. */
  startEnergyPercent: number | null;
  endEnergyPercent: number | null;
  startOdometerKm: number | null;
  endOdometerKm: number | null;
  onlineMinutes: number | null;
  drivingMinutes: number | null;
  ridesCount: number | null;
  ridesCents: number;
  tipsCents: number;
  promotionsCents: number;
  energyCents: number;
  cleaningCents: number;
}

export interface PerformanceSummary {
  /** Durée entre le début et la fin déclarés ; nulle si l'une manque ou si la fin précède le début. */
  sessionMinutes: number | null;
  /** Minutes qui servent aux ratios horaires : temps en ligne déclaré, sinon durée de la session. */
  basisMinutes: number | null;
  distanceKm: number | null;
  /** Points d'autonomie consommés (départ moins arrivée ; négatif après une recharge en cours de session). */
  energyUsedPoints: number | null;
  energyPer100Km: number | null;
  drivingSharePercent: number | null;
  grossCents: number;
  costsCents: number;
  netCents: number;
  netPerHourCents: number | null;
  netPerKmCents: number | null;
  grossPerRideCents: number | null;
  tipsPercent: number | null;
}

const round = (value: number): number => Math.round(value);

/** Calculs d'une session : différences, solde (courses + pourboires + promotions, moins énergie et nettoyage), ratios. */
export function performanceSummary(f: PerformanceFigures): PerformanceSummary {
  const sessionMinutes = f.startedAt && f.endedAt && f.endedAt.getTime() >= f.startedAt.getTime() ? round((f.endedAt.getTime() - f.startedAt.getTime()) / 60_000) : null;
  const basisMinutes = f.onlineMinutes ?? sessionMinutes;
  const distanceKm = f.startOdometerKm !== null && f.endOdometerKm !== null && f.endOdometerKm >= f.startOdometerKm ? f.endOdometerKm - f.startOdometerKm : null;
  const energyUsedPoints = f.startEnergyPercent !== null && f.endEnergyPercent !== null ? f.startEnergyPercent - f.endEnergyPercent : null;
  const energyPer100Km = energyUsedPoints !== null && energyUsedPoints > 0 && distanceKm !== null && distanceKm > 0 ? Math.round((energyUsedPoints / distanceKm) * 1000) / 10 : null;
  const drivingSharePercent = f.onlineMinutes !== null && f.onlineMinutes > 0 && f.drivingMinutes !== null ? round((f.drivingMinutes / f.onlineMinutes) * 100) : null;
  const grossCents = f.ridesCents + f.tipsCents + f.promotionsCents;
  const costsCents = f.energyCents + f.cleaningCents;
  const netCents = grossCents - costsCents;
  return {
    sessionMinutes,
    basisMinutes,
    distanceKm,
    energyUsedPoints,
    energyPer100Km,
    drivingSharePercent,
    grossCents,
    costsCents,
    netCents,
    netPerHourCents: basisMinutes !== null && basisMinutes > 0 ? round((netCents * 60) / basisMinutes) : null,
    netPerKmCents: distanceKm !== null && distanceKm > 0 ? round(netCents / distanceKm) : null,
    grossPerRideCents: f.ridesCount !== null && f.ridesCount > 0 ? round(f.ridesCents / f.ridesCount) : null,
    tipsPercent: f.ridesCents > 0 ? round((f.tipsCents / f.ridesCents) * 100) : null,
  };
}

export interface PerformanceTotals {
  sessions: number;
  minutes: number;
  distanceKm: number;
  rides: number;
  grossCents: number;
  tipsCents: number;
  costsCents: number;
  netCents: number;
  netPerHourCents: number | null;
  netPerKmCents: number | null;
}

/** Totaux d'une période : chaque session apporte ce qu'elle a (une session sans odomètre n'ajoute pas de kilomètres). */
export function aggregatePerformance(sessions: ReadonlyArray<{ figures: PerformanceFigures; summary: PerformanceSummary }>): PerformanceTotals {
  const totals: PerformanceTotals = { sessions: 0, minutes: 0, distanceKm: 0, rides: 0, grossCents: 0, tipsCents: 0, costsCents: 0, netCents: 0, netPerHourCents: null, netPerKmCents: null };
  for (const { figures, summary } of sessions) {
    totals.sessions += 1;
    totals.minutes += summary.basisMinutes ?? 0;
    totals.distanceKm += summary.distanceKm ?? 0;
    totals.rides += figures.ridesCount ?? 0;
    totals.grossCents += summary.grossCents;
    totals.tipsCents += figures.tipsCents;
    totals.costsCents += summary.costsCents;
    totals.netCents += summary.netCents;
  }
  totals.netPerHourCents = totals.minutes > 0 ? round((totals.netCents * 60) / totals.minutes) : null;
  totals.netPerKmCents = totals.distanceKm > 0 ? round(totals.netCents / totals.distanceKm) : null;
  return totals;
}

/** Date civile `AAAA-MM-JJ` décalée de `days` jours. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Bornes d'une période civile (incluses) : semaine du lundi au dimanche, ou mois. */
export function periodBounds(date: string, period: PerformancePeriod): { start: string; end: string } {
  if (period === 'month') {
    const start = `${date.slice(0, 7)}-01`;
    const next = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 1));
    return { start, end: addDays(next.toISOString().slice(0, 10), -1) };
  }
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const start = addDays(date, -((weekday + 6) % 7));
  return { start, end: addDays(start, 6) };
}

/** Numéro de semaine ISO 8601 (`2026-W41`) d'une date civile. */
export function isoWeekLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const nullableCents = z.number().int().min(0).max(100_000_000).nullable();
const nullableCount = z.number().int().min(0).max(100_000).nullable();
const confidence = z.number().min(0).max(1);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();

/** Sortie structurée attendue du modèle pour la lecture des captures d'écran (prompt `performance-reading.v1`). */
export const performanceReadingSchema = z.object({
  /** Application reconnue (Uber, Lyft, Eva, répartiteur), nulle si inconnue ; un nom lu, jamais une donnée du compte. */
  app: z.string().max(40).nullable(),
  /** Date de la session lue sur la capture, `AAAA-MM-JJ`, nulle si absente. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  startedAt: time,
  endedAt: time,
  ridesCents: nullableCents,
  tipsCents: nullableCents,
  promotionsCents: nullableCents,
  ridesCount: nullableCount,
  onlineMinutes: nullableCount,
  drivingMinutes: nullableCount,
  confidence: z.object({ amounts: confidence, counts: confidence, times: confidence }),
  photosUnusable: z.array(z.number().int().min(0)).max(12),
  summary: z.string().max(400),
});
export type PerformanceReading = z.infer<typeof performanceReadingSchema>;

export interface PerformancePrefill {
  ridesCents: number | null;
  tipsCents: number | null;
  promotionsCents: number | null;
  ridesCount: number | null;
  onlineMinutes: number | null;
  drivingMinutes: number | null;
  startedTime: string | null;
  endedTime: string | null;
  app: string | null;
  date: string | null;
  confidence: number;
  photosUnusable: number[];
}

/** Préremplissage du formulaire à partir de la lecture : seuls les champs lus sont proposés, le chauffeur confirme. */
export function prefillFromReading(reading: PerformanceReading): PerformancePrefill {
  const c = reading.confidence;
  return {
    ridesCents: reading.ridesCents,
    tipsCents: reading.tipsCents,
    promotionsCents: reading.promotionsCents,
    ridesCount: reading.ridesCount,
    onlineMinutes: reading.onlineMinutes,
    drivingMinutes: reading.drivingMinutes,
    startedTime: reading.startedAt,
    endedTime: reading.endedAt,
    app: reading.app?.trim() || null,
    date: reading.date,
    confidence: Math.round(((c.amounts + c.counts + c.times) / 3) * 100) / 100,
    photosUnusable: [...new Set(reading.photosUnusable)].sort((a, b) => a - b),
  };
}
