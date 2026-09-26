/**
 * Messages entrants hors de l'application (prompt 13, tâches 3 et 11). Texto d'un client sans application qui répond au
 * relais : ajouté à la messagerie de sa course en cours et relayé au chauffeur (le numéro du chauffeur n'est jamais
 * montré, celui du client non plus). Texto sans course en cours, ou message WhatsApp : confié à l'agent relation client
 * par l'événement `conversation.inbound`.
 */
import { schema } from '@neomoov/db';
import { ACTIVE_RIDE_STATES } from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { DomainEventsService } from '../../common/domain-events.js';
import { DB, type Database } from '../../infra/db.module.js';
import { NotificationsOutbox } from '../rides/notifications-outbox.js';

export interface InboundText {
  channel: 'sms' | 'whatsapp';
  from: string;
  text: string;
  externalId: string;
  receivedAt?: Date;
}

@Injectable()
export class InboundMessagesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly events: DomainEventsService,
    private readonly outbox: NotificationsOutbox,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Oriente un message entrant : relais vers le chauffeur d'une course en cours, sinon l'agent relation client. */
  async receive(message: InboundText): Promise<{ routedTo: 'ride' | 'agent'; rideId: string | null }> {
    const text = message.text.trim().slice(0, 2_000);
    const receivedAt = message.receivedAt ?? new Date();
    if (message.channel === 'sms' && text) {
      // Réservation par téléphone (client sans compte) avec un chauffeur en route ou sur place : relais dans la course.
      const [ride] = await this.db
        .select({ id: schema.rides.id, driverId: schema.rides.driverId })
        .from(schema.rides)
        .where(and(eq(schema.rides.guestPhone, message.from), inArray(schema.rides.state, [...ACTIVE_RIDE_STATES]), isNotNull(schema.rides.driverId)))
        .orderBy(desc(schema.rides.updatedAt))
        .limit(1);
      if (ride?.driverId) {
        const [row] = await this.db.insert(schema.rideMessages).values({ rideId: ride.id, senderUserId: null, senderKind: 'client', body: text, channel: 'sms' }).returning();
        this.events.emit('ride.message', { rideId: ride.id, messageId: row!.id, senderKind: 'client', senderUserId: null, body: text, sentAt: row!.sentAt });
        const [driver] = await this.db.select({ userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, ride.driverId)).limit(1);
        if (driver) await this.outbox.queue({ recipientUserId: driver.userId, template: 'ride.message', data: { rideId: ride.id, messageId: row!.id } });
        return { routedTo: 'ride', rideId: ride.id };
      }
    }
    const [user] = await this.db.select({ id: schema.users.id, language: schema.users.language }).from(schema.users).where(eq(schema.users.phone, message.from)).limit(1);
    this.events.emit('conversation.inbound', {
      channel: message.channel, externalId: message.externalId, userId: user?.id ?? null, phone: message.from, text, language: user?.language ?? null, rideId: null, receivedAt,
    });
    return { routedTo: 'agent', rideId: null };
  }
}
