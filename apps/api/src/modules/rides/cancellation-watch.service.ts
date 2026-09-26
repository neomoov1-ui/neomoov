/**
 * Annulations et non-présentations répétées d'un client (section 5.14) : quand un client atteint
 * `alerts.client_cancellations_threshold` annulations ou absences (3 par défaut) sur
 * `alerts.client_cancellations_window_days` jours (7), l'exploitation reçoit une alerte par courriel, une seule fois par
 * fenêtre (marqueur du journal d'audit posé sous verrou : l'API et le worker reçoivent le même événement avec Redis).
 * Rien n'est bloqué automatiquement : l'opérateur décide. Les annulations des chauffeurs relèvent de l'agent qualité.
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DomainEventsService, type RideEventPayload } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from './notifications-outbox.js';

const MARKER = 'alert.client_cancellations';

@Injectable()
export class CancellationWatchService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  onModuleInit() {
    const handle = (p: RideEventPayload) => {
      if (!p.clientId) return;
      this.check(p.clientId, p.publicNumber).catch((error: unknown) => this.logger.warn({ err: error, rideId: p.rideId }, 'Annulations répétées non évaluées'));
    };
    this.events.on('ride.cancelled_by_client', handle);
    this.events.on('ride.no_show', handle);
  }

  /** Compte les annulations et absences du client sur la fenêtre ; renvoie `true` si l'alerte vient d'être envoyée. */
  async check(clientId: string, lastPublicNumber: string, now = new Date()): Promise<boolean> {
    const [threshold, days] = await Promise.all([
      this.settings.number('alerts.client_cancellations_threshold', 3),
      this.settings.number('alerts.client_cancellations_window_days', 7),
    ]);
    const since = new Date(now.getTime() - days * 86_400_000).toISOString();
    const db = this.database.db;
    const [row] = await db.execute<{ cancelled: number; no_show: number }>(sql`
      SELECT count(*) FILTER (WHERE e.type = 'client_cancels')::int AS cancelled, count(*) FILTER (WHERE e.type = 'client_no_show')::int AS no_show
      FROM ride_events e JOIN rides r ON r.id = e.ride_id
      WHERE r.client_id = ${clientId}::uuid AND e.type IN ('client_cancels', 'client_no_show')
        AND e.occurred_at >= ${since}::timestamptz AND e.occurred_at <= ${now.toISOString()}::timestamptz`);
    const cancelled = Number(row?.cancelled ?? 0), noShows = Number(row?.no_show ?? 0);
    if (cancelled + noShows < threshold) return false;
    const marked = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cancellations:${clientId}`}))`);
      const [done] = await tx.execute<{ id: string }>(sql`
        SELECT id FROM audit_log WHERE action = ${MARKER} AND entity = 'clients' AND entity_id = ${clientId}::uuid AND occurred_at >= ${since}::timestamptz LIMIT 1`);
      if (done) return false;
      await tx.insert(schema.auditLog).values({ action: MARKER, entity: 'clients', entityId: clientId, after: { cancelled, noShows, days } });
      return true;
    });
    if (!marked) return false;
    const [client] = await db.execute<{ name: string; phone: string | null }>(sql`
      SELECT trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')) AS name, u.phone FROM clients c JOIN users u ON u.id = c.user_id WHERE c.id = ${clientId}::uuid`);
    await this.outbox.queueForStaff('alert.client_cancellations', { clientId, clientName: client?.name ?? '', clientPhone: client?.phone ?? null, cancelled, noShows, days, lastPublicNumber });
    return true;
  }
}
