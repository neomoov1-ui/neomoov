/**
 * Étape 23 (module Flotte) : carte en direct, courses reçues par l'organisation, répartition interne et réseau Neomoov.
 *
 * - Carte en direct (`live`) et répartition interne (`assign`, `reassign`) : dans la transaction restreinte de la route ;
 *   les politiques ne laissent voir que les chauffeurs, véhicules et courses de l'organisation et de ses descendantes, et
 *   la répartition automatique relancée par `reassign` ne propose que ses chauffeurs (filtre `organizationAllows`).
 * - Courses reçues : devis et course saisis par le répartiteur de l'organisation (`quote`, `createRide`) par les services
 *   existants, sous contexte : la course appartient à l'organisation. Une réservation sur son domaine ou par ses clients
 *   rattachés suit les mêmes services.
 * - Réseau (`networkPass`, tâche de la plateforme) : en mode `neomoov_network`, une course non pourvue après le délai de
 *   l'organisation repart au réseau Neomoov (`network_shared_at`) : la répartition est relancée sans le filtre de
 *   l'organisation, et le journal de la course garde exactement ce qui a été transmis (champs permis seulement).
 */
import { schema } from '@neomoov/db';
import {
  networkSharedRide, shouldShareToNetwork, type AdminAssign, type FleetLive, type FleetSettings, type NetworkMode, type QuoteRequest, type RideState, type RideType,
  type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { AppError } from '../../common/app-error.js';
import { APP_LOGGER } from '../../common/logger.js';
import { withoutOrgScope } from '../../common/org-scope.context.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';
import { QuotesService } from '../pricing/quotes.service.js';
import { DispatchService } from '../rides/dispatch.service.js';
import { parseGeoPoint } from '../rides/ride-view.js';
import { RidesService, SYSTEM_ACTOR } from '../rides/rides.service.js';

type AdminCreateRide = Parameters<RidesService['createByOperator']>[0];

@Injectable()
export class FleetDispatchService {
  constructor(
    @Inject(DB) private readonly database: Database,
    @Inject(APP_LOGGER) private readonly logger: Logger,
    private readonly rides: RidesService,
    private readonly dispatch: DispatchService,
    private readonly quotes: QuotesService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- Carte en direct ---

  async live(now = new Date()): Promise<FleetLive> {
    const drivers = await this.db.execute<{
      driver_id: string; public_number: string; first_name: string | null; position: string; heading_degrees: number | null; is_available: boolean; current_ride_id: string | null;
      visible_ride_id: string | null; vehicle_id: string | null; plate: string | null; category: VehicleCategory | null; updated_at: string;
    }>(sql`
      SELECT p.driver_id, d.public_number, u.first_name, ST_AsGeoJSON(p.position) AS position, p.heading_degrees, p.is_available, p.current_ride_id,
             r.id AS visible_ride_id, v.id AS vehicle_id, v.plate, COALESCE(v.category, p.category) AS category, p.updated_at
      FROM driver_presence p
      JOIN drivers d ON d.id = p.driver_id
      LEFT JOIN users u ON u.id = d.user_id
      LEFT JOIN vehicles v ON v.id = p.vehicle_id
      LEFT JOIN rides r ON r.id = p.current_ride_id
      WHERE d.is_online
      ORDER BY d.public_number
      LIMIT 500`);
    const rides = await this.db.execute<{
      id: string; public_number: string; state: RideState; type: RideType; reserved_category: VehicleCategory; origin_address: string; origin: string; destination_address: string;
      destination: string; requested_at: string | null; driver_id: string | null; network_shared_at: string | null;
    }>(sql`
      SELECT r.id, r.public_number, r.state, r.type, r.reserved_category, r.origin_address, ST_AsGeoJSON(r.origin_position) AS origin, r.destination_address,
             ST_AsGeoJSON(r.destination_position) AS destination, r.requested_at, r.driver_id, r.network_shared_at
      FROM rides r
      WHERE r.state IN ('requested', 'offering', 'assigned', 'en_route', 'arrived', 'in_progress')
      ORDER BY COALESCE(r.requested_at, r.created_at)
      LIMIT 300`);
    return {
      generatedAt: now.toISOString(),
      drivers: [...drivers].map((d) => ({
        driverId: d.driver_id, firstName: d.first_name, publicNumber: d.public_number,
        // Course d'une autre organisation (réseau Neomoov) : le chauffeur est « en course », la course n'est jamais désignée.
        status: d.current_ride_id ? ('on_ride' as const) : d.is_available ? ('available' as const) : ('busy' as const),
        coordinates: parseGeoPoint(d.position), headingDegrees: d.heading_degrees === null ? null : Number(d.heading_degrees),
        vehicle: d.vehicle_id && d.plate && d.category ? { id: d.vehicle_id, plate: d.plate, category: d.category } : null,
        rideId: d.visible_ride_id, updatedAt: new Date(d.updated_at).toISOString(),
      })),
      rides: [...rides].map((r) => ({
        id: r.id, publicNumber: r.public_number, state: r.state, type: r.type, category: r.reserved_category,
        origin: { address: r.origin_address, coordinates: parseGeoPoint(r.origin) }, destination: { address: r.destination_address, coordinates: parseGeoPoint(r.destination) },
        requestedAt: r.requested_at ? new Date(r.requested_at).toISOString() : null, driverId: r.driver_id, networkShared: r.network_shared_at !== null,
      })),
    };
  }

  // --- Courses reçues et répartition interne ---

  quote(input: QuoteRequest, actor: UserActor, language: 'fr' | 'en') {
    return this.quotes.createQuotes(input, { userId: actor.userId, language });
  }

  createRide(input: AdminCreateRide, actor: UserActor) {
    return this.rides.createByOperator(input, actor);
  }

  /** Attribution par le répartiteur de l'organisation, à l'un de ses chauffeurs (un autre est introuvable : 404). */
  assign(rideId: string, input: AdminAssign, actor: UserActor) {
    return this.rides.assign(rideId, input, { kind: 'operator', userId: actor.userId });
  }

  /** Réattribution : chauffeur retiré sans sanction, nouvelle recherche prioritaire parmi les chauffeurs de l'organisation. */
  reassign(rideId: string, input: { reason: string; excludeDriver: boolean }, actor: UserActor) {
    return this.dispatch.reassign(rideId, actor, input);
  }

  // --- Réglages du réseau ---

  async settings(organizationId: string): Promise<FleetSettings> {
    const [org] = await this.db.select({ networkMode: schema.organizations.networkMode, networkAfterMinutes: schema.organizations.networkAfterMinutes }).from(schema.organizations).where(eq(schema.organizations.id, organizationId)).limit(1);
    if (!org) throw AppError.notFound('ORGANIZATION_NOT_FOUND', 'Organisation introuvable');
    return { networkMode: org.networkMode as NetworkMode, networkAfterMinutes: org.networkAfterMinutes };
  }

  async updateSettings(organizationId: string, input: { networkMode?: NetworkMode | undefined; networkAfterMinutes?: number | undefined }): Promise<FleetSettings> {
    const before = await this.settings(organizationId);
    await this.db
      .update(schema.organizations)
      .set({ ...(input.networkMode !== undefined ? { networkMode: input.networkMode } : {}), ...(input.networkAfterMinutes !== undefined ? { networkAfterMinutes: input.networkAfterMinutes } : {}), updatedAt: new Date() })
      .where(eq(schema.organizations.id, organizationId));
    this.audit.record({ action: 'fleet.settings_updated', entity: 'organizations', entityId: organizationId, before, after: input });
    return this.settings(organizationId);
  }

  // --- Réseau Neomoov (tâche de la plateforme) ---

  /**
   * Passe du réseau : chaque course d'une organisation en mode réseau, encore sans chauffeur après son délai, repart au
   * réseau Neomoov. La course reste celle de l'organisation ; seuls les champs permis sont transmis (journal de la course,
   * offres aux chauffeurs du réseau sans nom complet, téléphone, courriel ni demandes particulières du client).
   */
  async networkPass(now = new Date()): Promise<{ shared: string[] }> {
    return withoutOrgScope(async () => {
      const candidates = await this.db
        .select({
          id: schema.rides.id, state: schema.rides.state, driverId: schema.rides.driverId, createdAt: schema.rides.createdAt, requestedAt: schema.rides.requestedAt,
          networkSharedAt: schema.rides.networkSharedAt, networkMode: schema.organizations.networkMode, afterMinutes: schema.organizations.networkAfterMinutes,
        })
        .from(schema.rides)
        .innerJoin(schema.organizations, eq(schema.organizations.id, schema.rides.organizationId))
        .where(and(isNotNull(schema.organizations.parentId), eq(schema.organizations.networkMode, 'neomoov_network'), isNull(schema.rides.networkSharedAt), isNull(schema.rides.driverId), sql`${schema.rides.state} IN ('requested', 'offering')`))
        .limit(200);
      const shared: string[] = [];
      for (const c of candidates) {
        if (!shouldShareToNetwork({ networkMode: c.networkMode as NetworkMode, afterMinutes: c.afterMinutes, createdAt: c.createdAt, requestedAt: c.requestedAt, now, state: c.state, hasDriver: Boolean(c.driverId), sharedAt: c.networkSharedAt })) continue;
        try {
          if (await this.share(c.id, now)) shared.push(c.id);
        } catch (error) {
          this.logger.error({ err: error, rideId: c.id }, 'Partage d\'une course au réseau Neomoov en échec');
        }
      }
      return { shared };
    });
  }

  private async share(rideId: string, now: Date): Promise<boolean> {
    const [marked] = await this.db.update(schema.rides).set({ networkSharedAt: now }).where(and(eq(schema.rides.id, rideId), isNull(schema.rides.networkSharedAt), isNull(schema.rides.driverId))).returning({ id: schema.rides.id });
    if (!marked) return false;
    const ride = await this.rides.getRide(rideId);
    const [client] = ride.clientId ? await this.db.select({ firstName: schema.users.firstName }).from(schema.clients).innerJoin(schema.users, eq(schema.users.id, schema.clients.userId)).where(eq(schema.clients.id, ride.clientId)).limit(1) : [];
    const transmitted = networkSharedRide({
      rideId: ride.id, category: ride.reservedCategory, type: ride.type,
      origin: { address: ride.originAddress, coordinates: parseGeoPoint(ride.originGeo) }, destination: { address: ride.destinationAddress, coordinates: parseGeoPoint(ride.destinationGeo) },
      requestedAt: ride.requestedAt?.toISOString() ?? null, driverFareCents: ride.fareCents ?? 0, passengerFirstName: ride.passengerName ?? ride.guestName ?? client?.firstName ?? null,
    });
    await this.rides.mark(rideId, 'network_shared', SYSTEM_ACTOR, { organizationId: ride.organizationId, transmitted });
    await this.dispatch.start(rideId, { reason: 'operator', priority: true, now });
    return true;
  }
}
