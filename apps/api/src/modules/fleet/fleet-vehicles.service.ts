/**
 * Étape 23 (module Flotte) : véhicules d'une organisation, dans la transaction restreinte de la route (un véhicule ou un
 * chauffeur d'une autre organisation est introuvable : 404). Un véhicule a toujours un titulaire (`vehicles.driver_id`,
 * colonne non nulle de la V1) : la création exige un chauffeur de l'organisation et l'affectation change de titulaire.
 * Un véhicule créé par l'organisation attend l'inspection de la plateforme (`pending`), comme celui d'un chauffeur.
 * Entretien : registre `vehicle_maintenance` et échéances calculées par le domaine. Finalisation du 3 octobre 2026 : la
 * suggestion d'entretien (`aiSuggestion`) est remplie par les règles déterministes du domaine (`maintenanceSuggestion` :
 * retards, échéances proches, inspection annuelle, pneus, freins, pneus d'hiver), sans appel au modèle.
 */
import { schema } from '@neomoov/db';
import {
  deduceVehicleCategory, maintenanceDue, maintenanceSuggestion, type CategoryRule, type FleetVehicle, type MaintenanceCreate, type MaintenanceKind, type OrgVehicleCreate, type OrgVehicleUpdate,
  type VehicleCategory,
} from '@neomoov/domain';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../../common/app-error.js';
import { SettingsService } from '../../common/settings.service.js';
import { DB, type Database } from '../../infra/db.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { UserActor } from '../auth/actor.js';

type VehicleRow = typeof schema.vehicles.$inferSelect;

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e?.code ?? e?.cause?.code) === '23505';
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

@Injectable()
export class FleetVehiclesService {
  constructor(
    @Inject(DB) private readonly database: Database,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async vehicle(id: string): Promise<VehicleRow> {
    const [row] = await this.db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id)).limit(1);
    if (!row) throw AppError.notFound('VEHICLE_NOT_FOUND', 'Véhicule introuvable');
    return row;
  }

  private async driver(id: string) {
    const [row] = await this.db.select({ id: schema.drivers.id, currentVehicleId: schema.drivers.currentVehicleId, userId: schema.drivers.userId }).from(schema.drivers).where(eq(schema.drivers.id, id)).limit(1);
    if (!row) throw AppError.notFound('DRIVER_NOT_FOUND', 'Chauffeur introuvable');
    return row;
  }

  /** Propriétaire désigné : une personne liée à l'organisation (membre, chauffeur ou client), sinon 404. */
  private async assertOwner(userId: string): Promise<void> {
    const [row] = await this.db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!row) throw AppError.notFound('OWNER_NOT_FOUND', 'Propriétaire introuvable dans l\'organisation');
  }

  async view(id: string): Promise<FleetVehicle> {
    const row = await this.vehicle(id);
    const [holder] = await this.db
      .select({ first: schema.users.firstName, last: schema.users.lastName, currentVehicleId: schema.drivers.currentVehicleId })
      .from(schema.drivers)
      .leftJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
      .where(eq(schema.drivers.id, row.driverId))
      .limit(1);
    return {
      id: row.id, driverId: row.driverId, driverName: [holder?.first, holder?.last].filter(Boolean).join(' ') || null, ownerUserId: row.ownerUserId, category: row.category as VehicleCategory,
      make: row.make, model: row.model, year: row.year, colour: row.colour, plate: row.plate, seats: row.seats, odometerKm: row.odometerKm, status: row.status,
      nextInspectionDueOn: row.nextInspectionDueOn, current: holder?.currentVehicleId === row.id,
    };
  }

  /** Véhicule de l'organisation : catégorie déduite du modèle, de l'année et des places ; en attente de l'inspection. */
  async create(input: OrgVehicleCreate, actor: UserActor): Promise<FleetVehicle> {
    const driver = await this.driver(input.driverId);
    if (input.ownerUserId) await this.assertOwner(input.ownerUserId);
    const rules = await this.db.select().from(schema.vehicleCategories).orderBy(asc(schema.vehicleCategories.rank));
    const categoryRules: CategoryRule[] = rules.map((r) => ({ code: r.code as VehicleCategory, rank: r.rank, seats: r.seats, minYear: r.minYear, allowedModels: stringList(r.allowedModels), active: r.active }));
    const deduction = deduceVehicleCategory(input, categoryRules);
    if (!deduction.category) throw new AppError('VEHICLE_NOT_ADMITTED', 'Ce véhicule ne correspond à aucune catégorie Neomoov', 400, { refusal: deduction.refusal });
    let row: VehicleRow;
    try {
      [row] = (await this.db
        .insert(schema.vehicles)
        .values({
          driverId: driver.id, category: deduction.category, make: input.make, model: input.model, year: input.year, colour: input.colour, plate: input.plate.replace(/\s+/g, ' '),
          vin: input.vin ?? null, seats: input.seats, odometerKm: input.odometerKm ?? null, equipment: input.equipment, status: 'pending', ownerUserId: input.ownerUserId ?? null,
        })
        .returning()) as [VehicleRow];
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('VEHICLE_ALREADY_REGISTERED', 'Cette plaque ou ce numéro de série est déjà enregistré');
      throw error;
    }
    if (!driver.currentVehicleId) await this.db.update(schema.drivers).set({ currentVehicleId: row.id }).where(eq(schema.drivers.id, driver.id));
    this.audit.record({ action: 'fleet.vehicle_created', entity: 'vehicles', entityId: row.id, after: { driverId: driver.id, category: row.category, plate: row.plate, ownerUserId: row.ownerUserId } });
    return this.view(row.id);
  }

  async update(id: string, input: OrgVehicleUpdate, actor: UserActor): Promise<FleetVehicle> {
    const before = await this.vehicle(id);
    if (input.ownerUserId) await this.assertOwner(input.ownerUserId);
    try {
      await this.db
        .update(schema.vehicles)
        .set({
          ...(input.colour !== undefined ? { colour: input.colour } : {}),
          ...(input.plate !== undefined ? { plate: input.plate.replace(/\s+/g, ' ') } : {}),
          ...(input.odometerKm !== undefined ? { odometerKm: input.odometerKm } : {}),
          ...(input.equipment !== undefined ? { equipment: input.equipment } : {}),
          ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
          ...(input.retired ? { status: 'retired' as const } : {}),
        })
        .where(eq(schema.vehicles.id, id));
    } catch (error) {
      if (isUniqueViolation(error)) throw AppError.conflict('VEHICLE_ALREADY_REGISTERED', 'Cette plaque est déjà enregistrée');
      throw error;
    }
    // Un véhicule retiré n'est plus le véhicule courant de personne.
    if (input.retired) await this.db.update(schema.drivers).set({ currentVehicleId: null }).where(eq(schema.drivers.currentVehicleId, id));
    this.audit.record({ action: 'fleet.vehicle_updated', entity: 'vehicles', entityId: id, before: { plate: before.plate, status: before.status, ownerUserId: before.ownerUserId }, after: input });
    return this.view(id);
  }

  /**
   * Affectation à un chauffeur de l'organisation : il devient le titulaire (et, par défaut, c'est son véhicule courant).
   * Refusée pour un véhicule retiré ou en service (chauffeur en ligne avec lui, course en cours).
   */
  async assign(id: string, input: { driverId: string; makeCurrent: boolean }, actor: UserActor): Promise<FleetVehicle> {
    const vehicle = await this.vehicle(id);
    if (vehicle.status === 'retired') throw AppError.conflict('VEHICLE_RETIRED', 'Ce véhicule est retiré du service');
    const target = await this.driver(input.driverId);
    const [inUse] = await this.db.execute<{ busy: boolean }>(sql`
      SELECT (EXISTS (SELECT 1 FROM driver_presence p WHERE p.vehicle_id = ${id}::uuid AND p.driver_id <> ${target.id}::uuid)
        OR EXISTS (SELECT 1 FROM rides r WHERE r.vehicle_id = ${id}::uuid AND r.driver_id <> ${target.id}::uuid AND r.state IN ('assigned', 'en_route', 'arrived', 'in_progress'))) AS busy`);
    if (inUse?.busy) throw AppError.conflict('VEHICLE_IN_USE', 'Ce véhicule est en service avec un autre chauffeur');
    const previousHolder = vehicle.driverId;
    await this.db.update(schema.vehicles).set({ driverId: target.id }).where(eq(schema.vehicles.id, id));
    if (previousHolder !== target.id) await this.db.update(schema.drivers).set({ currentVehicleId: null }).where(and(eq(schema.drivers.id, previousHolder), eq(schema.drivers.currentVehicleId, id)));
    if (input.makeCurrent) await this.db.update(schema.drivers).set({ currentVehicleId: id }).where(eq(schema.drivers.id, target.id));
    this.audit.record({ action: 'fleet.vehicle_assigned', entity: 'vehicles', entityId: id, before: { driverId: previousHolder }, after: { driverId: target.id, current: input.makeCurrent } });
    return this.view(id);
  }

  // --- Entretien ---

  async maintenance(vehicleId: string, now = new Date(), language: 'fr' | 'en' = 'fr') {
    const vehicle = await this.vehicle(vehicleId);
    const rows = await this.db.select().from(schema.vehicleMaintenance).where(eq(schema.vehicleMaintenance.vehicleId, vehicleId)).orderBy(desc(schema.vehicleMaintenance.performedOn), desc(schema.vehicleMaintenance.createdAt));
    const timeZone = await this.settings.string('service.time_zone', 'America/Toronto');
    const today = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const records = rows.map((r) => ({
      id: r.id, vehicleId: r.vehicleId, kind: r.kind as MaintenanceKind, performedOn: r.performedOn, odometerKm: r.odometerKm, costCents: r.costCents, notes: r.notes, nextDueOn: r.nextDueOn,
      nextDueKm: r.nextDueKm, createdAt: r.createdAt.toISOString(),
    }));
    const due = maintenanceDue(records, today, vehicle.odometerKm);
    return { vehicleId, records, due, aiSuggestion: maintenanceSuggestion(records, due, today, vehicle.odometerKm, language) };
  }

  async addMaintenance(vehicleId: string, input: MaintenanceCreate, actor: UserActor) {
    const vehicle = await this.vehicle(vehicleId);
    const [row] = await this.db
      .insert(schema.vehicleMaintenance)
      .values({
        vehicleId, kind: input.kind, performedOn: input.performedOn, odometerKm: input.odometerKm ?? null, costCents: input.costCents ?? null, notes: input.notes ?? null,
        nextDueOn: input.nextDueOn ?? null, nextDueKm: input.nextDueKm ?? null, createdByUserId: actor.userId,
      })
      .returning({ id: schema.vehicleMaintenance.id });
    // Le kilométrage déclaré fait avancer le compteur du véhicule (jamais reculer).
    if (input.odometerKm !== undefined && (vehicle.odometerKm === null || input.odometerKm > vehicle.odometerKm)) {
      await this.db.update(schema.vehicles).set({ odometerKm: input.odometerKm }).where(eq(schema.vehicles.id, vehicleId));
    }
    this.audit.record({ action: 'fleet.maintenance_recorded', entity: 'vehicle_maintenance', entityId: row!.id, after: { vehicleId, kind: input.kind, performedOn: input.performedOn, costCents: input.costCents ?? null } });
    return this.maintenance(vehicleId);
  }

  /** Échéances d'entretien de plusieurs véhicules (tableau de bord du propriétaire). */
  async dueOf(vehicleIds: string[], today: string, odometers: Map<string, number | null>) {
    if (!vehicleIds.length) return new Map<string, ReturnType<typeof maintenanceDue>>();
    const rows = await this.db.select().from(schema.vehicleMaintenance).where(inArray(schema.vehicleMaintenance.vehicleId, vehicleIds));
    const out = new Map<string, ReturnType<typeof maintenanceDue>>();
    for (const id of vehicleIds) {
      const records = rows.filter((r) => r.vehicleId === id).map((r) => ({ kind: r.kind as MaintenanceKind, performedOn: r.performedOn, odometerKm: r.odometerKm, nextDueOn: r.nextDueOn, nextDueKm: r.nextDueKm }));
      out.set(id, maintenanceDue(records, today, odometers.get(id) ?? null));
    }
    return out;
  }
}
