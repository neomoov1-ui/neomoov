/**
 * Types de colonnes et fragments communs à toutes les tables.
 * Montants : entiers en cents. Taux : entiers en parties par million (ppm). Positions : PostGIS geography.
 */

import { sql } from 'drizzle-orm';
import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

export const id = () => uuid('id').primaryKey().default(sql`gen_random_uuid()`);

export const createdAt = () => timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();
export const updatedAt = () => timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow().$onUpdate(() => new Date());
export const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/** Montant en cents, jamais négatif sauf mention contraire (contrainte CHECK posée sur la table). */
export const cents = (name: string) => integer(name);

/** Point géographique WGS 84 (longitude, latitude), lu et écrit en GeoJSON. */
export interface GeoPoint { lng: number; lat: number }
export const geoPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() { return 'geography(point,4326)'; },
  toDriver(value: GeoPoint) { return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography` as unknown as string; },
  fromDriver(value: string): GeoPoint {
    // PostGIS renvoie du WKB hexadécimal ; on demande ST_AsGeoJSON dans les requêtes qui lisent la colonne.
    const parsed = JSON.parse(value) as { coordinates: [number, number] };
    return { lng: parsed.coordinates[0], lat: parsed.coordinates[1] };
  },
});

/** Polygone géographique WGS 84, en GeoJSON. */
export interface GeoPolygon { type: 'Polygon'; coordinates: number[][][] }
export const geoPolygon = customType<{ data: GeoPolygon; driverData: string }>({
  dataType() { return 'geography(polygon,4326)'; },
  toDriver(value: GeoPolygon) { return sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})::geography` as unknown as string; },
  fromDriver(value: string): GeoPolygon { return JSON.parse(value) as GeoPolygon; },
});

/** Ligne géographique (trace simplifiée d'une course). */
export interface GeoLineString { type: 'LineString'; coordinates: number[][] }
export const geoLine = customType<{ data: GeoLineString; driverData: string }>({
  dataType() { return 'geography(linestring,4326)'; },
  toDriver(value: GeoLineString) { return sql`ST_GeomFromGeoJSON(${JSON.stringify(value)})::geography` as unknown as string; },
  fromDriver(value: string): GeoLineString { return JSON.parse(value) as GeoLineString; },
});
