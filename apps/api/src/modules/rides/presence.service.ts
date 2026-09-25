/**
 * Présence et positions des chauffeurs (prompt 05, tâche 4) : passage en ligne avec vérification des prérequis,
 * dernière position dans `driver_presence` (PostGIS) et dans l'index GEO Redis quand il existe, historique écrit par
 * lots dans `driver_locations` (partitionnée par jour), expiration après `presence.expiry_seconds` sans position, quarts
 * de travail. Un chauffeur en course dont la présence a expiré (coupure réseau) la retrouve à la première position.
 * Les positions ne sont diffusées qu'au client de la course en cours et à My Hub (par les événements de domaine).
 */
import { schema } from '@neomoov/db';
import { ACTIVE_RIDE_STATES, type DriverStatusRequest, type LocationUpdate, type VehicleCategory } from '@neomoov/domain';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { GeoPoint } from '../../adapters/types.js';
import { AppError } from '../../common/app-error.js';
import { DomainEventsService } from '../../common/domain-events.js';
import { haversineMeters } from '../../common/geo.js';
import { APP_LOGGER } from '../../common/logger.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { REDIS } from '../../infra/redis.module.js';
import { parseGeoPoint } from './ride-view.js';

const GEO_KEY = 'presence:geo';

interface BufferedLocation {
  driverId: string;
  position: GeoPoint;
  speedMps: number | null;
  headingDegrees: number | null;
  accuracyMeters: number | null;
  rideId: string | null;
  recordedAt: Date;
}

export interface DriverStatusView {
  status: DriverStatusRequest;
  vehicleId: string | null;
  category: VehicleCategory | null;
  since: string | null;
}

type DriverRow = typeof schema.drivers.$inferSelect;

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private buffer: BufferedLocation[] = [];
  private readonly lastByDriver = new Map<string, { position: GeoPoint; at: number }>();
  private flushTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private partitionsDay = '';
  /** Statistiques du processus (tests de charge, santé). */
  readonly stats = { received: 0, written: 0, ignored: 0, dropped: 0 };

  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(REDIS) private readonly redis: Redis | null,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly settings: SettingsService,
    private readonly events: DomainEventsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  async onModuleInit() {
    const batchMs = await this.settings.number('presence.location_batch_ms', 2000).catch(() => 2000);
    this.flushTimer = setInterval(() => void this.flush().catch((error: unknown) => this.logger.error({ err: error }, 'Écriture des positions en échec')), batchMs);
    this.flushTimer.unref();
    this.sweepTimer = setInterval(() => void this.sweepExpired().catch((error: unknown) => this.logger.error({ err: error }, 'Expiration des présences en échec')), 30_000);
    this.sweepTimer.unref();
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.flush().catch(() => undefined);
  }

  async driverOfUser(userId: string): Promise<DriverRow> {
    const [row] = await this.db.select().from(schema.drivers).where(eq(schema.drivers.userId, userId)).limit(1);
    if (!row) throw AppError.forbidden('DRIVER_PROFILE_REQUIRED', 'Profil chauffeur requis');
    return row;
  }

  /** Prérequis pour passer en ligne (tâche 4) ; liste vide si tout est bon. */
  async eligibility(driver: DriverRow, vehicleId: string | null): Promise<{ reasons: string[]; vehicle: typeof schema.vehicles.$inferSelect | null }> {
    const reasons: string[] = [];
    if (driver.status !== 'active') reasons.push(`driver_status:${driver.status}`);
    const [vehicle] = vehicleId ? await this.db.select().from(schema.vehicles).where(and(eq(schema.vehicles.id, vehicleId), eq(schema.vehicles.driverId, driver.id))).limit(1) : [];
    if (!vehicle) reasons.push('vehicle_missing');
    else if (vehicle.status !== 'active') reasons.push(`vehicle_status:${vehicle.status}`);
    const required = (await this.settings.get<string[]>('drivers.required_documents', ['licence', 'insurance', 'registration'])).filter((d): d is string => typeof d === 'string');
    if (required.length) {
      const today = new Date().toISOString().slice(0, 10);
      const docs = await this.db
        .select({ type: schema.driverDocuments.type })
        .from(schema.driverDocuments)
        .where(and(eq(schema.driverDocuments.driverId, driver.id), eq(schema.driverDocuments.status, 'approved'), or(isNull(schema.driverDocuments.expiresOn), sql`${schema.driverDocuments.expiresOn} >= ${today}`)));
      const approved = new Set(docs.map((d) => d.type as string));
      for (const type of required) if (!approved.has(type)) reasons.push(`document_missing:${type}`);
    }
    if (await this.settings.get<boolean>('drivers.require_active_pack', false)) {
      const [pack] = await this.db.select({ id: schema.packPurchases.id }).from(schema.packPurchases).where(and(eq(schema.packPurchases.driverId, driver.id), eq(schema.packPurchases.status, 'active'))).limit(1);
      if (!pack) reasons.push('pack_required');
    }
    const [balance] = await this.db.select().from(schema.driverBalances).where(eq(schema.driverBalances.driverId, driver.id)).limit(1);
    if (balance?.suspendedForBalanceAt) reasons.push('balance_suspended');
    const [sanction] = await this.db
      .select({ id: schema.sanctions.id })
      .from(schema.sanctions)
      .where(and(eq(schema.sanctions.driverId, driver.id), eq(schema.sanctions.type, 'suspension'), or(isNull(schema.sanctions.endsAt), sql`${schema.sanctions.endsAt} > now()`)))
      .limit(1);
    if (sanction) reasons.push('suspended');
    return { reasons, vehicle: vehicle ?? null };
  }

  /** `status.update` : en ligne (prérequis vérifiés, position requise), en pause (présence gardée, non disponible) ou hors ligne. */
  async setStatus(userId: string, input: { status: DriverStatusRequest; vehicleId?: string | undefined; coordinates?: GeoPoint | undefined }): Promise<DriverStatusView> {
    const driver = await this.driverOfUser(userId);
    const now = new Date();
    if (input.status === 'offline') {
      await this.goOffline(driver.id, now);
      return { status: 'offline', vehicleId: null, category: null, since: null };
    }
    const vehicleId = input.vehicleId ?? driver.currentVehicleId;
    const { reasons, vehicle } = await this.eligibility(driver, vehicleId);
    if (reasons.length) throw AppError.conflict('DRIVER_NOT_ELIGIBLE', 'Prérequis non remplis pour passer en ligne', { reasons });
    const position = input.coordinates ?? (await this.positionOf(driver.id));
    if (!position) throw new AppError('POSITION_REQUIRED', 'Une position est requise pour passer en ligne', 400);
    const isAvailable = input.status === 'online';
    await this.upsertPresence(driver.id, position, vehicle!.id, vehicle!.category, isAvailable, now);
    await this.db.update(schema.drivers).set({ isOnline: true, currentVehicleId: vehicle!.id }).where(eq(schema.drivers.id, driver.id));
    if (isAvailable) await this.openShift(driver.id, now);
    this.lastByDriver.set(driver.id, { position, at: now.getTime() });
    this.events.emit('driver.presence', { driverId: driver.id, status: input.status, category: vehicle!.category });
    return { status: input.status, vehicleId: vehicle!.id, category: vehicle!.category, since: now.toISOString() };
  }

  private async upsertPresence(driverId: string, position: GeoPoint, vehicleId: string, category: VehicleCategory, isAvailable: boolean, now: Date, currentRideId: string | null = null): Promise<void> {
    await this.db
      .insert(schema.driverPresence)
      .values({ driverId, position, vehicleId, category, isAvailable, currentRideId })
      .onConflictDoUpdate({ target: schema.driverPresence.driverId, set: { position, vehicleId, category, isAvailable, currentRideId, updatedAt: now } });
    await this.redis?.geoadd(GEO_KEY, position.lng, position.lat, driverId).catch(() => undefined);
  }

  private async goOffline(driverId: string, now: Date): Promise<void> {
    await this.db.delete(schema.driverPresence).where(eq(schema.driverPresence.driverId, driverId));
    await this.db.update(schema.drivers).set({ isOnline: false }).where(eq(schema.drivers.id, driverId));
    await this.closeShift(driverId, now);
    await this.redis?.zrem(GEO_KEY, driverId).catch(() => undefined);
    this.lastByDriver.delete(driverId);
    this.events.emit('driver.presence', { driverId, status: 'offline', category: null });
  }

  async statusOf(userId: string): Promise<DriverStatusView> {
    const driver = await this.driverOfUser(userId);
    const [presence] = await this.db.select({ vehicleId: schema.driverPresence.vehicleId, category: schema.driverPresence.category, isAvailable: schema.driverPresence.isAvailable, updatedAt: schema.driverPresence.updatedAt }).from(schema.driverPresence).where(eq(schema.driverPresence.driverId, driver.id)).limit(1);
    if (!presence) return { status: 'offline', vehicleId: null, category: null, since: null };
    return { status: presence.isAvailable ? 'online' : 'paused', vehicleId: presence.vehicleId, category: presence.category, since: presence.updatedAt.toISOString() };
  }

  /** `location.update` (socket) ou `POST /driver/location` (secours). */
  async recordLocation(userId: string, update: LocationUpdate): Promise<{ rideId: string | null; accepted: boolean }> {
    const driver = await this.driverOfUser(userId);
    return this.recordForDriver(driver.id, update);
  }

  async recordForDriver(driverId: string, update: LocationUpdate): Promise<{ rideId: string | null; accepted: boolean }> {
    const result = await this.recordBatchForDriver(driverId, [update]);
    return { rideId: result.rideId, accepted: result.accepted > 0 };
  }

  /**
   * Lot de positions (une seule ou accumulées hors ligne) : la dernière devient la présence courante et est diffusée,
   * toutes sont mises en file pour l'historique. Une présence expirée pendant une course active est recréée.
   */
  async recordBatchForDriver(driverId: string, updates: LocationUpdate[]): Promise<{ rideId: string | null; accepted: number; ignored: number }> {
    const [minDistance, minInterval] = await Promise.all([this.settings.number('presence.min_distance_meters', 50), this.settings.number('presence.min_interval_seconds', 5)]);
    const active = await this.activeRide(driverId);
    const accepted: BufferedLocation[] = [];
    let ignored = 0;
    let last = this.lastByDriver.get(driverId);
    for (const update of updates) {
      this.stats.received += 1;
      const recordedAt = update.recordedAt ? new Date(update.recordedAt) : new Date();
      const position = update.coordinates;
      if (last && recordedAt.getTime() - last.at < minInterval * 1000 && haversineMeters(last.position, position) < minDistance) {
        this.stats.ignored += 1;
        ignored += 1;
        continue;
      }
      last = { position, at: recordedAt.getTime() };
      accepted.push({ driverId, position, speedMps: update.speedMps ?? null, headingDegrees: update.headingDegrees ?? null, accuracyMeters: update.accuracyMeters ?? null, rideId: active?.id ?? null, recordedAt });
    }
    if (!accepted.length) return { rideId: active?.id ?? null, accepted: 0, ignored };
    const latest = accepted.at(-1)!;
    const now = new Date();
    const [presence] = await this.db
      .update(schema.driverPresence)
      .set({ position: latest.position, headingDegrees: latest.headingDegrees, currentRideId: active?.id ?? null, updatedAt: now })
      .where(eq(schema.driverPresence.driverId, driverId))
      .returning({ driverId: schema.driverPresence.driverId });
    if (!presence) {
      if (!active) throw AppError.conflict('DRIVER_OFFLINE', 'Passez en ligne avant d\'envoyer des positions');
      // Coupure réseau pendant une course : la présence a expiré, elle est recréée avec le véhicule de la course.
      const [vehicle] = active.vehicleId ? await this.db.select({ id: schema.vehicles.id, category: schema.vehicles.category }).from(schema.vehicles).where(eq(schema.vehicles.id, active.vehicleId)).limit(1) : [];
      if (!vehicle) throw AppError.conflict('DRIVER_OFFLINE', 'Passez en ligne avant d\'envoyer des positions');
      await this.upsertPresence(driverId, latest.position, vehicle.id, vehicle.category, false, now, active.id);
      await this.db.update(schema.drivers).set({ isOnline: true }).where(eq(schema.drivers.id, driverId));
      this.events.emit('driver.presence', { driverId, status: 'paused', category: vehicle.category });
    } else {
      await this.redis?.geoadd(GEO_KEY, latest.position.lng, latest.position.lat, driverId).catch(() => undefined);
    }
    this.lastByDriver.set(driverId, last!);
    this.buffer.push(...accepted);
    if (this.buffer.length >= 500) void this.flush().catch(() => undefined);
    this.events.emit('driver.location', { driverId, rideId: active?.id ?? null, coordinates: latest.position, headingDegrees: latest.headingDegrees, speedMps: latest.speedMps, recordedAt: latest.recordedAt });
    return { rideId: active?.id ?? null, accepted: accepted.length, ignored };
  }

  /** Course en cours d'un chauffeur (états actifs), s'il y en a une. */
  async activeRide(driverId: string): Promise<{ id: string; vehicleId: string | null } | null> {
    const [row] = await this.db
      .select({ id: schema.rides.id, vehicleId: schema.rides.vehicleId })
      .from(schema.rides)
      .where(and(eq(schema.rides.driverId, driverId), inArray(schema.rides.state, [...ACTIVE_RIDE_STATES])))
      .orderBy(desc(schema.rides.updatedAt))
      .limit(1);
    return row ?? null;
  }

  /** Écriture par lots dans `driver_locations` (partition du jour créée au besoin). */
  async flush(): Promise<number> {
    if (!this.buffer.length) return 0;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.ensurePartitions();
      await this.db.insert(schema.driverLocations).values(batch.map((b) => ({ driverId: b.driverId, position: b.position, speedMps: b.speedMps, headingDegrees: b.headingDegrees, accuracyMeters: b.accuracyMeters, rideId: b.rideId, recordedAt: b.recordedAt })));
      this.stats.written += batch.length;
      return batch.length;
    } catch (error) {
      this.stats.dropped += batch.length;
      this.logger.error({ err: error, count: batch.length }, 'Positions perdues à l\'écriture');
      return 0;
    }
  }

  private async ensurePartitions(): Promise<void> {
    const day = new Date().toISOString().slice(0, 10);
    if (this.partitionsDay === day) return;
    await this.db.execute(sql`SELECT ensure_driver_locations_partition(current_date), ensure_driver_locations_partition(current_date + 1)`);
    this.partitionsDay = day;
  }

  /** Présence expirée sans position depuis `presence.expiry_seconds` : chauffeur repassé hors ligne. */
  async sweepExpired(now = new Date()): Promise<string[]> {
    const expirySeconds = await this.settings.number('presence.expiry_seconds', 60);
    const cutoff = new Date(now.getTime() - expirySeconds * 1000);
    const expired = await this.db.delete(schema.driverPresence).where(lt(schema.driverPresence.updatedAt, cutoff)).returning({ driverId: schema.driverPresence.driverId });
    for (const { driverId } of expired) {
      await this.db.update(schema.drivers).set({ isOnline: false }).where(eq(schema.drivers.id, driverId));
      await this.closeShift(driverId, now);
      await this.redis?.zrem(GEO_KEY, driverId).catch(() => undefined);
      this.lastByDriver.delete(driverId);
      this.events.emit('driver.presence', { driverId, status: 'offline', category: null });
    }
    return expired.map((e) => e.driverId);
  }

  private async openShift(driverId: string, at: Date): Promise<void> {
    const [open] = await this.db.select({ id: schema.driverShifts.id }).from(schema.driverShifts).where(and(eq(schema.driverShifts.driverId, driverId), isNull(schema.driverShifts.endedAt))).limit(1);
    if (!open) await this.db.insert(schema.driverShifts).values({ driverId, startedAt: at });
  }

  private async closeShift(driverId: string, at: Date): Promise<void> {
    await this.db
      .update(schema.driverShifts)
      .set({ endedAt: at, onlineSeconds: sql`extract(epoch from (${at.toISOString()}::timestamptz - ${schema.driverShifts.startedAt}))::int` })
      .where(and(eq(schema.driverShifts.driverId, driverId), isNull(schema.driverShifts.endedAt)));
  }

  /** Dernière position connue d'un chauffeur en ligne (suivi public, My Hub, remise en ligne). */
  async positionOf(driverId: string): Promise<GeoPoint | null> {
    const rows = await this.db.execute<{ position: string }>(sql`SELECT ST_AsGeoJSON(position) AS position FROM driver_presence WHERE driver_id = ${driverId}`);
    return rows[0] ? parseGeoPoint(rows[0].position) : null;
  }
}
