/**
 * Agent qualité (cahier des charges 5.11, prompt 14 tâche 2) : chaque jour, pour les chauffeurs actifs ou restreints,
 * note glissante des clients sur les 50 dernières courses notées, annulations tardives sur 7 jours (après le départ du
 * chauffeur, ou sur une course immédiate, ou à moins de `quality.late_cancellation_minutes` d'une planifiée) et incidents
 * graves (gravité élevée ou critique, signalés par d'autres que le chauffeur) sur `quality.incident_window_days` ; la
 * règle du domaine (`qualityProposal`) choisit la sanction, l'outil `proposeSanction` la soumet à la file d'approbation
 * (ou l'applique en mode automatique). Aucune proposition si une sanction au moins aussi forte est en cours ou en attente,
 * ni d'avertissement répété avant `quality.warning_cooldown_days`. Enchaînement déterministe, sans appel au modèle : la
 * règle et ses chiffres suffisent à la personne qui valide. La même passe rend actif un chauffeur dont la restriction
 * ou la suspension de qualité est échue.
 */
import { schema } from '@neomoov/db';
import { localClock, parseQualityThresholds, qualityProposal, qualityReasonText, sanctionRank, type QualityMetrics, type QualityProposal, type SanctionType } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, like, lte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';
import { AgentRunnerService, type AgentExecution } from './agent-runner.service.js';
import { AgentToolsService, QUALITY_SANCTION_PREFIX } from './agent-tools.service.js';
import { statusAfterSuspension } from '../drivers/driver-status.js';

export const QUALITY = 'quality';

export interface QualityReview {
  driverId: string;
  publicNumber: string;
  name: string | null;
  status: string;
  metrics: QualityMetrics;
  proposal: QualityProposal | null;
  /** Sanction la plus forte en cours (ou proposée, en attente) : une proposition plus faible ou égale est inutile. */
  covered: SanctionType | null;
  pendingApproval: boolean;
}

type Row = {
  driver_id: string;
  public_number: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  rating_avg: number | null;
  rating_n: number;
  late_n: number;
  incidents_n: number;
  active_rank: number;
  recent_warning: boolean;
  pending_rank: number;
};

@Injectable()
export class QualityAgent {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly runner: AgentRunnerService,
    private readonly tools: AgentToolsService,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Mesures et proposition de chaque chauffeur actif ou restreint (My Hub et passe quotidienne). */
  async review(now = new Date(), onlyDriverIds?: string[]): Promise<QualityReview[]> {
    const [raw, lateMinutes, incidentDays, cooldownDays] = await Promise.all([
      this.settings.get<unknown>('quality.thresholds', null),
      this.settings.number('quality.late_cancellation_minutes', 60),
      this.settings.number('quality.incident_window_days', 90),
      this.settings.number('quality.warning_cooldown_days', 30),
    ]);
    const thresholds = parseQualityThresholds(raw);
    const at = now.toISOString();
    const only = onlyDriverIds?.length ? sql`AND d.id IN ${onlyDriverIds}` : sql``;
    const rows = await this.db.execute<Row>(sql`
      WITH d AS (
        SELECT d.id, d.user_id, d.public_number, d.status FROM drivers d WHERE d.status IN ('active', 'restricted') ${only}
      ), ranked AS (
        SELECT r.driver_id, rr.score, row_number() OVER (PARTITION BY r.driver_id ORDER BY rr.created_at DESC) AS k
        FROM ride_ratings rr JOIN rides r ON r.id = rr.ride_id
        WHERE rr.author_kind = 'client' AND r.driver_id IN (SELECT id FROM d)
      ), ratings AS (
        SELECT driver_id, avg(score)::float AS rating_avg, count(*)::int AS rating_n FROM ranked WHERE k <= 50 GROUP BY driver_id
      ), late AS (
        SELECT d.id AS driver_id, count(*)::int AS late_n
        FROM ride_events e JOIN rides r ON r.id = e.ride_id JOIN d ON d.user_id = e.actor_user_id
        WHERE e.type = 'driver_cancels' AND e.occurred_at >= ${at}::timestamptz - interval '7 days' AND e.occurred_at <= ${at}::timestamptz
          AND (e.from_state IN ('en_route', 'arrived') OR r.type = 'immediate'
            OR (r.requested_at IS NOT NULL AND r.requested_at - e.occurred_at < make_interval(mins => ${lateMinutes})))
        GROUP BY d.id
      ), serious AS (
        SELECT r.driver_id, count(*)::int AS incidents_n
        FROM incidents i JOIN rides r ON r.id = i.ride_id
        WHERE r.driver_id IN (SELECT id FROM d) AND i.severity IN ('high', 'critical') AND i.type IN ('complaint', 'accident', 'sos')
          AND i.reported_by_kind <> 'driver' AND i.created_at >= ${at}::timestamptz - make_interval(days => ${incidentDays})
        GROUP BY r.driver_id
      ), active AS (
        SELECT s.driver_id,
          max(CASE s.type WHEN 'suspension' THEN 3 WHEN 'restriction' THEN 2 ELSE 0 END) FILTER (WHERE s.ends_at IS NULL OR s.ends_at > ${at}::timestamptz) AS active_rank,
          bool_or(s.type = 'warning' AND s.starts_at > ${at}::timestamptz - make_interval(days => ${cooldownDays})) AS recent_warning
        FROM sanctions s WHERE s.driver_id IN (SELECT id FROM d) GROUP BY s.driver_id
      ), pending AS (
        SELECT (a.data->>'driverId')::uuid AS driver_id,
          max(CASE a.data->>'type' WHEN 'suspension' THEN 3 WHEN 'restriction' THEN 2 ELSE 1 END) AS pending_rank
        FROM approvals a WHERE a.proposed_action = 'proposeSanction' AND a.decision = 'pending' GROUP BY 1
      )
      SELECT d.id AS driver_id, d.public_number, u.first_name, u.last_name, d.status,
        ratings.rating_avg, coalesce(ratings.rating_n, 0) AS rating_n, coalesce(late.late_n, 0) AS late_n, coalesce(serious.incidents_n, 0) AS incidents_n,
        coalesce(active.active_rank, 0) AS active_rank, coalesce(active.recent_warning, false) AS recent_warning, coalesce(pending.pending_rank, 0) AS pending_rank
      FROM d JOIN users u ON u.id = d.user_id
      LEFT JOIN ratings ON ratings.driver_id = d.id LEFT JOIN late ON late.driver_id = d.id LEFT JOIN serious ON serious.driver_id = d.id
      LEFT JOIN active ON active.driver_id = d.id LEFT JOIN pending ON pending.driver_id = d.id
      ORDER BY d.public_number`);
    const byRank: Record<number, SanctionType | null> = { 0: null, 1: 'warning', 2: 'restriction', 3: 'suspension' };
    return [...rows].map((r) => {
      const metrics: QualityMetrics = { ratingAverage: r.rating_avg === null ? null : Math.round(Number(r.rating_avg) * 100) / 100, ratingCount: Number(r.rating_n), lateCancellations7d: Number(r.late_n), seriousIncidents: Number(r.incidents_n) };
      // Un avertissement récent vaut couverture pour un nouvel avertissement (pas de répétition quotidienne).
      const coveredRank = Math.max(Number(r.active_rank), Number(r.pending_rank), r.recent_warning ? 1 : 0);
      return {
        driverId: r.driver_id, publicNumber: r.public_number, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || null, status: r.status,
        metrics, proposal: qualityProposal(metrics, thresholds), covered: byRank[coveredRank] ?? null, pendingApproval: Number(r.pending_rank) > 0,
      };
    });
  }

  /** Passe quotidienne (une exécution par jour de Montréal, référence = date) ; `ref` null : passe demandée dans My Hub. */
  async run(now = new Date(), options: { ref?: string | null; onlyDriverIds?: string[] } = {}): Promise<AgentExecution<{ evaluated: number; proposed: number; reinstated: number }>> {
    const tz = await this.settings.string('service.time_zone', 'America/Toronto');
    const date = localClock(now, tz).date;
    const ref = options.ref === undefined ? date : options.ref;
    return this.runner.execute(QUALITY, { name: 'quality.daily', ref, input: { date } }, async (ctx) => {
      const reinstated = await this.expire(now);
      const [raw] = await Promise.all([this.settings.get<unknown>('quality.thresholds', null)]);
      const thresholds = parseQualityThresholds(raw);
      const reviews = await this.review(now, options.onlyDriverIds);
      let proposed = 0;
      for (const r of reviews) {
        if (!r.proposal) continue;
        if (r.covered && sanctionRank(r.covered) >= sanctionRank(r.proposal.type)) continue;
        const result = await this.tools.call(ctx, 'proposeSanction', { driverId: r.driverId, type: r.proposal.type, reasons: r.proposal.reasons, justification: qualityReasonText(r.proposal, r.metrics, thresholds) });
        if (result.ok) proposed += 1;
      }
      return { evaluated: reviews.length, proposed, reinstated };
    });
  }

  /** Restrictions et suspensions de qualité échues : le chauffeur redevient actif s'il n'a plus d'autre sanction en cours. */
  async expire(now = new Date()): Promise<number> {
    const expired = await this.db
      .select({ driverId: schema.sanctions.driverId, type: schema.sanctions.type, userId: schema.drivers.userId, status: schema.drivers.status })
      .from(schema.sanctions)
      .innerJoin(schema.drivers, eq(schema.drivers.id, schema.sanctions.driverId))
      .where(and(like(schema.sanctions.reason, `${QUALITY_SANCTION_PREFIX}%`), lte(schema.sanctions.endsAt, now), sql`${schema.drivers.status} IN ('restricted', 'suspended')`));
    let reinstated = 0;
    for (const e of expired) {
      const wanted = e.type === 'restriction' ? 'restricted' : e.type === 'suspension' ? 'suspended' : null;
      if (!wanted || e.status !== wanted) continue;
      // Statut après la sanction échue : une autre suspension (décision humaine, conformité, sécurité, solde) garde le
      // chauffeur suspendu ; une restriction encore en cours le garde restreint ; sinon actif.
      const next = await statusAfterSuspension(this.db, e.driverId, now);
      if (next === wanted || next === 'suspended') continue;
      const [row] = await this.db.update(schema.drivers).set({ status: next }).where(and(eq(schema.drivers.id, e.driverId), eq(schema.drivers.status, wanted))).returning({ id: schema.drivers.id });
      if (!row) continue;
      reinstated += 1;
      await this.outbox.queue({ recipientUserId: e.userId, template: 'quality.reinstated', data: {} });
      this.audit.record({ action: 'quality.reinstated', entity: 'drivers', entityId: e.driverId, before: { status: wanted }, after: { status: next } });
      this.logger.info({ driverId: e.driverId, status: next }, 'Sanction de qualité échue : chauffeur réintégré');
    }
    return reinstated;
  }
}
