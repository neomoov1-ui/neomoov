/**
 * File d'attente des notifications (section 5.14) : chaque événement à notifier est enregistré dans `notifications`
 * avec son gabarit et ses données ; l'envoi (push, texto, courriel, WhatsApp) suit par la file `notifications`
 * (événement `notification.queued`, module des notifications de l'étape 13).
 */
import { schema } from '@neomoov/db';
import { channelsFor, type Language, type NotificationChannel } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { DB, type Database } from '../../infra/db.module.js';

export interface OutboxMessage {
  recipientUserId?: string | null;
  /** Numéro ou courriel d'un destinataire sans compte (tiers, invité). */
  recipientAddress?: string | null;
  channel?: NotificationChannel;
  template: string;
  language?: Language;
  data?: Record<string, unknown>;
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

  /** Une notification par membre du personnel d'exploitation (alertes opérateur, SOS). */
  async queueForStaff(template: string, data: Record<string, unknown>, channel?: NotificationChannel): Promise<void> {
    const staff = await this.database.db
      .selectDistinct({ userId: schema.userRoles.userId })
      .from(schema.userRoles)
      .where(inArray(schema.userRoles.role, ['admin', 'operator']));
    await this.queue(staff.map((s) => ({ recipientUserId: s.userId, template, data, ...(channel ? { channel } : {}) })));
  }
}
