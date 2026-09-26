/**
 * « Chauffeur en approche » (section 5.14) : quand le chauffeur en route arrive à moins de `notifications.approach_meters`
 * (700 m, environ 2 minutes en ville) du point de départ, le client est prévenu une seule fois (push, texto pour un
 * client sans application, et au passager d'un tiers). Les positions arrivent toutes les 3 à 5 secondes : le point de départ de la course est gardé
 * en mémoire, et l'envoi unique est garanti en base (verrou par course, signal `driver_approaching` du journal), même
 * quand plusieurs processus reçoivent la même position.
 */
import { schema } from '@neomoov/db';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { GeoPoint } from '../../adapters/types.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { haversineMeters } from '../../common/geo.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from './notifications-outbox.js';
import { parseGeoPoint } from './ride-view.js';
import { RidesService } from './rides.service.js';

interface Watched {
  pickup: GeoPoint | null;
  /** Course en route vers le client : la seule phase où l'approche compte. */
  enRoute: boolean;
  /** Client prévenu : plus rien à faire pour cette course. */
  notified: boolean;
  loadedAt: number;
}

const CACHE_MS = 60_000;
const CACHE_MAX = 5_000;

@Injectable()
export class ApproachNotifierService implements OnModuleInit {
  private readonly watched = new Map<string, Watched>();

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly settings: SettingsService,
    private readonly rides: RidesService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  onModuleInit() {
    this.events.on('driver.location', (p) => {
      if (!p.rideId) return;
      this.onPosition(p.rideId, p.coordinates).catch((error: unknown) => this.logger.warn({ err: error, rideId: p.rideId }, 'Approche du chauffeur non évaluée'));
    });
  }

  /** Position d'un chauffeur en course ; renvoie `true` si le client vient d'être prévenu. */
  async onPosition(rideId: string, position: GeoPoint, now = Date.now()): Promise<boolean> {
    let entry = this.watched.get(rideId);
    // Relue au plus toutes les minutes tant que le client n'est pas prévenu : la course peut passer « en route » entre-temps.
    if (!entry || (!entry.notified && now - entry.loadedAt > CACHE_MS)) {
      const [ride] = await this.database.db.select({ state: schema.rides.state, origin: sql<string>`ST_AsGeoJSON(${schema.rides.originPosition})` }).from(schema.rides).where(eq(schema.rides.id, rideId)).limit(1);
      entry = { pickup: ride?.origin ? parseGeoPoint(ride.origin) : null, enRoute: ride?.state === 'en_route', notified: false, loadedAt: now };
      if (this.watched.size >= CACHE_MAX) this.watched.clear();
      this.watched.set(rideId, entry);
    }
    if (entry.notified || !entry.enRoute || !entry.pickup) return false;
    const threshold = await this.settings.number('notifications.approach_meters', 700);
    if (haversineMeters(position, entry.pickup) > threshold) return false;
    entry.notified = true;
    const notified = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`approach:${rideId}`}))`);
      const rows = await tx.execute<{ id: string }>(sql`
        INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
        SELECT r.id, 'driver_approaching', r.state, r.state, NULL, 'system', ${JSON.stringify({ thresholdMeters: threshold })}::jsonb FROM rides r
        WHERE r.id = ${rideId}::uuid AND r.state = 'en_route' AND NOT EXISTS (SELECT 1 FROM ride_events e WHERE e.ride_id = r.id AND e.type = 'driver_approaching')
        RETURNING id`);
      return rows.length > 0;
    });
    if (!notified) return false;
    const ride = await this.rides.getRide(rideId);
    const recipient = await this.rides.recipientOf(ride);
    await this.outbox.queue({ ...recipient, template: 'ride.driver_approaching', data: { rideId, publicNumber: ride.publicNumber } });
    await this.rides.notifyPassenger(ride, 'ride.passenger_approaching', recipient.language);
    return true;
  }
}
