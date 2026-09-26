/**
 * SOS (section 5.14) : en plus du push et du texto à l'exploitation, le fondateur est appelé par l'agent vocal
 * (assistant d'alerte Vapi). Un seul appel par incident, même quand plusieurs processus reçoivent l'événement ; sans
 * numéro ou sans assistant configurés (`alerts.founder_phone`, `voice.sos_assistant_id`), rien n'est tenté.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { VOICE_PROVIDER, type VoiceProvider } from '../../adapters/types.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';

@Injectable()
export class SosCallService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(VOICE_PROVIDER) private readonly voice: VoiceProvider,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit() {
    this.events.on('ride.sos', (p) => {
      this.call(p.rideId, p.incidentId).catch((error: unknown) => this.logger.error({ err: error, incidentId: p.incidentId }, 'Appel SOS au fondateur impossible'));
    });
  }

  /** Appelle le fondateur pour cet incident ; renvoie l'identifiant de l'appel, ou `null` s'il n'a pas lieu. */
  async call(rideId: string, incidentId: string): Promise<string | null> {
    const [phone, assistantId] = await Promise.all([this.settings.string('alerts.founder_phone', ''), this.settings.string('voice.sos_assistant_id', '')]);
    if (!phone || !assistantId) return null;
    // Un seul appel par incident : le premier processus qui inscrit le signal au journal de la course appelle.
    const rows = await this.database.db.execute<{ id: string }>(sql`
      INSERT INTO ride_events (ride_id, type, from_state, to_state, actor_user_id, actor_kind, data)
      SELECT r.id, 'sos_call', r.state, r.state, NULL, 'system', ${JSON.stringify({ incidentId })}::jsonb FROM rides r
      WHERE r.id = ${rideId}::uuid AND NOT EXISTS (SELECT 1 FROM ride_events e WHERE e.ride_id = r.id AND e.type = 'sos_call' AND e.data->>'incidentId' = ${incidentId})
      RETURNING id`);
    if (!rows.length) return null;
    const { callId } = await this.voice.startOutboundCall({ to: phone, assistantId, metadata: { rideId, incidentId } });
    return callId;
  }
}
