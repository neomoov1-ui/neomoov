/**
 * Métriques d'exploitation (prompt 15, tâche 6 ; sections 2.2, 2.7 et 10.4) : courses par état, temps d'attribution
 * (demande vers attribution et vers la première offre, médiane et 95e centile sur 24 h), latences de l'API (instance
 * qui répond, 15 dernières minutes), files, échecs de paiement et erreurs des fournisseurs (disjoncteurs,
 * notifications en erreur). Les mesures en base sont gardées 15 secondes par processus : My Hub les relit souvent.
 */
import { RIDE_STATES, type AdminMetrics, type DurationStats, type RideState } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CircuitBreakers } from '../../common/circuit-breaker.js';
import { HttpMetrics, promLabel } from '../../common/http-metrics.js';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { DB, type Database } from '../../infra/db.module.js';
import { QueueService } from '../../infra/queue.module.js';

/** États d'une course en cours : comptés tels quels ; les autres le sont sur la fenêtre de 24 heures. */
export const CURRENT_RIDE_STATES: readonly RideState[] = ['requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress'];
const WINDOW_HOURS = 24;
const CACHE_MS = 15_000;

type DatabaseMetrics = Pick<AdminMetrics, 'rides' | 'payments'> & { notifications: { total: number; byChannel: Array<{ channel: string; count: number }> } };

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10);

/**
 * Début de la mesure d'une attribution : la demande pour une course immédiate, le début de la répartition (`offering`)
 * pour une planifiée (réservée des heures à l'avance, elle n'entre en répartition qu'une heure avant la prise en charge).
 */
const START_AT = sql.raw(`CASE WHEN r.type = 'scheduled' THEN (r.state_timestamps->>'offering')::timestamptz ELSE (r.state_timestamps->>'requested')::timestamptz END`);

@Injectable()
export class AdminMetricsService {
  private cached: { at: number; value: DatabaseMetrics } | null = null;

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly queues: QueueService,
    private readonly http: HttpMetrics,
    private readonly circuits: CircuitBreakers,
  ) {}

  private get db() {
    return this.database.db;
  }

  async metrics(): Promise<AdminMetrics> {
    const [database, queueStats] = await Promise.all([this.databaseMetrics(), this.queues.stats()]);
    const api = this.http.snapshot();
    const sum = (key: 'waiting' | 'active' | 'failed' | 'dropped') => queueStats.reduce((total, q) => total + (q[key] ?? 0), 0);
    return {
      generatedAt: new Date().toISOString(),
      windowHours: WINDOW_HOURS,
      rides: database.rides,
      api,
      queues: {
        mode: this.queues.mode, waiting: sum('waiting'), active: sum('active'), failed: sum('failed'), dropped: sum('dropped'),
        items: queueStats.map((q) => ({ name: q.name, waiting: q.waiting, active: q.active, failed: q.failed, ...(q.dropped === undefined ? {} : { dropped: q.dropped }) })),
      },
      payments: database.payments,
      providers: { circuits: this.circuits.stats(), notificationErrors: database.notifications.total, notificationErrorsByChannel: database.notifications.byChannel },
    };
  }

  /** Mêmes mesures au format d'exposition Prometheus, avec les histogrammes cumulés des latences de l'API. */
  async prometheus(): Promise<string> {
    const m = await this.metrics();
    const lines: string[] = [];
    const gauge = (name: string, help: string, samples: Array<[labels: string, value: number | null]>) => {
      lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      for (const [labels, value] of samples) if (value !== null) lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
    };
    gauge('neomoov_rides', 'Courses par état (en cours : maintenant ; finaux : 24 dernières heures).', m.rides.byState.map((s) => [`state="${s.state}",window="${s.current ? 'current' : '24h'}"`, s.count]));
    const durations = (name: string, help: string, stats: DurationStats) =>
      gauge(name, help, [['quantile="0.5"', stats.p50], ['quantile="0.95"', stats.p95], ['quantile="1"', stats.max]]);
    durations('neomoov_assignment_seconds', 'Demande (ou début de répartition) vers attribution, 24 dernières heures.', m.rides.assignmentSeconds);
    durations('neomoov_first_offer_seconds', 'Demande (ou début de répartition) vers première offre, 24 dernières heures.', m.rides.firstOfferSeconds);
    gauge('neomoov_queue_jobs', 'Tâches par file et par état.', m.queues.items.flatMap((q) => [
      [`queue="${q.name}",state="waiting"`, q.waiting], [`queue="${q.name}",state="active"`, q.active], [`queue="${q.name}",state="failed"`, q.failed],
    ] as Array<[string, number]>));
    gauge('neomoov_payment_failures_24h', 'Paiements en échec, 24 dernières heures.', [['', m.payments.failed]]);
    gauge('neomoov_notification_errors_24h', 'Notifications en erreur par canal, 24 dernières heures.', m.providers.notificationErrorsByChannel.map((n) => [`channel="${promLabel(n.channel)}"`, n.count]));
    gauge('neomoov_circuit_open', 'Disjoncteur de fournisseur ouvert (1) ou fermé (0).', m.providers.circuits.map((c) => [`name="${promLabel(c.name)}"`, c.state === 'closed' ? 0 : 1]));
    lines.push('# HELP neomoov_circuit_failures_total Échecs d\'appel à un fournisseur depuis le démarrage.', '# TYPE neomoov_circuit_failures_total counter');
    for (const c of m.providers.circuits) lines.push(`neomoov_circuit_failures_total{name="${promLabel(c.name)}"} ${c.totalFailures}`);
    return `${[...lines, this.http.prometheus()].join('\n')}\n`;
  }

  private async databaseMetrics(): Promise<DatabaseMetrics> {
    const ttl = this.env.NODE_ENV === 'test' ? 0 : CACHE_MS;
    if (this.cached && Date.now() - this.cached.at < ttl) return this.cached.value;
    const value = await this.readDatabase();
    this.cached = { at: Date.now(), value };
    return value;
  }

  private async readDatabase(): Promise<DatabaseMetrics> {
    const window = sql.raw(`interval '${WINDOW_HOURS} hours'`);
    const current = sql.join(CURRENT_RIDE_STATES.map((s) => sql`${s}`), sql`, `);
    const [currentStates, finalStates, assignment, firstOffer, payments, notifications] = await Promise.all([
      this.db.execute<{ state: RideState; n: number }>(sql`SELECT state, count(*)::int AS n FROM rides WHERE state IN (${current}) GROUP BY state`),
      this.db.execute<{ state: RideState; n: number }>(sql`SELECT state, count(*)::int AS n FROM rides WHERE state NOT IN (${current}) AND updated_at >= now() - ${window} GROUP BY state`),
      this.db.execute<{ n: number; p50: string | null; p95: string | null; max: string | null }>(sql`
        SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY secs) AS p95, max(secs) AS max
        FROM (
          SELECT EXTRACT(EPOCH FROM ((r.state_timestamps->>'assigned')::timestamptz - ${START_AT}))::float AS secs
          FROM rides r
          WHERE r.state_timestamps->>'assigned' IS NOT NULL AND (r.state_timestamps->>'assigned')::timestamptz >= now() - ${window}
        ) t
        WHERE secs >= 0`),
      this.db.execute<{ n: number; p50: string | null; p95: string | null; max: string | null }>(sql`
        SELECT count(*)::int AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY secs) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY secs) AS p95, max(secs) AS max
        FROM (
          SELECT EXTRACT(EPOCH FROM (f.first_at - s.start_at))::float AS secs
          FROM rides r
          CROSS JOIN LATERAL (SELECT ${START_AT} AS start_at) s
          CROSS JOIN LATERAL (SELECT min(o.created_at) AS first_at FROM ride_offers o WHERE o.ride_id = r.id AND o.created_at >= s.start_at) f
          WHERE r.state_timestamps->>'offering' IS NOT NULL AND (r.state_timestamps->>'offering')::timestamptz >= now() - ${window} AND f.first_at IS NOT NULL
        ) t
        WHERE secs >= 0`),
      this.db.execute<{ code: string; n: number }>(sql`SELECT COALESCE(failure_code, 'unknown') AS code, count(*)::int AS n FROM payments WHERE status = 'failed' AND updated_at >= now() - ${window} GROUP BY 1 ORDER BY n DESC, code`),
      this.db.execute<{ channel: string; n: number }>(sql`SELECT channel::text AS channel, count(*)::int AS n FROM notifications WHERE error IS NOT NULL AND created_at >= now() - ${window} GROUP BY 1 ORDER BY n DESC, channel`),
    ]);
    const counts = new Map<RideState, { count: number; current: boolean }>();
    for (const row of currentStates) counts.set(row.state, { count: Number(row.n), current: true });
    for (const row of finalStates) counts.set(row.state, { count: Number(row.n), current: false });
    const byState = RIDE_STATES.filter((state) => counts.has(state) || CURRENT_RIDE_STATES.includes(state)).map((state) => ({
      state, count: counts.get(state)?.count ?? 0, current: CURRENT_RIDE_STATES.includes(state),
    }));
    const stats = (row: { n: number; p50: string | null; p95: string | null; max: string | null } | undefined): DurationStats => ({
      count: Number(row?.n ?? 0), p50: num(row?.p50), p95: num(row?.p95), max: num(row?.max),
    });
    const paymentRows = [...payments];
    const notificationRows = [...notifications];
    return {
      rides: { byState, assignmentSeconds: stats([...assignment][0]), firstOfferSeconds: stats([...firstOffer][0]) },
      payments: { failed: paymentRows.reduce((total, r) => total + Number(r.n), 0), byCode: paymentRows.slice(0, 10).map((r) => ({ code: r.code, count: Number(r.n) })) },
      notifications: { total: notificationRows.reduce((total, r) => total + Number(r.n), 0), byChannel: notificationRows.map((r) => ({ channel: r.channel, count: Number(r.n) })) },
    };
  }
}
