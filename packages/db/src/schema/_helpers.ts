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
    // Les requêtes qui lisent la colonne demandent ST_AsGeoJSON ; une lecture brute (`select()` de la table) reçoit le
    // WKB hexadécimal de PostGIS, décodé ici plutôt que de faire échouer la lecture.
    if (value.trimStart().startsWith('{')) {
      const parsed = JSON.parse(value) as { coordinates: [number, number] };
      return { lng: parsed.coordinates[0], lat: parsed.coordinates[1] };
    }
    return pointFromEwkbHex(value);
  },
});

/** Point en EWKB hexadécimal (ordre des octets, type avec drapeau SRID facultatif, SRID, X puis Y en double précision). */
export function pointFromEwkbHex(hex: string): GeoPoint {
  const bytes = Buffer.from(hex, 'hex');
  if (bytes.length < 21) throw new Error('Point PostGIS illisible');
  const littleEndian = bytes[0] === 1;
  const type = littleEndian ? bytes.readUInt32LE(1) : bytes.readUInt32BE(1);
  if ((type & 0xff) !== 1) throw new Error(`Géométrie PostGIS inattendue (type ${type & 0xff}) : un point était attendu`);
  const offset = type & 0x20000000 ? 9 : 5;
  const x = littleEndian ? bytes.readDoubleLE(offset) : bytes.readDoubleBE(offset);
  const y = littleEndian ? bytes.readDoubleLE(offset + 8) : bytes.readDoubleBE(offset + 8);
  return { lng: x, lat: y };
}

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
