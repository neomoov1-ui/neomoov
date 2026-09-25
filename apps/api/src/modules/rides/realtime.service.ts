/**
 * Diffusion temps réel (section 7.3) : les événements de domaine (locaux ou reçus des autres processus par Redis)
 * sont relayés aux espaces Socket.IO `/client` (course suivie), `/driver` (chauffeur concerné) et `/admin` (tout).
 * Les positions d'un chauffeur ne sont envoyées qu'au client de sa course en cours et à My Hub. À une réattribution,
 * l'ancien chauffeur quitte la salle de la course.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import type { Logger } from 'pino';
import { DomainEventsService } from '../../common/domain-events.js';
import { APP_LOGGER } from '../../common/logger.js';
import { RidesService } from './rides.service.js';

export type RealtimeSpace = 'client' | 'driver' | 'admin';

@Injectable()
export class RealtimeService implements OnModuleInit {
  private readonly spaces = new Map<RealtimeSpace, Namespace>();
  /** Compteurs du processus (tests, santé). */
  readonly emitted = { rideUpdated: 0, driverLocation: 0, message: 0, alert: 0, presence: 0 };

  constructor(
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly events: DomainEventsService,
    private readonly rides: RidesService,
  ) {}

  attach(space: RealtimeSpace, namespace: Namespace): void {
    this.spaces.set(space, namespace);
  }

  space(name: RealtimeSpace): Namespace | undefined {
    return this.spaces.get(name);
  }

  onModuleInit() {
    this.events.on('ride.state_changed', async (payload) => {
      if (!this.spaces.size) return;
      const view = await this.rides.viewById(payload.rideId).catch(() => null);
      if (!view) return;
      this.emitted.rideUpdated += 1;
      const room = `ride:${payload.rideId}`;
      this.spaces.get('client')?.to(room).emit('ride.updated', view);
      const driverSpace = this.spaces.get('driver');
      if (driverSpace) {
        driverSpace.to(room).emit('ride.updated', view);
        if (payload.driverId) driverSpace.to(`driver:${payload.driverId}`).emit('ride.updated', view);
        const previous = (payload.data as { previousDriverId?: string } | undefined)?.previousDriverId;
        if (previous) {
          // L'ancien chauffeur reçoit la dernière mise à jour puis quitte la course : plus de messages ni de positions.
          driverSpace.to(`driver:${previous}`).emit('ride.updated', view);
          driverSpace.in(`driver:${previous}`).socketsLeave(room);
        }
      }
      this.spaces.get('admin')?.to('admin').emit('ride.updated', view);
    });
    this.events.on('driver.location', (payload) => {
      this.emitted.driverLocation += 1;
      const event = { rideId: payload.rideId, driverId: payload.driverId, coordinates: payload.coordinates, headingDegrees: payload.headingDegrees, speedMps: payload.speedMps, recordedAt: payload.recordedAt.toISOString() };
      if (payload.rideId) this.spaces.get('client')?.to(`ride:${payload.rideId}`).emit('driver.location', event);
      this.spaces.get('admin')?.to('admin').emit('driver.location', event);
    });
    this.events.on('ride.message', (payload) => {
      this.emitted.message += 1;
      const event = { id: payload.messageId, rideId: payload.rideId, senderKind: payload.senderKind, body: payload.body, sentAt: payload.sentAt.toISOString() };
      this.spaces.get('client')?.to(`ride:${payload.rideId}`).emit('message.received', event);
      this.spaces.get('driver')?.to(`ride:${payload.rideId}`).emit('message.received', event);
    });
    this.events.on('ride.sos', (payload) => {
      this.emitted.alert += 1;
      this.spaces.get('admin')?.to('admin').emit('alert.new', { type: 'sos', severity: 'critical', rideId: payload.rideId, incidentId: payload.incidentId, coordinates: payload.coordinates, at: new Date().toISOString() });
    });
    this.events.on('scheduled.unconfirmed_alert', (payload) => {
      this.emitted.alert += 1;
      this.spaces.get('admin')?.to('admin').emit('alert.new', { type: 'scheduled_unconfirmed', severity: 'high', rideId: payload.rideId, requestedAt: payload.requestedAt.toISOString(), driverId: payload.driverId, at: new Date().toISOString() });
    });
    this.events.on('driver.presence', (payload) => {
      this.emitted.presence += 1;
      this.spaces.get('admin')?.to('admin').emit('driver.presence', { driverId: payload.driverId, status: payload.status, category: payload.category, at: new Date().toISOString() });
    });
    this.logger.debug('Diffusion temps réel prête');
  }
}
