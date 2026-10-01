/**
 * File d'attente des notifications (section 5.14) : chaque événement à notifier est enregistré dans `notifications`
 * avec son gabarit et ses données ; l'envoi (push, texto, courriel, WhatsApp) suit par la file `notifications`
 * (événement `notification.queued`, module des notifications de l'étape 13). Chaque ligne porte l'organisation au nom
 * de laquelle elle part (étape 20) : celle du contexte, sinon celle donnée par l'appelant, sinon celle que la base dérive
 * de la course, du relevé ou de la facture désignés dans `data` (déclencheur de la migration 0022).
 */
import { schema } from '@neomoov/db';
import { channelsFor, type Language, type NotificationChannel } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { organizationIdFor } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';

export interface OutboxMessage {
  recipientUserId?: string | null;
  /** Numéro ou courriel d'un destinataire sans compte (tiers, invité). */
  recipientAddress?: string | null;
  channel?: NotificationChannel;
  template: string;
  language?: Language;
  data?: Record<string, unknown>;
  /** Organisation de la course ou du chauffeur concerné, quand l'appelant la connaît ; le contexte courant a priorité. */
  organizationId?: string | null;
}

@Injectable()
export class NotificationsOutbox {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
  ) {}

  async queue(messages: OutboxMessage | OutboxMessage[]): Promise<void> {
    // Canaux : ceux imposés par l'appelant, sinon la matrice 5.14 (un compte), sinon le texto (tiers sans compte).
    const list = (Array.isArray(messages) ? messages : [messages])
      .filter((m) => m.recipientUserId || m.recipientAddress)
      .flatMap((m) => (m.channel ? [m.channel] : channelsFor(m.template, { hasAccount: Boolean(m.recipientUserId) })).map((channel) => ({ ...m, channel })));
    if (!list.length) return;
    try {
      const rows = await this.database.db.insert(schema.notifications).values(
        list.map((m) => ({
          recipientUserId: m.recipientUserId ?? null,
          recipientAddress: m.recipientAddress ?? null,
          organizationId: organizationIdFor(m.organizationId),
          channel: m.channel ?? 'push',
          template: m.template,
          language: m.language ?? 'fr',
          data: m.data ?? {},
        })),
      ).returning({ id: schema.notifications.id, template: schema.notifications.template });
      this.events.emit('notification.queued', { ids: rows.map((r) => r.id), templates: rows.map((r) => r.template) });
    } catch (error) {
      this.logger.error({ err: error, templates: list.map((m) => m.template) }, 'Notification non mise en file');
    }
  }

  /**
   * Une notification par membre du personnel d'exploitation (alertes opérateur, SOS). Étape 20 : le personnel est lu par la
   * fonction `platform_staff_user_ids` (migration 0023), car `user_roles` est réservée à la plateforme et invisible d'une
   * transaction restreinte ; les avis partent dans le contexte courant, au nom de l'organisation concernée.
   */
  async queueForStaff(template: string, data: Record<string, unknown>, channel?: NotificationChannel): Promise<void> {
    const staff = await this.database.db.execute<{ user_id: string }>(sql`SELECT platform_staff_user_ids(ARRAY['admin', 'operator']) AS user_id`);
    await this.queue([...staff].map((s) => ({ recipientUserId: s.user_id, template, data, ...(channel ? { channel } : {}) })));
  }
}
