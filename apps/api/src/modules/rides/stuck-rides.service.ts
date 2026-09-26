/**
 * Surveillance des courses figées (prompt 15, tâche 7) : une course restée trop longtemps dans un état intermédiaire
 * (chauffeur arrivé sans départ ni absence déclarée, en route ou en course anormalement longtemps, réservation attribuée
 * dont l'heure est passée sans départ, recherche de chauffeur qui dure) déclenche une alerte à l'exploitation, une seule
 * fois par course et par état (signal `stuck_alert` du journal). Les seuils sont des réglages ; rien n'est modifié
 * automatiquement : l'opérateur décide (réattribution, annulation, appel).
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from './notifications-outbox.js';

export interface StuckRide {
  rideId: string;
  publicNumber: string;
  state: string;
  since: string;
  minutes: number;
}

@Injectable()
export class StuckRidesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  /** Courses figées à cet instant (pour My Hub et la passe d'alerte). */
  async find(now = new Date()): Promise<StuckRide[]> {
    const [arrived, enRoute, inProgress, scheduledLate, searching] = await Promise.all([
      this.settings.number('watchdog.arrived_minutes', 30),
      this.settings.number('watchdog.en_route_minutes', 90),
      this.settings.number('watchdog.in_progress_minutes', 240),
      this.settings.number('watchdog.scheduled_late_minutes', 15),
      this.settings.number('watchdog.searching_minutes', 20),
    ]);
    const at = now.toISOString();
    const rows = await this.database.db.execute<{ id: string; public_number: string; state: string; since: string }>(sql`
      SELECT r.id, r.public_number, r.state, (r.state_timestamps->>r.state::text) AS since FROM rides r
      WHERE (r.state = 'arrived' AND (r.state_timestamps->>'arrived')::timestamptz < ${at}::timestamptz - make_interval(mins => ${arrived}))
         OR (r.state = 'en_route' AND (r.state_timestamps->>'en_route')::timestamptz < ${at}::timestamptz - make_interval(mins => ${enRoute}))
         OR (r.state = 'in_progress' AND (r.state_timestamps->>'in_progress')::timestamptz < ${at}::timestamptz - make_interval(mins => ${inProgress}))
         OR (r.state = 'assigned' AND r.requested_at IS NOT NULL AND r.requested_at < ${at}::timestamptz - make_interval(mins => ${scheduledLate}))
         OR (r.state IN ('requested', 'offering') AND COALESCE(r.requested_at, r.created_at) < ${at}::timestamptz - make_interval(mins => ${searching}))
      ORDER BY 4 NULLS LAST
      LIMIT 200`);
    return rows.map((r) => {
      const since = r.since ?? at;
      return { rideId: r.id, publicNumber: r.public_number, state: r.state, since, minutes: Math.max(0, Math.round((now.getTime() - Date.parse(since)) / 60_000)) };
    });
  }

  /** Passe de surveillance : une alerte par course et par état figé. */
  async alert(now = new Date()): Promise<number> {
    let sent = 0;
    for (const ride of await this.find(now)) {
      const marked = await this.database.db.execute<{ id: string }>(sql`
        INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
        SELECT r.id, 'stuck_alert', r.state, r.state, NULL, 'system', ${JSON.stringify({ state: ride.state, minutes: ride.minutes })}::jsonb FROM rides r
        WHERE r.id = ${ride.rideId}::uuid AND r.state::text = ${ride.state}
          AND NOT EXISTS (SELECT 1 FROM ride_events e WHERE e.ride_id = r.id AND e.type = 'stuck_alert' AND e.data->>'state' = ${ride.state})
        RETURNING id`);
      if (!marked.length) continue;
      await this.outbox.queueForStaff('alert.stuck_ride', { rideId: ride.rideId, publicNumber: ride.publicNumber, state: ride.state, minutes: ride.minutes });
      sent += 1;
    }
    if (sent) this.logger.warn({ sent }, 'Courses figées signalées à l\'exploitation');
    return sent;
  }
}
