/**
 * Latences de l'API (prompt 15, tâche 6 ; cible de la section 2.2 : moins de 300 ms au 95e centile) : un histogramme
 * en mémoire par route (motif de la route, jamais l'adresse réelle, pour borner le nombre de séries), sur une fenêtre
 * glissante de 15 minutes pour My Hub, et cumulé depuis le démarrage pour Prometheus. Chaque instance de l'API mesure
 * ses propres requêtes.
 */
import { Global, Injectable, Module } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { hostname } from 'node:os';

/** Bornes supérieures des seaux, en millisecondes (le dernier seau, sans borne, va jusqu'au maximum observé). */
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 200, 300, 500, 800, 1_000, 2_000, 5_000, 10_000] as const;

const round1 = (value: number) => Math.round(value * 10) / 10;

export class LatencyHistogram {
  readonly counts: number[] = new Array<number>(LATENCY_BUCKETS_MS.length + 1).fill(0);
  count = 0;
  errors = 0;
  sumMs = 0;
  maxMs = 0;

  record(ms: number, error = false): void {
    const index = LATENCY_BUCKETS_MS.findIndex((bound) => ms <= bound);
    this.counts[index < 0 ? LATENCY_BUCKETS_MS.length : index]! += 1;
    this.count += 1;
    this.sumMs += ms;
    if (ms > this.maxMs) this.maxMs = ms;
    if (error) this.errors += 1;
  }

  add(other: LatencyHistogram): void {
    other.counts.forEach((n, i) => {
      this.counts[i]! += n;
    });
    this.count += other.count;
    this.errors += other.errors;
    this.sumMs += other.sumMs;
    this.maxMs = Math.max(this.maxMs, other.maxMs);
  }

  /**
   * Centile estimé par interpolation linéaire dans son seau (comme `histogram_quantile` de Prometheus), jamais au-delà
   * du maximum observé ; null sans mesure.
   */
  percentile(q: number): number | null {
    if (!this.count) return null;
    const rank = q * this.count;
    let cumulative = 0;
    for (let i = 0; i < this.counts.length; i += 1) {
      const inBucket = this.counts[i]!;
      if (inBucket && cumulative + inBucket >= rank) {
        const lower = i === 0 ? 0 : LATENCY_BUCKETS_MS[i - 1]!;
        const upper = i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i]! : this.maxMs;
        return round1(Math.min(lower + (upper - lower) * ((rank - cumulative) / inBucket), this.maxMs));
      }
      cumulative += inBucket;
    }
    return round1(this.maxMs);
  }
}

interface Series {
  method: string;
  route: string;
  histogram: LatencyHistogram;
}

export interface LatencySnapshot {
  instance: string;
  windowSeconds: number;
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  routes: Array<{ method: string; route: string; count: number; errors: number; p50Ms: number | null; p95Ms: number | null; maxMs: number | null }>;
}

const SLOT_MS = 60_000;
const SLOTS = 15;

/** Échappe une valeur d'étiquette Prometheus. */
export function promLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

@Injectable()
export class HttpMetrics {
  /** Horloge (remplacée dans les tests). */
  now: () => number = Date.now;
  readonly instance = `${hostname()}:${process.pid}`;
  private readonly slots: Array<{ start: number; series: Map<string, Series> }> = [];
  private readonly cumulative = new Map<string, Series>();

  record(method: string, route: string, status: number, ms: number): void {
    const error = status >= 500;
    this.series(this.cumulative, method, route).histogram.record(ms, error);
    this.series(this.currentSlot().series, method, route).histogram.record(ms, error);
  }

  /** Fenêtre glissante de 15 minutes : total, et les `limit` routes les plus lentes au 95e centile. */
  snapshot(limit = 25): LatencySnapshot {
    const oldest = this.slotStart() - (SLOTS - 1) * SLOT_MS;
    const merged = new Map<string, Series>();
    const total = new LatencyHistogram();
    for (const slot of this.slots) {
      if (slot.start < oldest) continue;
      for (const s of slot.series.values()) {
        this.series(merged, s.method, s.route).histogram.add(s.histogram);
        total.add(s.histogram);
      }
    }
    const routes = [...merged.values()]
      .map(({ method, route, histogram: h }) => ({ method, route, count: h.count, errors: h.errors, p50Ms: h.percentile(0.5), p95Ms: h.percentile(0.95), maxMs: round1(h.maxMs) }))
      .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0) || b.count - a.count)
      .slice(0, limit);
    return { instance: this.instance, windowSeconds: (SLOTS * SLOT_MS) / 1000, requests: total.count, errors: total.errors, p50Ms: total.percentile(0.5), p95Ms: total.percentile(0.95), routes };
  }

  /** Histogrammes cumulés au format d'exposition Prometheus (secondes). */
  prometheus(): string {
    const name = 'neomoov_http_request_duration_seconds';
    const lines = [`# HELP ${name} Durée des requêtes HTTP de l'API, par route.`, `# TYPE ${name} histogram`];
    for (const { method, route, histogram: h } of this.cumulative.values()) {
      const labels = `method="${promLabel(method)}",route="${promLabel(route)}"`;
      let cumulative = 0;
      LATENCY_BUCKETS_MS.forEach((bound, i) => {
        cumulative += h.counts[i]!;
        lines.push(`${name}_bucket{${labels},le="${bound / 1000}"} ${cumulative}`);
      });
      lines.push(`${name}_bucket{${labels},le="+Inf"} ${h.count}`, `${name}_sum{${labels}} ${h.sumMs / 1000}`, `${name}_count{${labels}} ${h.count}`);
    }
    const errors = 'neomoov_http_server_errors_total';
    lines.push(`# HELP ${errors} Réponses 5xx de l'API, par route.`, `# TYPE ${errors} counter`);
    for (const { method, route, histogram: h } of this.cumulative.values()) lines.push(`${errors}{method="${promLabel(method)}",route="${promLabel(route)}"} ${h.errors}`);
    return lines.join('\n');
  }

  private slotStart(): number {
    return Math.floor(this.now() / SLOT_MS) * SLOT_MS;
  }

  private currentSlot() {
    const start = this.slotStart();
    let slot = this.slots[this.slots.length - 1];
    if (!slot || slot.start !== start) {
      slot = { start, series: new Map() };
      this.slots.push(slot);
      while (this.slots.length && this.slots[0]!.start < start - (SLOTS - 1) * SLOT_MS) this.slots.shift();
    }
    return slot;
  }

  private series(map: Map<string, Series>, method: string, route: string): Series {
    const key = `${method} ${route}`;
    let s = map.get(key);
    if (!s) {
      s = { method, route, histogram: new LatencyHistogram() };
      map.set(key, s);
    }
    return s;
  }
}

/** Motif de la route servie (`/v1/admin/rides/:id`), ou `unmatched` (404) : jamais l'adresse réelle. */
export function routePattern(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' ? `${req.baseUrl ?? ''}${path}` : 'unmatched';
}

/** Mesure chaque requête terminée (les requêtes CORS préalables `OPTIONS` sont ignorées). */
export function httpMetricsMiddleware(metrics: HttpMetrics) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS') return next();
    const started = performance.now();
    res.once('finish', () => metrics.record(req.method, routePattern(req), res.statusCode, performance.now() - started));
    next();
  };
}

@Global()
@Module({ providers: [HttpMetrics], exports: [HttpMetrics] })
export class HttpMetricsModule {}
