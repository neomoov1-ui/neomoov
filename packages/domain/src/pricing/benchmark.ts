/**
 * Vérification concurrentielle automatique (D33, section 5.1) : fonction pure. Aucune API d'Uber ou de Lyft n'est
 * appelée ; les références viennent des relevés hebdomadaires saisis dans My Hub (`competitor_benchmarks`).
 * Si le prix Neomoov dépasse « référence × (1 − marge) », une ligne « Remise d'alignement » réduit les frais de service
 * jusqu'à 0. Le tarif chauffeur n'est jamais réduit. Sans référence proche, aucun ajustement.
 */
import { localTimeParts, mulDivRound, subtotalForTotalAtMost } from './quote.js';
import type { PricingRules, Quote } from './types.js';

/** Plage horaire d'un relevé : jour de semaine ou fin de semaine, tranche de la journée. */
export const BENCHMARK_TIME_WINDOWS = ['weekday_morning', 'weekday_day', 'weekday_evening', 'weekday_night', 'weekend_day', 'weekend_night'] as const;
export type BenchmarkTimeWindow = (typeof BENCHMARK_TIME_WINDOWS)[number];

export interface CompetitorBenchmark {
  category: string;
  originZone: string;
  destinationZone: string;
  timeWindow: BenchmarkTimeWindow;
  uberPriceCents: number | null;
  lyftPriceCents: number | null;
  observedAt: Date;
  source?: string;
}

export interface BenchmarkContext {
  originZone: string | null | undefined;
  destinationZone: string | null | undefined;
  pickupAt: Date;
  /** Instant du calcul : une référence de plus de `maxAgeDays` jours est ignorée. */
  now: Date;
  timeZone: string;
  marginPpm: number;
  maxAgeDays?: number;
}

export interface BenchmarkResult {
  quote: Quote;
  /** Référence retenue (le concurrent le moins cher), ou null sans référence proche. */
  referenceCents: number | null;
  /** Vrai si le prix Neomoov dépassait le seuil : événement `benchmark_exceeded` à journaliser, même sans marge de remise. */
  exceeded: boolean;
}

/** Tranche horaire de Montréal : matin 6 h à 10 h, journée 10 h à 15 h, soirée 15 h à 19 h, nuit le reste ; fin de semaine jour 6 h à 19 h. */
export function benchmarkTimeWindow(date: Date, timeZone: string): BenchmarkTimeWindow {
  const { weekday, hour } = localTimeParts(date, timeZone);
  const weekend = weekday === 0 || weekday === 6;
  if (weekend) return hour >= 6 && hour < 19 ? 'weekend_day' : 'weekend_night';
  if (hour >= 6 && hour < 10) return 'weekday_morning';
  if (hour >= 10 && hour < 15) return 'weekday_day';
  if (hour >= 15 && hour < 19) return 'weekday_evening';
  return 'weekday_night';
}

/** Référence la plus proche : mêmes zones (dans les deux sens), même plage horaire, même catégorie, la plus récente sous `maxAgeDays`. */
export function findBenchmark(benchmarks: readonly CompetitorBenchmark[], quote: Pick<Quote, 'category'>, context: BenchmarkContext): CompetitorBenchmark | null {
  const { originZone, destinationZone } = context;
  if (!originZone || !destinationZone) return null;
  const window = benchmarkTimeWindow(context.pickupAt, context.timeZone);
  const maxAgeMs = (context.maxAgeDays ?? 14) * 86_400_000;
  let best: CompetitorBenchmark | null = null;
  for (const b of benchmarks) {
    if (b.category !== quote.category || b.timeWindow !== window) continue;
    const sameDirection = b.originZone === originZone && b.destinationZone === destinationZone;
    const reverse = b.originZone === destinationZone && b.destinationZone === originZone;
    if (!sameDirection && !reverse) continue;
    if (context.now.getTime() - b.observedAt.getTime() > maxAgeMs || b.observedAt > context.now) continue;
    if (referenceOf(b) === null) continue;
    if (!best || b.observedAt > best.observedAt) best = b;
  }
  return best;
}

/** Le concurrent le moins cher observé. */
export function referenceOf(benchmark: CompetitorBenchmark): number | null {
  const prices = [benchmark.uberPriceCents, benchmark.lyftPriceCents].filter((p): p is number => typeof p === 'number' && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

export function benchmarkCheck(quote: Quote, benchmarks: readonly CompetitorBenchmark[], rules: PricingRules, context: BenchmarkContext): BenchmarkResult {
  const benchmark = findBenchmark(benchmarks, quote, context);
  const referenceCents = benchmark ? referenceOf(benchmark) : null;
  if (referenceCents === null) return { quote, referenceCents: null, exceeded: false };
  const threshold = mulDivRound(referenceCents, 1_000_000 - context.marginPpm, 1_000_000);
  if (quote.totalCents <= threshold) return { quote, referenceCents, exceeded: false };
  // Réduction du sous-total nécessaire pour ramener le total sous le seuil, bornée par les frais de service restants.
  const needed = quote.subtotalCents - subtotalForTotalAtMost(threshold, rules);
  const discount = Math.max(0, Math.min(quote.serviceFeeCents, needed));
  if (discount === 0) return { quote, referenceCents, exceeded: true };
  const serviceFeeCents = quote.serviceFeeCents - discount;
  const subtotalCents = quote.subtotalCents - discount;
  const gstCents = mulDivRound(subtotalCents, rules.gstRatePpm, 1_000_000);
  const qstCents = mulDivRound(subtotalCents, rules.qstRatePpm, 1_000_000);
  const totalCents = subtotalCents + gstCents + qstCents;
  const creditsAppliedCents = Math.min(quote.creditsAppliedCents, totalCents);
  const adjusted: Quote = {
    ...quote,
    lines: [...quote.lines, { kind: 'benchmark_alignment', code: 'benchmark_alignment', amountCents: -discount }],
    serviceFeeCents,
    alignmentDiscountCents: quote.alignmentDiscountCents + discount,
    subtotalCents,
    gstCents,
    qstCents,
    totalCents,
    creditsAppliedCents,
    amountDueCents: totalCents - creditsAppliedCents,
    maxConsentedCents: totalCents + rules.maxExtraAllowanceCents,
  };
  return { quote: adjusted, referenceCents, exceeded: true };
}
