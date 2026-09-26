/**
 * Métriques d'exploitation (prompt 15, tâche 6 ; sections 2.2 et 2.7) : courses par état, temps d'attribution,
 * latences de l'API, files, échecs de paiement et erreurs des fournisseurs. Servies par `GET /v1/admin/metrics` et
 * affichées dans My Hub ; les mêmes valeurs sont exposées au format Prometheus pour la surveillance externe.
 */
import { z } from 'zod';
import { RIDE_STATES } from '../enums.js';
import { isoDate } from './common.js';

const count = z.number().int().min(0);
const measure = z.number().min(0).nullable();

/** Cibles de la section 2.2 du cahier des charges, rappelées à côté des mesures (elles ne pilotent aucun traitement). */
export const PERFORMANCE_TARGETS = {
  /** Attribution d'une course : première offre à un chauffeur en moins de 3 secondes. */
  firstOfferSeconds: 3,
  /** Latence de l'API au 95e centile, hors services externes. */
  apiP95Ms: 300,
  /** Devis complet avec itinéraire au 95e centile. */
  quoteP95Ms: 800,
} as const;

/** Distribution d'une durée : nombre de mesures, médiane et 95e centile (null sans mesure). */
export const durationStatsSchema = z.object({ count, p50: measure, p95: measure, max: measure });
export type DurationStats = z.infer<typeof durationStatsSchema>;

export const routeLatencySchema = z.object({
  method: z.string(),
  route: z.string(),
  count,
  errors: count,
  p50Ms: measure,
  p95Ms: measure,
  maxMs: measure,
});
export type RouteLatency = z.infer<typeof routeLatencySchema>;

export const circuitMetricsSchema = z.object({
  name: z.string(),
  state: z.enum(['closed', 'open', 'half_open']),
  /** Échecs consécutifs en cours. */
  failures: count,
  /** Échecs depuis le démarrage du processus. */
  totalFailures: count,
  /** Ouvertures du circuit depuis le démarrage du processus. */
  openings: count,
  lastFailureAt: isoDate.nullable(),
});
export type CircuitMetrics = z.infer<typeof circuitMetricsSchema>;

export const adminMetricsSchema = z.object({
  generatedAt: isoDate,
  /** Fenêtre des mesures en base (temps d'attribution, échecs de paiement, notifications en erreur, états finaux). */
  windowHours: z.number().int().positive(),
  rides: z.object({
    /** États en cours (`current`) : nombre actuel ; états finaux : courses arrivées dans cet état pendant la fenêtre. */
    byState: z.array(z.object({ state: z.enum(RIDE_STATES), count, current: z.boolean() })),
    /** Demande (ou début de la répartition d'une planifiée) vers attribution, en secondes. */
    assignmentSeconds: durationStatsSchema,
    /** Demande (ou début de la répartition) vers la première offre envoyée à un chauffeur, en secondes (cible 2.2). */
    firstOfferSeconds: durationStatsSchema,
  }),
  api: z.object({
    /** Instance qui a répondu : chaque instance de l'API mesure ses propres requêtes, en mémoire. */
    instance: z.string(),
    windowSeconds: z.number().int().positive(),
    requests: count,
    errors: count,
    p50Ms: measure,
    p95Ms: measure,
    /** Routes les plus lentes au 95e centile (25 au plus). */
    routes: z.array(routeLatencySchema),
  }),
  queues: z.object({
    mode: z.enum(['redis', 'memory']),
    waiting: count,
    active: count,
    failed: count,
    dropped: count,
    items: z.array(z.object({ name: z.string(), waiting: count, active: count, failed: count, dropped: count.optional() })),
  }),
  payments: z.object({
    failed: count,
    byCode: z.array(z.object({ code: z.string(), count })),
  }),
  providers: z.object({
    circuits: z.array(circuitMetricsSchema),
    notificationErrors: count,
    notificationErrorsByChannel: z.array(z.object({ channel: z.string(), count })),
  }),
});
export type AdminMetrics = z.infer<typeof adminMetricsSchema>;
