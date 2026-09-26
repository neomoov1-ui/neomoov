/**
 * Bus d'événements de domaine (prompt 05) : les modules publient (`RideRequested`, `RideAssigned`, `RideCompleted`…)
 * et les étapes suivantes s'abonnent (répartition, paiements, facturation, notifications). Chaque événement de course
 * est aussi journalisé dans `ride_events` par le service des courses. Avec Redis, les événements traversent les
 * processus (API et worker, plusieurs instances) par publication et abonnement ; sans Redis, ils restent locaux.
 * Un abonné qui échoue est journalisé et n'empêche ni les autres abonnés ni la requête.
 */
import { Global, Inject, Injectable, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { REDIS } from '../infra/redis.module.js';
import { APP_LOGGER } from './logger.js';

export interface RideEventPayload {
  rideId: string;
  publicNumber: string;
  clientId: string | null;
  clientUserId: string | null;
  driverId: string | null;
  driverUserId: string | null;
  fromState: string | null;
  toState: string;
  event: string;
  actor: { kind: 'client' | 'driver' | 'operator' | 'system' | 'agent'; userId: string | null };
  data?: Record<string, unknown> | undefined;
  occurredAt: Date;
}

export interface DomainEvents {
  'ride.requested': RideEventPayload;
  'ride.assigned': RideEventPayload;
  'ride.state_changed': RideEventPayload;
  'ride.completed': RideEventPayload & { finalPriceCents: number; waitChargeCents: number };
  'ride.cancelled_by_driver': RideEventPayload & { reason: string };
  'ride.reassign_requested': RideEventPayload;
  'ride.no_show': RideEventPayload & { feeCents: number };
  'ride.cancelled_by_client': RideEventPayload & { feeCents: number };
  'ride.message': { rideId: string; messageId: string; senderKind: string; senderUserId: string | null; body: string; sentAt: Date };
  'ride.sos': { rideId: string; incidentId: string; reportedByUserId: string; coordinates: { lat: number; lng: number } | null };
  'scheduled.reminder': { rideId: string; requestedAt: Date };
  'scheduled.dispatch_due': { rideId: string; requestedAt: Date };
  'scheduled.unconfirmed_alert': { rideId: string; requestedAt: Date; driverId: string | null };
  'driver.presence': { driverId: string; status: 'online' | 'offline' | 'paused'; category: string | null };
  'driver.location': { driverId: string; rideId: string | null; coordinates: { lat: number; lng: number }; headingDegrees: number | null; speedMps: number | null; recordedAt: Date };
  /** Répartition (étape 6) : offres aux chauffeurs, réponses, fin de recherche sans chauffeur, état de la répartition. */
  'offer.sent': { offerId: string; rideId: string; driverId: string; driverUserId: string; wave: number; type: string; expiresAt: Date; proposedTotalCents: number | null };
  'offer.expired': { offerId: string; rideId: string; driverId: string; driverUserId: string; reason: 'timeout' | 'assigned_elsewhere' | 'withdrawn' | 'cancelled' };
  'offer.responded': { offerId: string; rideId: string; driverId: string; response: 'accepted' | 'declined' | 'countered'; proposedTotalCents: number | null };
  'ride.no_driver': RideEventPayload;
  'ride.incident': { rideId: string; incidentId: string; type: string; severity: string; reportedByUserId: string | null };
  'dispatch.updated': { rideId: string; status: string; wave: number; offersSent: number; nextActionAt: Date | null };
  /** Notifications (étape 13) : lignes mises en file, à envoyer. */
  'notification.queued': { ids: string[] };
  /**
   * Message entrant d'un client hors de l'application (WhatsApp, agent vocal, réservation web) ou dans l'application
   * (assistance) : l'agent relation client le prend en charge. `externalId` rend le traitement idempotent.
   */
  'conversation.inbound': { channel: 'whatsapp' | 'voice' | 'web' | 'app'; externalId: string; userId: string | null; phone: string | null; text: string; language: 'fr' | 'en' | null; rideId: string | null; receivedAt: Date };
  /** Règlement (étape 9) : relevé hebdomadaire émis. */
  'statement.issued': { statementId: string; driverId: string; periodStart: string; netCents: number };
  /** Document de chauffeur téléversé, en attente de vérification (agent recrutement, puis humain). */
  'driver.document_uploaded': { documentId: string; driverId: string; type: string };
}

type Handler<K extends keyof DomainEvents> = (payload: DomainEvents[K]) => void | Promise<void>;

const CHANNEL = 'neomoov:events';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Les dates traversent Redis en ISO 8601 et redeviennent des `Date` à l'arrivée. */
function revive(value: unknown): unknown {
  if (typeof value === 'string') return ISO_DATE.test(value) ? new Date(value) : value;
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, revive(v)]));
  return value;
}

@Injectable()
export class DomainEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly handlers = new Map<keyof DomainEvents, Array<Handler<keyof DomainEvents>>>();
  private readonly origin = randomUUID();
  private subscriber: Redis | null = null;
  /** Compteurs du processus (tests, santé). */
  readonly stats = { emitted: 0, receivedRemote: 0, publishFailures: 0 };

  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  async onModuleInit() {
    if (!this.redis) return;
    try {
      this.subscriber = this.redis.duplicate();
      await this.subscriber.connect();
      await this.subscriber.subscribe(CHANNEL);
      this.subscriber.on('message', (_channel: string, message: string) => {
        try {
          const envelope = JSON.parse(message) as { origin: string; name: keyof DomainEvents; payload: unknown };
          if (envelope.origin === this.origin) return;
          this.stats.receivedRemote += 1;
          this.dispatch(envelope.name, revive(envelope.payload) as DomainEvents[keyof DomainEvents]);
        } catch (error) {
          this.logger.error({ err: error }, 'Événement de domaine distant illisible');
        }
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Abonnement Redis aux événements de domaine impossible : événements locaux seulement');
      this.subscriber = null;
    }
  }

  async onModuleDestroy() {
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  on<K extends keyof DomainEvents>(name: K, handler: Handler<K>): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler as Handler<keyof DomainEvents>);
    this.handlers.set(name, list);
    return () => {
      const current = this.handlers.get(name) ?? [];
      this.handlers.set(name, current.filter((h) => h !== (handler as Handler<keyof DomainEvents>)));
    };
  }

  /** Publie aux abonnés locaux sans les attendre, et aux autres processus par Redis quand il existe. */
  emit<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]): void {
    this.stats.emitted += 1;
    this.dispatch(name, payload);
    if (this.redis && this.subscriber) {
      this.redis.publish(CHANNEL, JSON.stringify({ origin: this.origin, name, payload })).catch((error: unknown) => {
        this.stats.publishFailures += 1;
        this.logger.error({ err: error, event: name }, 'Publication Redis d\'un événement de domaine en échec');
      });
    }
  }

  /** Publie et attend les abonnés locaux (tests, tâches du worker). */
  async emitAndWait<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]): Promise<void> {
    this.stats.emitted += 1;
    await Promise.all(
      (this.handlers.get(name) ?? []).map(async (handler) => {
        try {
          await handler(payload as DomainEvents[keyof DomainEvents]);
        } catch (error) {
          this.logger.error({ err: error, event: name }, 'Abonné en échec sur un événement de domaine');
        }
      }),
    );
    if (this.redis && this.subscriber) await this.redis.publish(CHANNEL, JSON.stringify({ origin: this.origin, name, payload })).catch(() => undefined);
  }

  private dispatch<K extends keyof DomainEvents>(name: K, payload: DomainEvents[K]): void {
    for (const handler of this.handlers.get(name) ?? []) {
      try {
        const result = handler(payload as DomainEvents[keyof DomainEvents]);
        if (result instanceof Promise) result.catch((error: unknown) => this.logger.error({ err: error, event: name }, 'Abonné en échec sur un événement de domaine'));
      } catch (error) {
        this.logger.error({ err: error, event: name }, 'Abonné en échec sur un événement de domaine');
      }
    }
  }
}

@Global()
@Module({ providers: [DomainEventsService], exports: [DomainEventsService] })
export class DomainEventsModule {}
