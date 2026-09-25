/**
 * Espaces Socket.IO (section 7.3) : `/client` (suivi d'une course), `/driver` (statut, positions, courses), `/admin`
 * (tout). Le jeton d'accès est vérifié dans un intergiciel d'espace : la connexion n'aboutit qu'une fois l'acteur
 * résolu (le client reçoit `connect_error` avec le code sinon), et un message émis dès `connect` est déjà authentifié.
 * Chaque message est validé par Zod et acquitté `{ ok, … }`. Les origines CORS viennent de l'adaptateur (config).
 */
import { driverStatusSchema, locationUpdateSchema, uuid } from '@neomoov/domain';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, type OnGatewayConnection, type OnGatewayInit } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import type { ZodType } from 'zod';
import { AppError } from '../../common/app-error.js';
import type { UserActor } from '../auth/actor.js';
import { PresenceService } from './presence.service.js';
import { RealtimeService } from './realtime.service.js';
import { RidesService } from './rides.service.js';
import { SocketAuthService } from './socket-auth.service.js';

type Ack = { ok: true; [key: string]: unknown } | { ok: false; code: string; message: string; details?: unknown };

function fail(error: unknown): Ack {
  if (error instanceof AppError) return { ok: false, code: error.code, message: error.message, details: error.details };
  const zod = error as { issues?: Array<{ path: PropertyKey[]; message: string }> };
  if (Array.isArray(zod?.issues)) return { ok: false, code: 'VALIDATION_ERROR', message: zod.issues.map((i) => `${i.path.join('.')} : ${i.message}`).join(' ; ') };
  return { ok: false, code: 'INTERNAL_ERROR', message: 'Erreur interne' };
}

function parse<T>(schema: ZodType<T>, body: unknown): T {
  return schema.parse(body ?? {});
}

interface SocketData {
  actor?: UserActor;
  driverId?: string;
}

const data = (socket: Socket): SocketData => socket.data as SocketData;
const unauthenticated: Ack = { ok: false, code: 'UNAUTHENTICATED', message: 'Jeton d\'accès requis' };

@WebSocketGateway({ namespace: '/client' })
export class ClientGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly auth: SocketAuthService,
    private readonly rides: RidesService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach('client', server);
    server.use(async (socket, next) => {
      const actor = await this.auth.authenticate(socket);
      if (!actor) return next(new Error('UNAUTHENTICATED'));
      data(socket).actor = actor;
      next();
    });
  }

  handleConnection(): void {
    // L'acteur est posé par l'intergiciel ; rien d'autre à faire à la connexion.
  }

  @SubscribeMessage('ride.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { rideId?: string }): Promise<Ack> {
    const actor = data(socket).actor;
    if (!actor) return unauthenticated;
    try {
      const rideId = uuid.parse(body?.rideId);
      const ride = await this.rides.getRide(rideId);
      await this.rides.participantKind(ride, actor);
      await socket.join(`ride:${rideId}`);
      return { ok: true, ride: await this.rides.view(ride) };
    } catch (error) {
      return fail(error);
    }
  }

  @SubscribeMessage('ride.unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { rideId?: string }): Promise<Ack> {
    if (typeof body?.rideId === 'string') await socket.leave(`ride:${body.rideId}`);
    return { ok: true };
  }
}

@WebSocketGateway({ namespace: '/driver' })
export class DriverGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly auth: SocketAuthService,
    private readonly rides: RidesService,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach('driver', server);
    server.use(async (socket, next) => {
      const actor = await this.auth.authenticate(socket);
      if (!actor) return next(new Error('UNAUTHENTICATED'));
      const driverId = await this.auth.driverIdOf(actor.userId);
      if (!driverId) return next(new Error('DRIVER_PROFILE_REQUIRED'));
      data(socket).actor = actor;
      data(socket).driverId = driverId;
      next();
    });
  }

  async handleConnection(socket: Socket) {
    const driverId = data(socket).driverId;
    if (driverId) await socket.join(`driver:${driverId}`);
  }

  @SubscribeMessage('status.update')
  async status(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const actor = data(socket).actor;
    if (!actor) return unauthenticated;
    try {
      const input = parse(driverStatusSchema, body);
      return { ok: true, status: await this.presence.setStatus(actor.userId, input) };
    } catch (error) {
      return fail(error);
    }
  }

  @SubscribeMessage('location.update')
  async location(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const driverId = data(socket).driverId;
    if (!driverId) return unauthenticated;
    try {
      const input = parse(locationUpdateSchema, body);
      const result = await this.presence.recordForDriver(driverId, input);
      return { ok: true, ...result };
    } catch (error) {
      return fail(error);
    }
  }

  @SubscribeMessage('ride.subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { rideId?: string }): Promise<Ack> {
    const actor = data(socket).actor;
    if (!actor) return unauthenticated;
    try {
      const rideId = uuid.parse(body?.rideId);
      const ride = await this.rides.getRide(rideId);
      const kind = await this.rides.participantKind(ride, actor);
      if (kind !== 'driver') throw AppError.forbidden('NOT_RIDE_DRIVER', 'Cette course n\'est pas attribuée à ce chauffeur');
      await socket.join(`ride:${rideId}`);
      return { ok: true, ride: await this.rides.view(ride) };
    } catch (error) {
      return fail(error);
    }
  }
}

@WebSocketGateway({ namespace: '/admin' })
export class AdminGateway implements OnGatewayInit, OnGatewayConnection {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly auth: SocketAuthService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach('admin', server);
    server.use(async (socket, next) => {
      const actor = await this.auth.authenticate(socket);
      if (!actor) return next(new Error('UNAUTHENTICATED'));
      if (!this.auth.isStaff(actor)) return next(new Error('FORBIDDEN_ROLE'));
      data(socket).actor = actor;
      next();
    });
  }

  async handleConnection(socket: Socket) {
    await socket.join('admin');
  }

  /** Zone visible de la carte My Hub : mémorisée sur le socket pour le filtrage des positions (écran à l'étape 12). */
  @SubscribeMessage('map.subscribe')
  subscribeMap(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Ack {
    (socket.data as { mapBounds?: unknown }).mapBounds = body ?? null;
    return { ok: true };
  }
}
