/** Lecture d'une course avec ses positions (GeoJSON) et son chauffeur, et projection vers la vue de l'API. */
import { schema } from '@neomoov/db';
import type { PaymentMethod, Place, RideState, RideView, VehicleCategory } from '@neomoov/domain';
import { desc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../infra/db.module.js';

const { originPosition: _o, destinationPosition: _d, ...rideColumns } = getTableColumns(schema.rides);

export type RideRow = Omit<typeof schema.rides.$inferSelect, 'originPosition' | 'destinationPosition'> & { originGeo: string; destinationGeo: string };

export interface VehicleSummary {
  id: string;
  make: string;
  model: string;
  colour: string;
  plate: string;
  category: VehicleCategory;
}

export interface DriverSummary {
  driverId: string;
  userId: string;
  firstName: string;
  rating: number;
  rideCount: number;
  currentVehicleId: string | null;
  /** Tous les véhicules du chauffeur (le véhicule de la course peut ne plus être son véhicule courant). */
  vehicles: VehicleSummary[];
}

export function parseGeoPoint(geo: string): { lat: number; lng: number } {
  const parsed = JSON.parse(geo) as { coordinates: [number, number] };
  return { lat: parsed.coordinates[1], lng: parsed.coordinates[0] };
}

export async function selectRides(db: Database['db'], where: SQL | undefined, options: { limit?: number; forUpdate?: boolean } = {}): Promise<RideRow[]> {
  let query = db
    .select({ ...rideColumns, originGeo: sql<string>`ST_AsGeoJSON(${schema.rides.originPosition})`, destinationGeo: sql<string>`ST_AsGeoJSON(${schema.rides.destinationPosition})` })
    .from(schema.rides)
    .where(where)
    .orderBy(desc(schema.rides.createdAt), desc(schema.rides.id))
    .$dynamic();
  if (options.limit) query = query.limit(options.limit);
  if (options.forUpdate) query = query.for('update', { of: schema.rides });
  return query;
}

export async function selectRide(db: Database['db'], id: string, forUpdate = false): Promise<RideRow | null> {
  const [row] = await selectRides(db, eq(schema.rides.id, id), { limit: 1, forUpdate });
  return row ?? null;
}

export async function driverSummaries(db: Database['db'], driverIds: string[]): Promise<Map<string, DriverSummary>> {
  const ids = [...new Set(driverIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db
    .select({
      driverId: schema.drivers.id,
      userId: schema.drivers.userId,
      firstName: schema.users.firstName,
      rating: schema.drivers.ratingAverage,
      rideCount: schema.drivers.rideCount,
      currentVehicleId: schema.drivers.currentVehicleId,
    })
    .from(schema.drivers)
    .innerJoin(schema.users, eq(schema.users.id, schema.drivers.userId))
    .where(inArray(schema.drivers.id, ids));
  const vehicles = await db
    .select({ id: schema.vehicles.id, driverId: schema.vehicles.driverId, make: schema.vehicles.make, model: schema.vehicles.model, colour: schema.vehicles.colour, plate: schema.vehicles.plate, category: schema.vehicles.category })
    .from(schema.vehicles)
    .where(inArray(schema.vehicles.driverId, ids));
  const map = new Map<string, DriverSummary>();
  for (const r of rows) {
    map.set(r.driverId, { driverId: r.driverId, userId: r.userId, firstName: r.firstName ?? 'Chauffeur', rating: Number(r.rating), rideCount: r.rideCount, currentVehicleId: r.currentVehicleId, vehicles: vehicles.filter((v) => v.driverId === r.driverId) });
  }
  return map;
}

export function timestampsOf(row: RideRow): Partial<Record<RideState, string>> {
  return (row.stateTimestamps ?? {}) as Partial<Record<RideState, string>>;
}

/** Vue de la course : le véhicule affiché est celui enregistré sur la course (`rides.vehicle_id`), sinon le véhicule courant du chauffeur. */
export function toRideView(row: RideRow, driver: DriverSummary | null, options: { webBaseUrl: string; etaSeconds?: number | null }): RideView {
  const vehicle = driver ? (driver.vehicles.find((v) => v.id === row.vehicleId) ?? driver.vehicles.find((v) => v.id === driver.currentVehicleId) ?? driver.vehicles[0] ?? null) : null;
  return {
    id: row.id,
    state: row.state,
    type: row.type,
    category: row.reservedCategory,
    servedCategory: row.servedCategory,
    origin: { address: row.originAddress, coordinates: parseGeoPoint(row.originGeo) },
    destination: { address: row.destinationAddress, coordinates: parseGeoPoint(row.destinationGeo) },
    stops: row.stops as Place[],
    requestedAt: row.requestedAt?.toISOString() ?? null,
    quote: { totalCents: row.quotedTotalCents, fareCents: row.fareCents ?? 0, maxConsentedCents: row.maxConsentedCents, flatRateCode: null },
    finalPriceCents: row.finalPriceCents,
    tipCents: row.tipCents,
    paymentMethod: row.paymentMethod as PaymentMethod,
    driver: driver
      ? {
          id: driver.driverId,
          firstName: driver.firstName,
          rating: driver.rating,
          rideCount: driver.rideCount,
          photoUrl: null,
          vehicle: vehicle ? { make: vehicle.make, model: vehicle.model, colour: vehicle.colour, plate: vehicle.plate, category: vehicle.category } : { make: '', model: '', colour: '', plate: '', category: row.servedCategory ?? row.reservedCategory },
        }
      : null,
    etaSeconds: options.etaSeconds ?? null,
    trackingUrl: row.trackingToken ? `${options.webBaseUrl.replace(/\/+$/, '')}/suivi/${row.trackingToken}` : null,
    timestamps: timestampsOf(row),
  };
}
